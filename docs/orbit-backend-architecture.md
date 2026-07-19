# Orbit Backend — Complete Design (diagram-first, with low-level internals)

*Accurate as of 2026-07-19. One FastAPI monolith · SQLite dev / Postgres+pgvector prod · no queues, no microservices. Part I is the map; Part II is every screw and bolt.*

---

# PART I — THE MAP

## 0. HLD — the whole system on one screen

```
                 EXTERNAL TOOLS (systems of record — Orbit never replaces them)
      ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌────────┐
      │  Linear  │   │  Slack   │   │  GitHub  │   │ Google Drive │   │ Gemini │
      └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬───────┘   └───┬────┘
           │ OAuth+refresh│ OAuth        │ OAuth/PAT      │ OAuth+refresh │ LLM+embed APIs
  ═════════╪══════════════╪══════════════╪════════════════╪═══════════════╪══════════
           ▼              ▼              ▼                ▼               │
      ┌─────────────────────────────────────────────────────────┐        │
      │ CONNECTOR LAYER  (one shared interface, one vocabulary) │        │
      │ services/linear.py · slack.py · github.py · google_drive│        │
      └───────────────────────────┬─────────────────────────────┘        │
                                  │ raw items (issues, PRs, threads, docs)
                                  ▼                                      │
      ┌─────────────────────────────────────────────────────────┐        │
      │ INGESTION  services/ingestion.py                        │◀───────┤ extract+vision (lite model)
      │ dedup → Artifact → vision → extract → embed → graph →   │        │ embed (embedding model)
      │ facts   (vision: images/scanned PDFs read into text)    │        │
      └───────┬──────────────┬──────────────┬───────────────────┘        │
              ▼              ▼              ▼                            │
      ┌───────────┐   ┌────────────┐   ┌──────────────┐                  │
      │ ARTIFACTS │   │ GRAPH      │   │ MEMORY FACTS │                  │
      │ raw+vector│   │ Entities + │   │ confidence + │                  │
      │ provenance│   │ Links      │   │ lifecycle    │                  │
      └─────┬─────┘   └─────┬──────┘   └──────┬───────┘                  │
            └───────────────┼─────────────────┘                          │
                            ▼                                            │
      ┌─────────────────────────────────────────────────────────┐        │
      │ REASONING  services/reasoning.py · analytics.py         │◀───────┤ brief/proposals/chat
      │ 7 detectors → Findings · brief agent · live stats       │        │ (smart model, thinking)
      └───────────────────────────┬─────────────────────────────┘        │
                                  ▼                                      │
      ┌─────────────────────────────────────────────────────────┐        │
      │ SURFACES (FastAPI routers → Next.js frontend)           │        │
      │ /feed  /chat(SSE)  /entities  /artifacts  /integrations │        │
      └───────────────────────────┬─────────────────────────────┘        │
                                  │ approve / dismiss / edit             │
                                  ▼                                      │
      ┌──────────────────┐   ┌──────────────────────────────────┐        │
      │ ACTION (write)   │   │ LEARNING  services/learning.py   │────────┘
      │ create Linear    │   │ corrections → vectors → injected │
      │ issue (approved) │   │ into every future generation     │
      └──────────────────┘   └──────────────────────────────────┘

      ⏱ HEARTBEAT (services/heartbeat.py) drives the left side every tick
      🔐 Clerk JWT → workspace_id on every request; ALL tables tenant-keyed
```

---

## 1. Flow A — a ticket becomes intelligence (sync path, start to finish)

What happens when the heartbeat ticks (env `HEARTBEAT_INTERVAL_MINUTES`) or you hit Connect / "Scan now":

```
 HEARTBEAT TICK (per workspace)
 │
 ├─▶ 1. pull_all() — FIRST connect: a 20-day backfill window (recent history, not
 │      years — the cursor grows it forward). Thereafter INCREMENTAL: each connector
 │      keeps a cursor (sync_state) and fetches only items changed since; a FULL pass
 │      every 24h reconciles deletions — Linear by complete-listing diff; GitHub/Drive
 │      by LIVE existence probes on items missing from their capped listings (gone/404
 │      → stale · merged/closed outside the window → state fixed · still there
 │      → untouched; ≤50 probes/night, shuffled; transient errors never stale)
 │      Linear: all open + recent completed issues (+50 comments each)
 │      GitHub: 15 repos × PRs/issues; ALL discussion comments on every item (issues
 │              AND PRs, paginated); open PRs also get reviews+stats
 │      Slack:  threads (root+replies) from bot channels (+permalinks, +image files)
 │      Drive:  30 latest Docs→text / Sheets→CSV / Slides→text / Office
 │              .docx·.xlsx·.pptx→text (python-docx/openpyxl/python-pptx) / PDFs
 │              — text layer via pypdf, scanned PDFs OCR'd by the vision (lite)
 │              model (3/sync) / standalone images read by vision; unchanged files
 │              are never re-downloaded or re-read (modifiedTime memo); hourly token
 │              auto-refresh
 │
 ├─▶ 2. per item — INGESTION
 │      ┌ seen before? ──yes──▶ refresh in place (content/meta/graph/facts re-derived)
 │      └ no ▼
 │        Artifact row        (provenance: source, external_ref, deep-link URL, meta)
 │        Vision (lite LLM)   → images in descriptions/comments/attachments are
 │                              downloaded (connector auth) and READ — visible text
 │                              + one line on what a chart/screenshot shows — then
 │                              folded into content BEFORE extract/embed, so image
 │                              knowledge reaches search, facts and chat. Each image
 │                              is read ONCE (cached in meta.imageTexts, keyed sans
 │                              URL signature); ≤5 reads/connector/sync; dead links
 │                              cached so they never burn budget again
 │        Extractor (lite LLM)→ summary · commitments · requests · decisions · entities
 │        Embed               → 768-dim vector (eagerly; NULL if quota — backfill heals)
 │        Graph (no LLM)      → Person ─assigned_to→ Item ─belongs_to→ Project
 │                              Person ─works_on→ Project        (bots filtered: is_bot)
 │        Facts               → memory.record() per fact (see Flow C)
 │        Commitment matching → token → fuzzy → embedding ≥0.75 → "fulfills" edge
 │
 ├─▶ 3. backfill embeddings   (≤300 artifacts + ≤100 facts with NULL vectors — self-heal)
 ├─▶ 4. decay facts           (unverified 90d → −0.15 conf → ≤0.35 marked stale)
 ├─▶ 5. detect_findings()     — 7 deterministic detectors over graph+artifacts:
 │        gap    promised-but-untracked commitment (+ prepared Linear issue draft)
 │        win    commitment's issue completed → auto-advance, suggest telling customer
 │        trend  same feature requested by ≥2 customers
 │        drift  ≥3 in-progress items tied to no request
 │        drift  non-draft PRs open ≥7 days
 │        drift  INFERENCE: blocked PR/issue → its PROJECT has blocked work
 │        drift  INFERENCE: tracked commitment blocked/stalled 14d → customer promise at risk
 ├─▶ 6. refresh Brief if stale (analyst agent over open findings)
 └─▶ 7. draft proposals for new high-priority findings (product-agent, ≤3/tick)
        ⚠ NOTHING here executes actions — humans approve on the Feed.
```

