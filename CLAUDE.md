# CLAUDE.md

Guidance for anyone (human or agent) working in this repo. Read this first —
it reflects the codebase as of August 2026.

## What Orbit is

Orbit is the **AI OS for teams that ship fast**. It connects to the tools a
team already uses, reads everything into one company memory, and closes the
loop between **what was promised** and **what actually shipped**. The tools
stay the system of record; Orbit is the intelligence layer on top.

The loop: **connectors → memory → detection → drafted fix → human approval →
learning.** Orbit watches on its own (webhooks + scheduled syncs), flags gaps
and drift with evidence, drafts the fix as a real Linear/GitHub ticket, and a
human approves in one click. Nothing executes without a person.

**Hard rules (every feature must honor these):**
- **Honesty**: no fake features, no fabricated links, no simulated success. If
  something isn't implemented its UI says so.
- **Provenance**: every claim, finding and answer carries its source. If Orbit
  can't show where it came from, it doesn't say it.
- **Human-in-the-loop**: Orbit proposes; a person approves. Detection and
  briefs only read and write insights — they never act.
- **Change-proportional cost**: no change ⇒ no model calls. Every expensive
  step (extraction, embedding, chunking, the brief) is gated on real change.
- **Say what Orbit did, not what's true about the world**: "checked every one,
  no new findings" — never "nothing happened."

## Layout

```
orbit-dev/
├── backend/    FastAPI (async) + SQLAlchemy + Alembic + PydanticAI agents
└── frontend/   Next.js (App Router) + Tailwind + TanStack Query
```

## Commands

```bash
# Backend (hot reload; reads backend/.env — NOT watched by --reload, restart after edits)
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload

# Frontend (:3000)
cd frontend && npm run dev

# Checks
cd backend  && ./.venv/bin/ruff check app/    # lint (format on commit via .githooks)
cd frontend && npm run typecheck              # tsc --noEmit
```

Pre-commit hooks (`.githooks/`, enabled via `git config core.hooksPath
.githooks`) run ruff on staged backend files and prettier on frontend.
Migrations are Alembic (`backend/alembic/versions/`, currently at 0020) and
apply automatically at startup — never add columns via create_all alone.

## Backend architecture

Routers (`app/routers/`): `artifacts` (memory + pull), `chat` (streaming agent,
conversations, drafts, ticket approval), `findings` (feed + briefing + approve/
dismiss/edit + heartbeat toggle), `entities`, `goals`, `integrations` (connect/
OAuth/disconnect/MCP), `webhooks` (inbound push), `credits` (beta chat
metering), `feedback`, `internal` (Cloud Scheduler heartbeat).

### The data model (memory infra)

| Table | What it holds |
|---|---|
| `artifacts` | One row per observed item (issue, PR, page, doc, thread, call). Title, full content (≤20K chars), deep-link URL, `meta` (state, assignee, modifiedAt, imageTexts…), the LLM `extracted` JSON, and the **opening embedding** (768-dim, title + first 6K chars). Keyed `(workspace, source, external_ref)` — re-syncs update in place, never duplicate. |
| `artifact_chunks` | Passage vectors for long content: 1,500-char chunks, 200 overlap, max 16 per artifact (~10 pages searchable deep). Rebuilt on content change, hash-guarded (`meta.chunkHash`). |
| `entities` | The structured spine: customers, people, **commitments** (state: open → tracked → delivered), features, **decisions** (first-class, with conflict detection), projects, goals. |
| `links` | Typed, provenance-backed edges: `source_of` (entity ← the artifact it came from), `fulfills` (work item → commitment), `mentions`, `assigned_to`, `belongs_to`, `requested_by`, `supersedes` (decision reversal), semantic neighbours. |
| `memories` | Distilled facts with confidence + lifecycle: embedding-deduped, contradictions supersede (history kept), unused facts decay. |
| `insights` | Findings (`gap | drift | trend | win`) + the company `brief`. Deduped by `dedupe_key`, auto-resolved when no longer true, human status (approved/dismissed) always respected. |
| `user_visits` | Per-member Feed session anchor — powers "While you were away". |
| `workspaces` / `integrations` | Tenancy (Clerk org → workspace) + connector credentials/cursor/sync health. |

### Connectors (`app/services/`)

Two archetypes, one pipeline:

| Connector | Type | Freshness | Notes |
|---|---|---|---|
| Linear | work | **webhook** (auto-registered on connect, needs `admin` scope) + cursor poll | whole ticket as memory text: owner/project/labels/dates/cycle-time + all comments |
| GitHub | work | **webhook** (auto-registered per repo) + cursor poll | PRs enriched: ≤10 file patches (1,200 chars each), ≤20 commits, all comments; 8 repos, 4 fetched concurrently |
| Slack | conversation | poll | threads (root + replies) extract like calls |
| Google Drive | document | poll | Docs/Sheets/Slides text, PDFs (text layer or OCR), standalone images via vision (budget 3/sync) |
| Notion | document | poll | block-tree walk → markdown (12-request budget/sync, depth 3); **image blocks → vision**; **page comments → Discussion**; OAuth (Basic-auth exchange, token never expires) or pasted internal token |
| Confluence | document | poll | storage-XHTML flattened; **`ac:image` diagrams → vision**; **footer comments → Discussion**; Atlassian 3LO (per-tenant cloudId, rotating refresh tokens — always persist the new one) |
| Fireflies / Circleback | meetings | poll / inbound webhook | transcripts with attendee emails (strongest person-unification signal) |

Shared behavior (all connectors):
- **First sync**: last **3 days** only (`_INITIAL_BACKFILL_DAYS`) — learn as you
  go; images skipped on first sync; cursor grows the window forward.
- **Cursor** anchored to fetch-time − 5 min overlap; a 24h+ gap triggers a full
  reconcile pass that also detects deletions (live probe, proof required).
- **Change classifier** (work items): content identical → nothing; tail changed
  → rebuild chunks only; first-6K window changed → re-embed opening vector.
  Docs: `modifiedAt` + `known` map skip unchanged pages before download.
- **Images/diagrams**: markdown-embedded images are read by the vision model
  (`_fold_images`) with per-URL caching in `meta.imageTexts` and a per-sync
  budget; auth is only ever sent to allowlisted hosts (`vision._AUTHED_HOSTS`),
  every fetch is SSRF-guarded.
- **Parallel fetch, serial apply**: all connectors prefetch concurrently
  (`pull_all`), then apply one at a time (shared entity graph).
- Webhooks land at `POST /webhooks/{key}?token=…` (per-workspace token, HMAC
  verified for GitHub/Linear), debounced, and trigger a targeted pull.

### Ingestion pipeline (per new artifact, in `ingest_artifact`)

1. **Extraction** — one LLM call → summary, commitments, requests, decisions,
   entities (work commitments only; personal promises are explicitly excluded).
2. **Opening embedding** — eager, on the write path (retrieval stays read-only).
   768-dim Gemini (`gemini-embedding-001` dev / `gemini-embedding-2` prod;
   vector spaces are incompatible — `workspaces.embedding_model` tracks each
   workspace's space and startup self-heals a mismatch by clearing for re-embed).
3. **Chunks** — content beyond 6K chars, as above.
4. **Graph** (`model.build_from_artifact`) — entities resolved (find-or-create
   by normalized name), links with provenance, deterministic ownership edges
   from work-item meta (no LLM), **decisions promoted to entities** with a
   one-shot LLM conflict judge (`decision-judge`) that links `supersedes` only
   on a genuine reversal (bias: when in doubt, no conflict).
5. **Memory facts** (`memory.derive_from_artifact`) — confidence + lifecycle.

Then once per sync tick (not per artifact): commitments matched against **open**
work only (closed work is never retroactive proof — delivery must be an
observed open→completed transition), detectors run, brief regenerates **only
if the findings set changed** (fingerprint gate).

### Detection (`reasoning.detect_findings`) → the Feed

Deterministic detectors over the spine, re-derived every scan so findings are
always current and explainable: untracked commitments (gap, with a drafted
Linear action), delivered commitments (win), repeated demand (trend),
unrequested-work clusters (drift, Linear-only by design — flagging every PR
would be noise), stale PRs (drift), blocked projects, tracked-but-stalled
promises, MCP knowledge gaps, **decision conflicts** (drift). `_upsert` dedupes
by key, respects human dismissals, resolves stale findings.

**The briefing** (`GET /feed`): "Needs you" (stakes-ranked open findings, max
3: broken promises first, then due dates and named customers), "While you were
away" (per-member session delta via `user_visits`: new findings, shipped/new
promises, honest read-counts — verdict only after reasoning finished), and an
earned all-clear.

### Chat (`agents/orbit_agent.py`)