---

## 2. Flow B — a chat question, start to finish

```
 user types "what is our MRR?"  (frontend → POST /chat/stream, SSE)
 │
 ├─ auth: Clerk JWT → workspace_id · conversation loaded (private to this user)
 │
 ├─ INTENT FORK (before answering):
 │    • "create a ticket for X" (actionable) → draft a ticket, stream a `draft` card,
 │      skip retrieval  (Phase 1 — see §15b; approve → services/tickets → real issue)
 │    • otherwise → answer path below
 │
 ├─ CONTEXT ASSEMBLY (_build_context) ── one prompt from seven blocks:
 │    ① CONVERSATION SO FAR   last 8 turns (resolves "it/they"; never a fact source)
 │    ② MEMORY STATS          computed counts — issues open/done per person, PR stats,
 │                            avg cycle time. SQL-style math, never LLM-guessed numbers
 │    ③ GOALS + OPEN SIGNALS  declared intentions + current findings
 │    ④ GRAPH CONTEXT         2-hop neighborhood of the entity the question names
 │                            (who works with whom, what belongs where — traverse())
 │    ⑤ LEARNED FACTS         top-6 memory facts, ranked
 │                            0.5·similarity + 0.25·confidence + 0.15·recency + 0.10·importance
 │                            (+ superseded ones if the question sounds historical)
 │    ⑥ EVIDENCE              top-8 artifacts by retrieval  ┐ vector (cosine ≥0.75)
 │                            + up to 15 actual work items  │ ↓ falls through when vague/unembedded
 │                            if a person is named          ┘ keyword+recency (stopword-filtered)
 │    ⑦ DIRECTIVES            past human corrections relevant to THIS question
 │                            (vector match, appended to the SYSTEM prompt)
 │
 ├─ SELF-DECIDE-TO-PULL (Phase 2): nothing retrieved (no hits, no stats)?
 │    → pick the connected tool most likely to have it → phase:"pulling" ("Checking
 │      Linear…") → run its pull → re-assemble context → continue
 │
 ├─ GENERATION (SSE events streamed to UI)
 │    phase:"retrieving" → phase:"reasoning"
 │    smart model with include_thoughts
 │       ├─ thinking:* deltas   → UI "Thinking…" trace (collapses to "Thought for Xs")
 │       └─ delta:* tokens      → UI typewriter
 │    ✚ resilience: primary dies with no text? retry once on lite model
 │    ✚ still nothing? deterministic fallback (stats + top memory list) — never crashes
 │
 ├─ PROACTIVE OFFER (Phase 3): a trackable statement + the team has the ticket habit?
 │    → attach a `draft` card flagged proactive ("Suggested ticket")
 │
 └─ FINISH
      citations = evidence actually referenced (by identifier/title match, else top-3)
      done:{conversationId, citations[{source,title,url}], grounded, draft?}
      conversation persisted · UI renders connector-logo chips with deep links
```

---

## 3. Flow C — the memory fact lifecycle (the self-updating part)

Every fact lives in exactly one state; `memory.record()` is the only writer:

```
                       incoming fact  (from sync or extraction)
                                 │
              ┌──────────────────┼──────────────────────┐
              ▼                  ▼                       ▼
   cosine ≥0.90 or        same SLOT, different     genuinely new
   exact-text match       content (e.g. issue      ─────────────▶  NEW FACT
   ("same fact")          reassigned)                              status: active
        │                        │                                 conf: 0.7–0.9
        ▼                        ▼
   REINFORCE               SUPERSEDE
   conf +0.05 (cap 1.0)    old fact → status: superseded
   last_verified = now         + full version history kept
                           new fact → active in the slot
                           (Q: "who owned X last month?" still answerable)

   ⏳ DECAY (heartbeat): last_verified > 90 days → conf −0.15/window
                         conf ≤ 0.35 → status: stale     (NEVER auto-deleted)
```

Where facts come from (no extra LLM cost — derived from data already fetched):
- **assignment** — work-item meta, slot = the item id → reassignment supersedes
- **blocker** — GitHub review CHANGES_REQUESTED on an open PR; auto-resolves when merged
- **decision** — Extractor output from any source (issues, threads, docs)
- **context** — repo contributors (bots excluded)

---

## 4. Flow D — the self-improve loop (learning, no fine-tuning)

```
   human acts on the Feed / edits a draft
   ├─ dismisses a finding  ──▶ Feedback row: "dismissed X (reason)"
   └─ edits title/desc     ──▶ Feedback row: "before → after"
                    │
                    ▼  vectorized at write (embedding on the Feedback row)
   ┌────────────────────────────────────────────────────────────┐
   │            CORRECTIONS STORE (permanent, per-workspace)    │
   └───────┬──────────────┬───────────────┬─────────────────────┘
           │ two retrieval modes: RECENT (no query) · RELEVANT (vector match)
           ▼              ▼               ▼
      Extractor      issue-writer     chat / brief / product-agent
      (reading       (drafting in     (answering with your
       style)         your style)      preferences applied)

   effect examples:
   · dismiss "renovate PR noise" once  → future briefs stop flagging it
   · rewrite one issue title           → future drafts imitate the style
   · effective on the very next generation — no training, no deploy
```

Plus the second improvement channel — **memory itself**: every sync reinforces
true facts, supersedes changed ones, decays unverified ones (Flow C). The system
gets more accurate by running, even with zero human feedback.

---

## 5. Data model — 11 tables