Streaming PydanticAI agent, request-budgeted (FilteredToolset reserves the
final call; `_finalize` answers from gathered evidence if the budget runs out).
Standing context injected every turn: recalled memory facts + open Feed
findings (chat and Feed share one brain). Tools: hybrid search (pgvector
semantic + language-agnostic keyword incl. CJK, fused by reciprocal rank, with
matched-passage evidence), `read_item`, `latest_activity` (with staleness
warning), `person_work`, `graph_neighbors`, `memory_stats`, `learned_facts`,
`pull_connector` (self-pull when a connector's cursor is stale — covers the
polling connectors), `draft_ticket` → approve → real Linear/GitHub issue,
`remember_fact`, and DuckDuckGo web search (world facts only, never company
questions, always attributed). Citations carry deep links per source
(`lib/sources.ts` maps `notion-page`/`confluence-page`/etc. to logos).
Answers follow the navbar language; one credit per answered question
(`user_credits`, per person per workspace).

### Learning

Human edits/dismissals of findings and drafts become `Feedback` rows, rendered
as directives into every future generation and chat turn. The memory engine
supersedes rather than duplicates. Orbit never trains models on customer data.

## Frontend

`frontend/src/app/(app)/`: `feed` (briefing + findings + drawer + sync
theater), `chat` (streaming, citations, draft cards, credits), `memory`
(artifacts/entities browser + theater), `connectors` (catalog, OAuth/token
connect, honest last-sync), `settings`. Data via TanStack Query
(`lib/hooks.ts`); types in `lib/types.ts` mirror the backend's camelCase.
Branding via `OrbitMark` (no white tiles on logos — `bare` prop). The Feed
refetches itself when a sync finishes.

## Conventions

- **Comments: only important ones** — constraints, whys, protocols, gotchas.
  No narration, no decorative markers.
- Backend schemas serialize **camelCase** (`alias_generator=to_camel`).
- No `window.confirm` — use the shared `ConfirmDialog`.
- Never commit `.env`; secrets live in Secret Manager in prod.
- Commit/push only when the owner explicitly asks.

## Configuration (backend/.env)

| Var | Effect |
|---|---|
| `ENABLE_AI` | real model calls vs deterministic fallbacks |
| `ENVIRONMENT` | `production` → refined models; else dev free-tier defaults |
| `DEFAULT_MODEL` / `AGENT_MODEL` / `EXTRACTOR_MODEL` | `provider:name` overrides |
| `LLM_API_KEY` | provider key |
| `DATABASE_URL` | Postgres (pgvector) in prod; SQLite works for dev — **prefer local DB in dev, pointing dev at Supabase burns egress** |
| `PUBLIC_API_URL` | enables zero-touch webhook auto-registration on connect (must be https) |
| `LINEAR/GITHUB/SLACK/GOOGLE/NOTION/CONFLUENCE_CLIENT_ID/SECRET` + `*_REDIRECT_URI` | per-connector OAuth (redirect URIs must match the app exactly) |
| `HEARTBEAT_ENABLED` / `HEARTBEAT_INTERVAL_MINUTES` | in-process loop (off by default; prod uses Cloud Scheduler → `POST /internal/heartbeat`) |
| `SCHEDULER_JOB` | lets the auto-sync toggle pause/resume Cloud Scheduler itself |
| `CLERK_JWKS_URL` / `CLERK_ISSUER` | auth (dev without them = demo principal) |
| `RESEND_API_KEY` / `ALERT_EMAIL` | credit-request alerts (falls back to filing in Linear) |

## Gotchas (things that have bitten us)

- `uvicorn --reload` does **not** watch `.env` — restart after changing it.
- Switching `EMBEDDING_MODEL` invalidates vectors — the startup guard re-embeds;
  never null vectors by hand.
- SQLAlchemy `defer()` on shared-session objects breaks async paths far from
  the query (MissingGreenlet) — column-scope with Core queries instead.
- Notion's block budget is shared per sync: one enormous page can defer other
  pages' bodies to the next tick (by design).
- Confluence refresh tokens rotate — losing the new one forces a reconnect.
  Comment/attachment ingestion needs the newer scopes; older tokens skip
  gracefully until reconnected.
- Docs re-ingest on edit refreshes content + vectors but does **not** re-run
  extraction — a commitment added by editing an existing page isn't tracked
  until re-ingest (known gap).
- Alembic runs at startup; a busy table can defer a migration to next boot.
- Webhook tokens are per-workspace — mint them for the workspace being viewed.
- Gemini `-latest` aliases resolve to newer (pricier/limited) models — pin
  exact models in dev.