| Table | Holds | Key detail |
|---|---|---|
| `workspaces` | tenant boundary | every table below carries `workspace_id` (= Clerk org) |
| `artifacts` | raw memory items | content + meta + Extractor output (`extracted`) + 768-dim vector + deep link · identity `(workspace, source, external_ref)` |
| `entities` | graph nodes | person/project/customer/commitment/feature/goal · `normalized_name` + `aliases` + `identifiers` · `state` (open/tracked/delivered) |
| `links` | typed graph edges | assigned_to/created/works_on/belongs_to/fulfills/made_to/requested_by/source_of/mentions · each has `source_artifact_id` (evidence) |
| `memories` | distilled facts | `confidence` · `importance` · `status` (active/superseded/stale) · slot = (`subject`,`kind`) · `history[]` · `superseded_by` · `last_verified_at` · vector |
| `insights` | findings + brief | `entity_ids`+`artifact_ids` (evidence) · prepared `action` · `evidence["proposal"]` · `dedupe_key` · status open/dismissed/approved/resolved |
| `goals` | declared intentions | what drift is measured against |
| `feedback` | corrections | section/field/before/after + vector (the learning store) |
| `integrations` | connector creds + cursors | composite PK `(workspace_id, key)` · `credentials` JSON · `sync_state` {cursor,lastFull} |
| `chat_conversations` | Ask-Orbit history | private per `(workspace_id, user_id)`; messages as JSON — an assistant message may carry a `draft` (the in-chat ticket + its status/result) |
| `activity_events` | audit trail | every autonomous act ("scanned", "drafted") is logged |

---

## 6. Agents & models — 8 prompts, 2 runtime models, 1 registry

No agent framework — PydanticAI calls with **typed outputs** (`NativeOutput` constrained decoding → reliable JSON, `retries=3`; plain-text streaming agents use `retries=2`), behind a provider registry (`google / anthropic / openai / ollama`; switching = one env line, agents never name a provider).

| Prompt | Consumes | Produces | Model |
|---|---|---|---|
| `extractor` | one artifact | summary/commitments/requests/decisions/entities | **lite** (high-volume) |
| `intelligence-brief` | open findings | executive brief | smart |
| `issue-writer` | a commitment + corrections | Linear issue draft in team style | smart |
| `product-agent` | a finding + evidence | reviewable proposal | smart |
| `orbit-chat` | context blocks | answer + citation ids (JSON) | smart |
| `orbit-chat-stream` | context blocks | streamed markdown + thinking | smart |
| `vision` doc / image (services/vision.py) | a PDF or image binary | transcription / visible text + what it shows | **lite** |

`DEFAULT_MODEL=gemini-3-flash-preview` (reasoning, thinking traces) · `EXTRACTOR_MODEL=gemini-flash-lite` (bulk — can't starve reasoning quota) · embeddings `gemini-embedding-001` at 768 dims with a 60s circuit breaker on 429.

**Degradation ladder — nothing ever crashes:**
`smart model → (chat) retry on lite → deterministic fallback (stats + memory list) → AI off? deterministic everything`

---

# PART II — LOW-LEVEL INTERNALS

Everything below is function-level, with the exact constants and algorithms in the code today. File paths are relative to `backend/app/`.

## 7. Heartbeat (`services/heartbeat.py`)

- Started in the FastAPI lifespan (`start()`); a single `asyncio.Task` running `_run_forever()`: sleep `_STARTUP_DELAY_S = 20` (let migrations/seed settle), then loop `_tick()` every `max(60, heartbeat_interval_minutes * 60)` seconds. A failed tick logs and continues — the loop never dies.
- **`_tick()` order per workspace** (skipped entirely if an immediate sync is already active for that workspace — no double work / write contention):
  1. `pull_all()` (Observe; failure → "reasoning on existing memory")
  2. `ingestion.backfill_embeddings(limit=300)` + `memory.backfill_embeddings(limit=100)`
  3. `memory.decay()`
  4. `reasoning.detect_findings()`
  5. brief refresh — only if the workspace has ≥1 artifact AND the latest model-origin brief is older than `BRIEF_MAX_AGE_DAYS = 7` (`_brief_is_stale`)
  6. `proposals.dispatch_for_workspace()` (Act — drafts only)
  7. one `ActivityEvent(action="scanned")` if any findings are open
- **`run_now(ws, trigger)`** — the immediate path (Connect, "Scan now", webhooks). Same steps, but streams coarse progress into the module-level `_sync[ws]` dict (`phase`: reading → reasoning → done/error, plus counts) which the UI polls via `heartbeat.status(ws)`; chat also reads it to answer "I'm still reading your company" during a first sync. Guarded: a second `run_now` while one is active returns immediately.
- `set_enabled()` toggles auto-sync at runtime (session-level); manual pulls bypass the toggle.

## 8. Connectors — auth, caps, and cursors

**Shared contract**: every connector module exposes `get_auth(db, ws) → str|None` (an `Authorization` header value), `oauth_configured/oauth_url/exchange_code/account_name`, and its fetchers take `since: str|None`. Everything downstream is auth-mode agnostic. All fetch failures raise; `pull_*` catches, logs, and returns an honest 0.

**Linear (`services/linear.py`)**
- Two auth modes: personal API key (raw header value) or OAuth (`Bearer <token>`).
- **Expiring OAuth tokens (2026-07-18)**: `exchange_code` returns `{accessToken, refreshToken, expiresAt}` when Linear supplies a refresh token (expiry defaults to `expires_in` or 86400s, minus 60s skew); `get_auth` auto-refreshes when `time.time() >= expiresAt` and persists the ROTATED refresh token. A failed refresh keeps the old token so the sync's own error handling reports it. Connections made before this fix have no refresh token and must be reconnected once.
- `_gql` always sends `public-file-urls-expire-in: 86400` — `uploads.linear.app` rejects ALL API auth headers, so image URLs in issue markdown must come back pre-signed to be downloadable at all (signed for 24h, re-signed on every fetch — see §11 image cache keys).
- Caps: `_MAX_OPEN = 2000` open issues (paginated fully), `_MAX_COMPLETED = 500` recent completions, 50 comments per issue. `_with_since` merges `{"updatedAt": {"gt": since}}` into the GraphQL filter.

**GitHub (`services/github.py`)**
- PAT paste or OAuth; both become `Bearer <token>`.
- `fetch_work(auth, since)`: `_MAX_REPOS = 15` most-recently-pushed repos × `_PER_REPO = 100` PRs + 100 issues (`state=all`, sorted by `updated` desc; the issues endpoint interleaves PRs — filtered by the `pull_request` key). The page ceiling is high on purpose — the sync **time window** (20-day cold start, then cursor) is the real bound, not a count. PRs use a client-side cutoff on `updatedAt > since`; issues use the API-native `since` param. **Every item — issue OR PR — gets its full discussion** via `_fetch_comments` (paginated, ≤`_COMMENTS_MAX = 200`; a 0-comment item skips the call). Image links in comment bodies are OCR'd downstream. Open PRs additionally get `_enrich_pr` (detail stats: additions/deletions/changedFiles/commits · ≤10 reviews), capped `_ENRICH_PER_REPO = 20`. Top `_CONTRIBUTORS_PER_REPO = 10` contributors per repo, refreshed on FULL syncs only.
- `item_state(auth, "owner/repo#n", is_pr)` — the reconcile probe: GET `/repos/{repo}/{pulls|issues}/{n}`; status 301/404/410/451 ⇒ `None` (gone — 301 means the repo was renamed, so the old ref is dead and the new name syncs as new artifacts); 200 ⇒ `"merged"` (merged_at set) / `"closed"` / `"open"`; anything else raises (rate limit ≠ deletion).

**Slack (`services/slack.py`)**
- OAuth only; scopes `channels:history, channels:read, groups:history, users:read, files:read` (files:read added for image attachments — pre-existing connections must reconnect to grant it).
- `list_channels`: channels the bot is a member of (public+private, ≤200). `fetch_threads(auth, channel, history_limit=200, max_threads=50, oldest=None)`: only rooted threads (`reply_count ≥ 1`, subtypes skipped); each thread = root + all replies joined by blank lines, plus `files` = image attachments (`mimetype image/*`, `url_private`) from every message in the thread. Caps are generous because the `oldest` window (the ISO cursor as an epoch string) is the real bound on volume.
- Deep links: `permalink(team_url, channel, ts)` = `{team}/archives/{channel}/p{ts-sans-dot}` — constructible from stored meta, so FULL syncs backfill missing permalinks on old threads with zero API calls.

**Google Drive (`services/google_drive.py`)**
- Access tokens expire HOURLY: credentials persist `{accessToken, refreshToken, expiresAt}` (`expires_in − 60s` skew); `get_auth` refreshes in place and flushes (caller commits). Authorize with `access_type=offline&prompt=consent` (Google only issues a refresh token on explicit consent).
- `fetch_documents(auth, since, known) → (docs, listed_ids)`: one query over Google-native mimes + PDF + PNG/JPEG/WebP, `orderBy=modifiedTime desc`, `pageSize = _MAX_FILES = 30`, optional `modifiedTime > since`. The `known` map (file id → modifiedTime already in memory) means **unchanged files are listed (for reconcile) but never re-downloaded/re-exported/re-OCR'd**.
  - Google Docs → `text/plain` export · Sheets → `text/csv` · Slides → `text/plain`; clipped to `_EXPORT_CLIP = 20000` chars.
  - **Uploaded Office files** (`_OFFICE_MIME`, ≤15MB): downloaded raw (not exportable) and parsed by `_office_text` — `.docx` via python-docx (paragraphs), `.xlsx` via openpyxl (cells as CSV per sheet), `.pptx` via python-pptx (slide text). Mapped to the **same source as their Google-native cousin** (`gdrive-doc`/`gdrive-sheet`/`gdrive-slides`) — a doc is a doc regardless of format. Empty/unparseable → skipped.
  - PDFs (≤ `_PDF_MAX_BYTES` 15MB): pypdf text layer first; if under `_PDF_MIN_TEXT = 200` chars it's scanned → `vision.transcribe` (budgeted); still under 200 → skipped honestly, retried next sync. Source `gdrive-pdf`, `ocr` flag when vision produced the text.
  - Images → `vision.transcribe` directly (source `gdrive-image`; any non-empty text accepted).
  - Shared vision budget `_VISION_PER_SYNC = 3` per pull.
- `file_exists(auth, file_id)` — reconcile probe: `files.get(fields=id,trashed)`; 404 or `trashed:true` ⇒ False; other non-200 raises (deletion needs proof, not doubt).

**Cursors & reconcile (`services/ingestion.py`)**
- `Integration.sync_state = {"cursor": iso, "lastFull": iso}`. `_sync_plan`:
  - **first connect (no cursor)** ⇒ `since = now − _INITIAL_BACKFILL_DAYS (20)` — a bounded cold start, so connecting doesn't ingest years of history in one tick; the cursor then grows the corpus forward.
  - **cursor set, `lastFull` older than `_FULL_SYNC_EVERY_HOURS = 24`** ⇒ `since = None` (a FULL reconcile that also catches deletions).
  - **otherwise** ⇒ the cursor (incremental).
  `_advance_cursor` sets `cursor = now − _CURSOR_OVERLAP_MINUTES (5)` — the overlap re-reads a small window, and dedup makes overlap free. It also sets `lastFull` on the FIRST advance (not just full passes), so the tick right after the initial backfill stays incremental instead of immediately running a full reconcile. Net effect: a fast, recent cold start; steady incremental growth; a daily full reconcile that both catches deletions and fills in still-open work older than the 20-day window (Orbit accumulates more context over time).
- **Reconcile runs only on FULL syncs**:
  - *Linear*: its open-issue fetch is complete, so any locally-open artifact missing from the fetched set (and not completed/canceled) → `status="stale"` directly.
  - *GitHub / Drive*: listings are capped, so absence proves nothing. Open artifacts missing from the listing are probed live (`item_state` / `file_exists`), shuffled, capped at `_RECONCILE_CHECKS = 50` per source per pass: gone → stale; GitHub merged/closed outside the window → `meta.stateType` corrected to completed; still-open/existing → untouched. Probe errors skip the item.
  - *Slack*: not reconciled (threads have no open state; a deleted message simply stops being cited).

**Sync health / self-healing reconnect (`_note_sync_health`)** — a dead credential no longer fails silently. When a pull throws an **auth-looking** error (`_AUTH_SIGNALS`: 401 / unauthorized / invalid_auth / missing_scope / invalid_grant / token refresh failed — deliberately **not** 403, which GitHub uses for rate limits), a `connected` integration flips to `status="reconnect"` and the Integrations UI shows a "Session expired · Reconnect" affordance. A subsequent clean pull flips it back to `connected`, so a transient error that trips it never sticks. This makes the one-time re-auth (a new OAuth scope, or a pre-existing token with no refresh token — neither of which any code can conjure) **visible and actionable** rather than a silent zero.

## 9. Webhooks (`routers/webhooks.py`, `routers/integrations.py`)

- `GET /integrations/{key}/webhook` (authed) mints `credentials.webhookToken` (`secrets.token_urlsafe(24)`) once and returns `{PUBLIC_API_URL}/webhooks/{key}?token=…`. For GitHub the same token doubles as the HMAC secret.
- `POST /webhooks/{key}?token=…` (unauthed by design — the token IS the auth): resolves the Integration by `(key, webhookToken)`; Slack's `url_verification` challenge is echoed; GitHub payloads verified with HMAC-SHA256 over the raw body against `X-Hub-Signature-256` (`hmac.compare_digest`). Valid events trigger `heartbeat.start_sync(ws, "{key}-webhook")` behind a per-workspace `_DEBOUNCE_SECONDS = 30` (a burst of pushes = one sync). Linear/Slack hook registration is manual (their dashboards); dev needs a public URL (ngrok).

## 10. Ingestion core (`services/ingestion.py`)

- **`ingest_artifact()`** — the single write path for new memory: dedup lookup by `(workspace, source, external_ref)` (existing row returned untouched) → `Artifact` row (`status="observed"`, title[:300]) → `extract()` on the lite model with `render_corrections()` prepended (`status="extracted"`) → eager embedding of `_embed_input = title + content[:2000]` (NULL on quota — backfill heals; defined once so ingest/backfill/query embed identically) → commit → `model.build_from_artifact` (graph) → `memory.derive_from_artifact` (facts) → commit.
- **Refresh-in-place** (existing rows on re-sync): `content`, `meta`, `occurred_at` are rewritten from the fresh fetch; `link_work_entities` and `derive_from_artifact` re-run (so reassignments supersede old facts); the **embedding is deliberately left as-is** to avoid a re-embed storm.
- **`backfill_embeddings(limit=100)`** (heartbeat calls with 300): embeds artifacts with NULL vectors, bounded per tick, background-only so retrieval stays read-only.
- **`pull_linear/github/gdrive/slack`** all follow the same skeleton: get_auth → `_sync_plan` → fetch(since) → per item (refresh | ingest) → reconcile (full syncs) → `_advance_cursor` → commit → `match_open_commitments` (a new issue may fulfill an old commitment). GitHub additionally folds contributors into Person entities + `works_on` links + `context` facts (subject `contrib:{repo}:{login}`, bots excluded).

## 11. Vision (`services/vision.py` + `ingestion._fold_images`)

- `transcribe(data, mime, name)` — the ONE binary→text seam. Guards: `settings.ai_enabled`, non-empty, ≤ `_MAX_BYTES = 8MB` (base64 inflates ~33% toward the 20MB inline request limit). Two prompts: `_DOC_PROMPT` (pure transcription, tables as aligned lines) for PDFs, `_IMAGE_PROMPT` (verbatim visible text + one line on what a chart/screenshot shows) for `image/*`. Runs on the extractor model, `retries=1`, returns `""` on any failure — callers skip honestly.
- `fetch_image(url, auth)` — downloads with the connector's Authorization header passed through (Linear/Slack private uploads need it), follows redirects, and returns `None` unless the response is really a supported image (`png/jpeg/webp/heic/heif` by content-type — an HTML login page or SVG badge never reaches the model) within the size cap.
- **`_fold_images(content, auth, prev, budget)`** — for Linear + GitHub items: regex `!\[…\](url)` over the composed content (descriptions + comments), first 5 unique URLs. Cache key = **URL without its query string** (Linear re-signs URLs on every fetch; the base identifies the image). For each URL: cached in `prev` (= existing `meta.imageTexts`) → reuse; else spend budget (`_IMAGES_PER_SYNC = 5` per connector per pull, shared mutable `[int]`), download+transcribe, clip to 800 chars. Download failures cache as `""` (dead links never burn budget again); transcribe failures (likely quota) stay uncached and retry next sync. Non-empty texts render an `Images:` block appended to content **before** extraction/embedding, and the map persists to `meta.imageTexts`.
- Slack images go through the same fetch/transcribe path per thread file (≤5/thread) at creation time only — threads don't refresh.
- **Re-embed on new image text** (`_reembed_if_images_changed`): a routine refresh never re-embeds (that would be a per-tick storm across the whole backlog), but when `_fold_images` reads a *new* image on an already-embedded artifact (`imgs != prev_imgs`), that one artifact is re-embedded so its image content becomes semantically searchable — not just present in the LLM context. Rare by construction (only the tick that actually read a new image), so no storm.

## 12. Memory engine (`services/memory.py`)

Constants: `_MERGE_SIM = 0.90` · `_STALE_FLOOR = 0.35` · `_DECAY_AFTER_DAYS = 90` · `_DECAY_STEP = 0.15`.

- **`record(fact, kind, subject, …, importance, base_confidence)`** — the only fact writer:
  1. Normalize the slot key (`subject` → lowercase, collapsed whitespace) and embed the fact text.
  2. Load ACTIVE memories of the same `kind` (and same `subject` when given).
  3. **Reinforce**: best cosine against those ≥ 0.90, or exact normalized-text match ⇒ `confidence = min(1.0, conf + 0.05)`, `importance = max(old, new)`, `last_verified_at = now`, provenance updated. Return.
  4. **New fact** otherwise: insert with `base_confidence` (0.7–0.9 depending on derivation), `status="active"`, embedding, provenance (`source_artifact_id`, `source_ref`).
  5. **Supersede**: if the slot was occupied, every previously-active fact in it appends `{fact, confidence, at}` to its own `history[]`, flips to `status="superseded"`, and points `superseded_by` at the new fact. Nothing is ever deleted.
- **`resolve_slot(kind, subject)`** — closes a slot with NO replacement (e.g. a PR's blocker cleared on merge): active facts → superseded with a `resolved: true` history entry.
- **`derive_from_artifact(artifact)`** — deterministic fact derivation, zero extra LLM calls:
  | fact kind | trigger | slot (`subject`) | conf / imp |
  |---|---|---|---|
  | `assignment` | work item (Linear/GitHub) with an assignee, not completed/canceled | the item identifier | 0.9 / 0.7 |
  | `blocker` | open GitHub PR with a `CHANGES_REQUESTED` review; **auto-resolved** via `resolve_slot` when merged/cleared | the PR identifier | 0.9 / 0.8 |
  | `decision` | each Extractor `decisions[]` string | (no slot — dedup by similarity only) | 0.7 / 0.6 |
  | `context` | repo contributors (from `pull_github`) | `contrib:{repo}:{login}` | 0.85 / 0.4 |
- **`decay()`** (heartbeat): active facts with `last_verified_at` older than 90 days lose 0.15 confidence per pass (floor 0.1); at ≤ 0.35 they flip to `stale`. Superseded/stale rows are never touched again.
- **`search(query_vector, k=6, statuses)`** — ranked retrieval:
  `score = 0.5·cosine + 0.25·confidence + 0.15·recency + 0.10·importance`, where recency is linear from 1.0 (now) to 0 at 180 days since last verification. Chat passes `statuses=("active","superseded")` when the question sounds historical.
- `backfill_embeddings(limit=100)`: embeds facts whose write-time embedding failed, both active and superseded.

## 13. Graph & entity resolution (`services/model.py`)

- **`normalize_name`**: lowercase, punctuation→space, trailing corporate suffixes dropped (`inc llc ltd gmbh corp co kk sa srl plc…`) — "Acme Inc." ≡ "acme".
- **`text_match(a, b)`** — the deterministic "same thing?" check used by commitment matching and the drift detector: ≥2 shared significant tokens (len ≥3, stopwords removed) OR `difflib.SequenceMatcher ≥ 0.82` on normalized strings.
- **`resolve_entity(kind, name)`** — find-or-create by normalized name or alias; deliberately conservative (a wrong merge is worse than a duplicate). Merges non-empty `meta` keys on match. Used for customers/projects/features/commitments.
- **`resolve_person(name, email?, handle?)`** — the person-specific resolver that **unifies identity across connectors**. Match order: (1) **email** — the one deterministic key that survives every tool, case-insensitive, stored in `identifiers.emails`; (2) **handle** — e.g. a GitHub login, in `identifiers.handles`; (3) normalized name / alias (weakest, exact-only). On match it *enriches* — folds the new name in as an alias and adds any new email/handle. On an email hit it also **merges legacy duplicates** that share that email via `merge_person` (repoints every edge onto the canonical entity, unions aliases + identifiers, deletes the dup). It never merges on name similarity alone — so `Bharathi Vijaya` (Linear, +email) and a Fireflies/Circleback attendee with the same email collapse into one; a GitHub login with no email stays separate (the honest residual). Wired into `link_work_entities` (Linear name+email / GitHub login-as-handle), `build_from_artifact` (extraction persons + note-taker attendees), and GitHub contributors.
- **`ensure_link`** — idempotent typed edge `(from_type, from_id) —type→ (to_type, to_id)` with `source_artifact_id` as evidence; re-calls merge meta.
- **`link_work_entities`** (no LLM, one vocabulary for all connectors): Person —assigned_to→ Item · Person —created→ Item (when creator ≠ assignee) · Item —belongs_to→ Project · Person —works_on→ Project. `is_bot()` filters automation accounts (`*[bot]` suffix or the `BOT_NAMES` set: renovate, dependabot, github-actions, polar-sync-app, cloudflare-workers-and-pages, figma, mend renovate).
- **`build_from_artifact`** (per extraction): customers/persons mentioned → entities + `mentions` edges; each commitment → entity + `source_of` edge + `made_to` its customer (named "to", else the artifact's primary customer) + immediate `match_commitment_to_linear`; each request → feature entity + `requested_by` every mentioned customer.
- **Commitment ↔ Linear matching**: pass 1 deterministic `text_match` over issue titles; pass 2 vector — embed the commitment name (query task type) and `search_artifacts(sources=["linear-issue"])` with the 0.75 similarity floor, skipping canceled issues. A hit writes the `fulfills` edge (with `via: text|vector`), sets `state="tracked"`, and stamps `meta.linear = {identifier, url}`. `match_open_commitments` re-runs this for every still-open commitment after each pull.
- **`traverse(start_ids, depth=2, edge_types?)`** — BFS over `links` (frontier/visited sets, both directions), returns the edges reached. Python-side; explicitly the seam to swap for a recursive CTE (or a graph DB) at scale — every caller goes through it.
- **`search_artifacts(query_vector, k=8, max_distance=0.25)`** — the vector search primitive. Postgres: native pgvector `<=>` accelerated by the HNSW index, uncapped over all history (the embedding column is `JSON().with_variant(Vector)`, so it's `cast()` to `Vector` to reach the operator). SQLite dev: in-Python cosine over the workspace's embedded rows. Both apply the similarity floor (1 − 0.25 = **0.75**) and never write anything.

## 14. Embeddings (`services/embeddings.py`)

- Gemini `embedding-001` via raw REST, `outputDimensionality = EMBEDDING_DIM = 768`, input clipped to `_MAX_CHARS = 6000`. Asymmetric task types: documents embed as `RETRIEVAL_DOCUMENT`, queries as `RETRIEVAL_QUERY` (`embed_query`).
- **Circuit breaker**: a 429 pauses ALL embedding calls for `_QUOTA_COOLDOWN_S = 60`; `available()` reports False during the pause so every caller (ingest, backfill, search, chat, learning) degrades to keyword/recency instantly instead of firing hundreds of doomed round-trips.
- Every failure path returns `None` — embedding failures must never break ingestion or retrieval.

## 15. Chat (`routers/chat.py`)

Constants: `_TOP_K = 8` · `_MAX_SCAN = 3000` (keyword-fallback window) · `_HISTORY_TURNS = 8` · `_HISTORY_CLIP = 600` chars/message.

- **Retrieval (`_retrieve`)**: embeddings available → embed the question (query task) → `search_artifacts` (floor 0.75). Otherwise (AI off, no key, breaker open, or zero vector hits) → keyword overlap + recency over the 3000 most recent artifacts, with `_STOPWORDS` removed from the question tokens.
- **`_person_issues`**: if any question token intersects a name token of an assignee/assigneeEmail across work items (name tokens = alphanumerics ≥3 chars of the name or email local-part), return that person's ACTUAL work items (open first, then by recency, cap 15) — "what is X working on" must not depend on top-k luck. Merged with retrieval hits, combined cap 20.
- **`_graph_context`**: first person/project/customer entity whose name or alias tokens intersect the question tokens → `traverse(2 hops)` → up to 15 edges rendered as `- A —type→ B` (artifact titles resolved for ≤40 ids) under `GRAPH CONTEXT (2 hops around {name})`.
- **Learned-facts block**: question embedded once; `memory.search(k=6)`; historical mode (statuses include superseded, tagged `HISTORICAL`) when the question contains any of: *last month, previously, used to, earlier, who owned, history, before*. Each fact renders with its confidence % and source ref.
- **Prompt assembly order** (`_build_context`): conversation window → `QUESTION:` → stats + goals + open signals → graph block → learned facts → `EVIDENCE:` (each hit as `[id] (source) title` + content[:800]). Directives are NOT in this prompt — they append to the **system** prompt as `<System_Directives>`.
- **Streaming (`POST /chat/stream`)**: SSE grammar `phase:"retrieving"` → `phase:"reasoning"` → (`thinking:*` | `delta:*`)\* → `done{conversationId, citations, grounded}` (or `error`). Thinking uses pydantic-ai event iteration (`agent.iter` → `ThinkingPart/TextPart` start+delta events) with `GoogleModelSettings(include_thoughts=True)` — non-Google providers silently stream text only.
- **Resilience chain**: attempt 1 = default model with thinking; if it produced NO answer text (e.g. preview-model 503), attempt 2 = extractor model without thinking; still nothing → deterministic `_fallback_text` (stats block + top memory titles). The stream never crashes the request.
- **Citations for streamed text (`_cites_from_text`)**: evidence items whose identifier (e.g. `ENG-432`) appears in the answer, or whose title (≥12 chars, first 40) appears — else the top 3 hits; cap 6. The JSON (non-stream) endpoint instead validates the model's `citation_ids` against the hit set.
- **Conversations**: `ChatConversation(workspace_id, user_id)` — ownership checked on every access (404 otherwise). Messages appended as JSON (reassigned so SQLAlchemy tracks the change); title = first question[:60]. An aborted stream is not persisted. If an initial sync is active, chat answers with the live sync phase instead of guessing from half-built memory.

### 15b. The closed loop in chat — draft → approve → create → learn

Chat is not just Q&A; it's an **Act surface**. Three behaviors layer on the answer path, each gated so it never fires spuriously:

- **Explicit ticket draft (Phase 1).** Cheap keyword gate `_maybe_actionable` (a ticket-noun + an action-verb) → lite-model `_draft_ticket` (`_DRAFT_SYSTEM`, `_DraftIntent` schema) turns the ask into `{connector, title, description}`. `_build_action` attaches a default destination (`_default_target`: first Linear team / most-recent GitHub repo) and yields a `draft` SSE event. The draft is stored **inside the assistant message JSON** (`message.draft = {actionId, connector, title, description, target, targetLabel, status, result, proactive}`) — single source of truth, no extra table.
- **Self-decide-to-pull (Phase 2).** When `_build_context` returns **no hits and no stats**, `_decide_pull` (lite `_PullPick` over `_connected_pullable` = connected + credentialed of linear/github/slack/google-drive) picks the ONE tool most likely to have the answer. The stream emits `phase:"pulling"` + `connector` ("Checking Linear…"), `_run_pull` runs that connector's normal `ingestion.pull_*` (respects the sync plan — cheap incremental in steady state), then `_build_context` re-runs and the answer proceeds. Fires only on empty grounding, so it never adds latency to answerable questions.
- **Proactive offer (Phase 3).** After answering a normal turn, if `_maybe_trackable` (problem/request keywords) **and** `_ticket_habit` (a workspace-scoped `Memory(subject="ticket-habit")` exists — set on the team's FIRST approval), `_proactive_draft` (`_PROACTIVE_SYSTEM`, conservative) may attach a draft flagged `proactive:true` ("Suggested ticket" in the UI).

Endpoints (all conversation-scoped, ownership-checked):
- `GET /chat/ticket-targets` → `{linear:[{id,name,key}], github:[{fullName}]}` for connected tools (the draft-card pickers).
- `PATCH /chat/conversations/{cid}/actions/{id}` → edit a *pending* draft (title/description edits recorded as learning via `learning.record_feedback` section=`chat-ticket`) or `discard:true` (status→`discarded`, hidden on reload). 409 if already actioned.
- `POST /chat/conversations/{cid}/actions/{id}/approve` → **the one real outbound action**: `services/tickets.create_ticket` (below) creates the issue, `ingest_created` folds it into memory immediately (idempotent by external_ref), an `ActivityEvent` is logged, and the habit `Memory` is reinforced. Returns `{identifier, url}`.

`_draft_ticket` and `_proactive_draft` share `_run_draft` (same schema/parse, different system prompt). These classifiers use `build_agent` with **inline** prompts — they are not in `SYSTEM_PROMPTS` (feature-local).

## 16. Analytics (`services/analytics.py`)

`memory_stats` computes the MEMORY STATS block with SQL/Counter math only (no LLM, no embeddings, quota-proof), reading only lean columns (source, meta, occurred_at): artifacts by source · Linear totals/open/completed, created today / last 7 days, avg cycle time over completed tickets (`cycleTimeDays` computed at ingest from createdAt→completedAt) · open work by project and by assignee, completed by assignee · GitHub PR totals/open/merged, open PRs by author and by repo. Injected into every chat prompt AND used by the deterministic fallback — quantitative questions never depend on the LLM guessing numbers.

## 17. Reasoning & findings (`services/reasoning.py`)

Constants: `_UNREQUESTED_THRESHOLD = 3` · `_STALE_PR_DAYS = 7` · commitment stall = 14 days.

- **`detect_findings`** loads the whole workspace model (entities, links, artifacts) once, builds link indexes (`fulfills`, `source_of`, `requested_by`), then runs 7 detectors, each emitting a *desired* finding with a stable `dedupe_key`:
  1. `untracked:{commitment_id}` (gap) — open commitment; carries a **prepared action** `{type: create-linear-issue, title, description}` built from the commitment + its source artifact.
  2. `win:{commitment_id}` (win) — tracked commitment whose fulfilling issue's `stateType == completed`; also the **outcome watcher**: flips the commitment to `delivered`.
  3. `demand:{feature_id}` (trend) — feature `requested_by` ≥2 customers.
  4. `unrequested-work` (drift) — ≥3 non-completed Linear issues that neither fulfill a commitment nor `text_match` any feature name (one aggregate finding).
  5. `stale-prs` (drift) — open non-draft PRs with `occurred_at` ≥7 days old (one aggregate finding).
  6. `blocked-project:{project}` (drift, **inference chain**) — active `blocker` facts → their artifacts (by identifier) → grouped by `meta.project`; only non-completed artifacts count.
  7. `commit-risk:{commitment_id}` (drift, **inference chain**) — tracked commitment whose fulfilling issue is blocked (in the blocker-fact set) OR hasn't moved in 14+ days; the customer is resolved via the `made_to` edge for the title ("Commitment to X may slip").
- **`_upsert` semantics** (the learning-respecting merge): existing findings load in states open/dismissed/approved. Desired keys that were **dismissed or approved never resurface**. Open matches update in place — but a human-edited `action` is preserved (only filled if empty). New findings get their action drafted by the `issue-writer` agent with recent corrections (deterministic action on failure). Open findings whose key is no longer desired → `resolved`. The brief (kind `brief`) is excluded from this lifecycle.
- **`generate_brief`**: deterministic `_fallback_brief` first (headline + counts + top titles per bucket), replaced by the `intelligence-brief` agent output when AI is on (input = corrections + `- [kind] title` list). Upserted as the single `dedupe_key="brief"` Insight; `evidence = {risks, highlights, recommendations}`; regeneration re-opens it.

## 18. Proposals — the Act phase (`services/proposals.py`)

`dispatch_for_workspace` (heartbeat step 7): open gap/drift findings without a proposal, newest first, **≤3 per tick** (`_MAX_PER_RUN`). Each gets `draft_proposal` — the `product-agent` with question-relevant `<System_Directives>`, over the finding + its entity/artifact evidence; deterministic template on failure/AI-off (`kind`: drift→slack-alert, gap→action-plan). The draft is stored at `Insight.evidence["proposal"]` (`{kind, title, body, draftedAt, status:"draft"}`) — the detector re-scan never overwrites `evidence`, so drafts survive. One `ActivityEvent(action="drafted")` each. Drafting only — execution stays behind human approval.

**Write actuators — one seam (`services/tickets.py`).** Every surface that creates a real issue goes through here, so a new connector is added in one place:
- `create_ticket(db, ws, connector, title, description, target)` — dispatches to `linear.create_issue` (team id) / `github.create_issue` (owner/repo). Raises `PermissionError` (not connected → 409), `ValueError` (missing/invalid target → 422), or the connector's own error (→ 502).
- `ingest_created(...)` — folds the new issue into memory (`ingest_artifact`, `meta.createdInOrbit=true`), idempotent by external_ref; the next connector pull refreshes it in place.

Both **chat `approve_action`** (§15b) and the **Feed `findings.approve_finding`** call `create_ticket` — one audited write path, credentials never leave the server. GitHub gained write here (`create_issue`/`list_repos`/`_post`); it was read-only before.

## 19. Learning (`services/learning.py`)

- `record_feedback(section, field, before, after)` — written synchronously on the request path (human actions are low-frequency); before/after clipped to 280 chars; the row's **embedding is of `rule_text(...)`** — the correction rendered as a natural-language behavioral rule (e.g. *'The team dismissed a finding: "…". Reason: … Surface fewer like it.'*), so it's retrievable by topic.
- Two read modes:
  - `render_corrections` — the `_MAX_CORRECTIONS = 8` most RECENT corrections as a `LEARNED CORRECTIONS` block; used by the Extractor and brief (no natural query to match against).
  - `directives_block(query, k=3)` — the most RELEVANT rules by vector (`_RULE_MAX_DISTANCE = 0.40` ⇒ cosine ≥ 0.60; pgvector on Postgres, Python cosine on SQLite), formatted as a `<System_Directives>` block appended to the agent's **system prompt**; used by chat, product-agent.

## 20. Security & tenancy

Clerk JWT verified against JWKS per request (key rotation handled) → `workspace_id` from the org claim (v2 `o.id` **and** legacy `org_id` — the cross-tenant bug we fixed) → every query filters on it → credentials live under composite PK `(workspace_id, key)` and are never serialized into responses. Chat is additionally scoped per user. Webhook endpoints authenticate by per-workspace token (+ GitHub HMAC). Dev with `CLERK_JWKS_URL` unset runs authless on the seeded workspace.

## 21. Honest gaps (current)

- Person identities are unified across connectors by **email** (the deterministic
  key) with alias/handle accumulation and legacy-duplicate merge (`resolve_person`).
  Residual: a person seen only via a handle with no email anywhere (e.g. a GitHub
  login that never appears with an email) stays separate — we don't fuzzy-merge on
  name, because a wrong merge is worse than a duplicate
- Free-tier model quotas can exhaust for the day (billing removes; budgeter deferred)
- Vision reads are bounded — 3 Drive files + 5 embedded images per connector per
  sync, ≤8MB each, needs AI on; unreadable/oversized files are skipped and
  retried next sync, never ingested as garbage. SVGs (badges) are rejected. New
  image text folded into an existing artifact now DOES re-embed that one artifact
  (`_reembed_if_images_changed`), so it's semantically searchable — routine
  refreshes still don't re-embed (no storm)
- Office files in Drive ARE read now — `.docx`/`.xlsx`/`.pptx` parsed to text.
  Residual: only text is extracted (images/objects embedded *inside* an Office
  file aren't OCR'd), and legacy `.doc`/`.xls`/`.ppt` (pre-2007 binary) aren't parsed
- Reconnects are inherent to OAuth (a new scope needs re-consent; a token with no
  refresh token can't be refreshed) — but no longer silent: an auth failure flips
  the connector to a self-healing `reconnect` status the UI surfaces. New Linear
  connections carry refresh tokens; new Slack connections carry `files:read` — so
  this only affects connections made before those shipped, once
- Existence probes cap at 50 per nightly pass (shuffled) — a very large deleted
  backlog converges over several nights, not one
- Slack deletions aren't reconciled (threads have no open/closed state; a
  deleted message simply stops being cited)
- Webhook registration is manual for Linear/Slack (GitHub can verify HMAC);
  inference rules are the two shipped chains — no general rule engine
- `traverse()` is a Python-side BFS — fine at current scale, and the explicit
  seam to swap for a recursive CTE / graph store later
