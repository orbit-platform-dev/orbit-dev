# CLAUDE.md

Guidance for Claude Code when working in this repo. Read this first.

## What Orbit is (read before building)

Orbit is an **AI Execution Engine** — it transforms customer conversations into
**coordinated, company-wide execution**. It answers *"what should the company do
next?"*, not *"what happened in the meeting?"*

It is **NOT** a meeting summarizer, note-taker, or PM/Jira tool. The core problem
is **execution coordination** — eliminating the manual Customer → Sales → Product →
Eng → Design → QA → CS → Customer handoffs.

**Positioning (2026-07-09):** Orbit doesn't replace your tools. It's the review
and approval layer between customer conversations and execution. Approved
updates sync into the software your team already uses, which stays the system
of record. (This killed the own-the-call concept — see Current state.)

Non-negotiable product principles (every feature must serve these):

- **The Execution Graph is the primary interface**, not a visualization. Every
  **node = a real artifact** (Meeting, Feature Request, PRD, Task, Design, etc.);
  every **edge = WHY it exists**. Users trace work back to the originating call.
- **Orbit proposes, never forces.** Generated items should be approve / reject /
  edit / skip / assign-able by a human (human-in-the-loop is central).
- **Every recommendation explains WHY** (stored in `meta.reason` on each node).
- **Don't assume every company has every department.** Reason about which teams a
  conversation actually needs; skip the rest with a reason.
- Favor interactive graphs/relationships/reasoning over forms and long tables —
  it should feel like an operating system, not a dashboard.

## Layout

```
orbit-dev/
├── backend/      FastAPI (async) + LangGraph agent pipeline + SQLAlchemy
├── frontend/     Next.js (App Router) + Tailwind + xyflow graph
└── docker-dev-compose.yml   db (Postgres) · redis · adminer · api · web
```

## Commands

**Dev hybrid (what we usually run):** API + Postgres in Docker, frontend on the host.
The compose file is **docker-dev-compose.yml** (non-default name → always pass `-f`).

```bash
# Backend stack (api on :8000, adminer DB UI on :8080)
docker compose -f docker-dev-compose.yml up -d db redis api adminer

# IMPORTANT: the api image BAKES the code (no volume mount). After ANY backend
# edit you must rebuild for it to take effect:
docker compose -f docker-dev-compose.yml up -d --build api

# Frontend (on :3000) — live reload, point it at the API via frontend/.env.local
cd frontend && npm install && npm run dev
```

**Backend manually (zero-config, SQLite, hot reload):**
```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # docs at /docs, health at /health
```

**Checks & tools:**
```bash
cd frontend && npm run typecheck          # tsc --noEmit  (rm -rf .next/types first if stale)
cd backend  && ./.venv/bin/python check_llm.py   # diagnose the configured LLM provider
```

There are no automated tests yet.

## Backend architecture

FastAPI monolith, four layers (all under `backend/app/`):

1. **HTTP** — 14 routers (`routers/`): `meetings`, `customers`, `chat`, `calendar`,
   `zoom`, `meet`, `graph`, `projects`, `tasks`, `agents`, `timeline`, `integrations`,
   `activity`, `dashboard`. Mounted in `routers/__init__.py`. Auth via `deps.get_current_user`
   (Clerk JWT; **disabled in dev** when `CLERK_JWKS_URL` unset → everyone is
   `DEMO_PRINCIPAL`). Tenancy via `services/workspace.py::get_workspace_id`
   (Clerk `org_id` claim → workspace; dev traffic lands on the seeded
   `ws_default`). **Migrations are Alembic** (`backend/alembic/`), applied
   automatically at startup by `database.init_db`: fresh DB → create_all + stamp
   head; pre-Alembic DB → stamp baseline + upgrade; managed DB → upgrade.
   Never add columns via create_all alone — write a migration.
2. **Agents** (`agents/`) — the brain. See below.
3. **Persistence** (`agents/persistence.py`) — turns pipeline output into domain
   rows (Project + GraphNodes/Edges + Tasks).
4. **Data/infra** — `database.py` (async SQLAlchemy engine/session), `models.py`
   (10 tables, JSON-heavy), `redis_client.py` (optional, no-ops if no `REDIS_URL`),
   `config.py` (pydantic-settings from `.env`).

### The agent pipeline (the core)

A **LangGraph `StateGraph`** of typed **PydanticAI** agents, defined in
`agents/orchestrator.py`. Entry point: `run_pipeline()`, run **in the background** by
`routers/meetings.py::_analyze_in_background` (both `POST /meetings/transcript` and
`POST /meetings/{id}/analyze` schedule it and return immediately). It takes an
`on_progress` callback and streams stages via `graph.astream(stream_mode="values")`,
writing real `Meeting.analysis_progress` after each stage so the UI can show live
progress; on error the meeting is set `status="failed"`, never left spinning.

```
transcript (+ ContextPackage from the Context Engine)
 └ meeting-intelligence → signals
    └ product-manager → PRD
       └ execution-router → sections{relevant, reason}  ← decides WHICH sections
          ├ crm-analyst  ┐ (each node skips itself if the router said irrelevant)
          ├ engineering  ┤
          ├ design       ┤→ qa
          └ sales ───────┘→ execution-planner → customer-success
```

Pipeline nodes return **partial state updates** (only the keys they produced) and
`events` is an `Annotated[list, operator.add]` reducer channel — this is what makes
the parallel branches (crm ∥ engineering ∥ design) safe. Returning full state from a
node reintroduces `InvalidUpdateError`.

### The Context Engine (`context/engine.py`) — read this before touching generation

`build_context_package(db, customer_id, exclude_meeting_id?, query_text?, wide?)`
returns ONE structured `ContextPackage`: customer profile, relevant meetings,
approved plans, open commitments, recent knowledge — every string clipped, caps per
source (`wide=True` for chat retrieves ~3x more). Retrieval is **hybrid**:
structured facts are indexed SQL; meeting/knowledge recall is **semantic** —
embeddings (`services/embeddings.py`, Gemini `gemini-embedding-001`, 768-dim,
written at analysis/approval time + startup backfill) ranked by **pgvector**
cosine search in-database on Postgres (HNSW indexes, migration 0003; compose db
image is `pgvector/pgvector:pg16`). On dev SQLite the same embeddings are JSON
columns ranked by Python cosine over a bounded window; with no embeddings at all
(AI off) it degrades to keyword+recency. `render_context()` turns the package
into the compact prompt block that **every generator consumes identically**
(pipeline via `run_pipeline(..., context=...)` + `_with_context`, chat via
`routers/chat.py`). Never pass raw tables/transcripts into a prompt; extend the
package instead. EMBEDDING_DIM changes require a column-rebuild migration.

### Customer / Knowledge / Approval / Sync (the execution-platform core)

- **Customer** is a real entity (`services/customers.py`): `resolve_customer` matches
  the account label (normalized name → aliases → email domains) or creates one;
  meetings and plans carry `customer_id`. Generic labels ("Manual upload") resolve to
  None — a meeting can exist unlinked. Startup backfills legacy rows.
- **ExecutionPlan is the central business object** — the SQLAlchemy model is
  `ExecutionPlan` (table stays `projects`, `Project` alias kept, API paths stay
  `/projects/*`). New sections: `crm_update`, `internal_notes`.
- **Approval** (`POST /meetings/{id}/approve`) locks and prepares — it NEVER
  executes (product decision 2026-07-09): lock plan → `services/knowledge.
  record_approved_plan` (ONLY approved output becomes KnowledgeItems; commitments
  tracked individually, status open/completed) → `Approval` audit row →
  `services/sync.create_sync_jobs` (one pending SyncJob per approved section;
  no connected destination → `skipped` with a reason). Each job runs ONLY via
  `POST /projects/{id}/sync-jobs/{job}/run` — the review screen's Send /
  Publish / Create issues / Sync CRM buttons. The follow-up email requires a
  recipient (`customer_update.to`, auto-filled from the customer's learned
  `meta.contactEmail`, learned back on send). Executors are the real-API seam —
  currently stubbed links, but flowing through the audited job pipeline.
- **Locking is total**: after approval, meeting analysis PATCH, plan PATCH, task
  edit/assign/decline/delete all 409. Kanban `column` moves stay allowed (delivery
  tracking, not plan editing). The UI mirrors this (work-item-card gates on canEdit).
- **Chat** (`routers/chat.py`): conversations PERSIST (`chat_conversations`,
  migration 0004) like Claude/GPT — each carries its transcript + a customer
  binding; later turns reuse that customer's context automatically. `POST /chat
  {message, customerId?, conversationId?}` entity-links the customer, builds a
  wide ContextPackage (pgvector-ranked), answers via the `orbit-chat` agent —
  deterministic context-derived answer when AI is off. History endpoints:
  GET/DELETE `/chat/conversations[/{id}]`. Frontend: history rail + customer
  selector at `/chat` (`?customer=` pre-binds).
- **Customers UI**: `/customers` (list + New customer dialog → POST /customers,
  which reuses identity resolution) and `/customers/{id}` — commitments with
  open/complete toggle, meetings, approved Knowledge Base. In the sidebar nav.

- **8 agents** in `agents/definitions.py` (`SYSTEM_PROMPTS`) + `agents/schemas.py`
  (typed `_Camel` outputs → serialize to **camelCase** for the frontend).
  `leadership-advisor` has a prompt but isn't wired in yet (Phase 2).
- **Provider-agnostic model layer** (`agents/model_service.py`): `build_model()`
  resolves `DEFAULT_MODEL="provider:name"` against a registry. Switching providers
  is **env-only**; adding one is a single registry entry. Agents never name a
  provider. `build_agent()` wraps output in `NativeOutput(...)` (constrained
  decoding — critical for reliable JSON) with `retries=3`.
- **Graceful degradation:** every agent call goes through `_run_agent()`, which
  falls back to a deterministic, transcript-derived version (`agents/fallback.py`)
  on any LLM failure or when `ENABLE_AI=false`. There's also a sequential fallback
  if LangGraph itself can't run. The pipeline never crashes the request.
- **Execution router** (the team-relevance feature): `node_route` writes
  `state["teams"]`; each downstream node guards via `_relevant(state, team)` and,
  if skipped, sets `state[stage]={"skipped": True, "reason": ...}` instead of
  generating filler.

### Google Calendar + Zoom (read-only ingestion — Orbit never owns the meeting)

Meetings happen in the customer's tools; Orbit syncs and ingests them. The
own-the-call concept (Orbit link on invites, in-browser `/call/{room}` WebRTC
calls) was **removed 2026-07-09** — don't reintroduce it.

- **Google Calendar** (`routers/calendar.py`): real OAuth (httpx only, no Google
  SDK) — `GET /calendar/connect` → consent URL → `GET /calendar/oauth/callback`
  → tokens in `CalendarConnection` (+ flips the `calendar` Integration row);
  redirects back to `/calendar`. Refresh tokens handled in `_access_token`.
  Scope is **calendar.events.readonly**; `GET /calendar/events` lists a window
  for the week grid and never writes to Google.
  **Fails loudly (503 + setup hint) when `GOOGLE_CLIENT_ID/SECRET` are unset —
  never mocked.**
- **Zoom** (`routers/zoom.py`): real OAuth (Basic-auth token exchange; Zoom
  **rotates refresh tokens** — always persist the new one). Zoom stays the
  meeting platform; Orbit ingests recordings: `GET /zoom/recordings` (cloud
  recordings, last 30 days — Zoom's range cap) and
  `POST /zoom/recordings/import` → downloads the per-speaker VTT transcript,
  parses it (`parse_vtt`), creates a `Meeting(source="zoom")` tagged
  `zoom:{uuid}` (idempotent re-import) and runs the standard pipeline.
  Needs a paid Zoom plan with cloud recording + audio transcript enabled.
- **Google Meet** (`routers/meet.py`): reuses the Calendar OAuth client
  (GOOGLE_CLIENT_ID/SECRET) with its own consent + scopes
  (`meetings.space.readonly`) and callback `MEET_REDIRECT_URI`. Google-side
  requirements: the **Google Meet REST API enabled** in the Cloud project, the
  redirect URI authorized on the client, and a Workspace plan with Meet
  transcription turned on during the call. `GET /meet/recordings` lists recent
  conference records (shaped like Zoom's summaries so the import dialog is
  shared-shape); `POST /meet/recordings/import {uuid, account?}` pulls the
  structured transcript ENTRIES (no Docs parsing), maps participants to display
  names, creates `Meeting(source="google-meet")` tagged `meet:{recordId}`
  (idempotent) and runs the standard pipeline. The import dialog's Customer
  field feeds identity resolution since Meet records have no topic.
  Provider connections live in the `calendar_connections` table, keyed by
  provider id (`google` / `zoom` / `google-meet`).
- **Activity hygiene**: `ActivityEvent.meeting_id` ties rows to meetings;
  deleting a meeting (or re-analyzing → `delete_execution`) removes its
  activity, and `visible_activity()` (routers/activity.py, also used by
  dashboard) filters out rows whose meeting/project no longer exists — "What
  Orbit did" never shows ghosts.

## Frontend architecture

Next.js App Router under `frontend/src/app/(app)/`: `dashboard`, `calendar`,
`meetings`, `meetings/[id]`, `graph`, `integrations`, `settings` (+ gated `chat`).

- **Calendar tab** (`(app)/calendar/page.tsx`): **read-only Google
  Calendar-style week grid** (user's explicit design choice) — Sunday-start day
  columns, hour gutter, events absolutely positioned with an interval-partition
  lane layout for overlaps, red now-line on today, ‹ › week paging + Today
  (each week is its own query key via `GET /calendar/events?time_min&days`),
  auto-scroll to the working hour, event click → popover with details + a link
  to open the event in Google Calendar. Connect empty-state (Google + Zoom).
  No event creation, no writes to the invite. The Meetings page's
  **"Starting soon"** strip shows ONLY events live now or starting within 30
  minutes (with a countdown) — informational, no join buttons.
  `useCalendarEvents` keeps previous data while refetching (no flicker).

- **Graph** is the centerpiece: `components/graph/` (`graph-canvas`,
  `execution-node`, `node-detail`, `graph-meta`) using **@xyflow/react**.
- Data via TanStack Query hooks in `lib/hooks.ts` → REST against
  `NEXT_PUBLIC_API_URL`. Falls back to mock data (`lib/mock/`) if unset.
- Shared types in `lib/types.ts` (match the backend's camelCase output).
- The **meeting detail page** shows the breakdown tabs (PRD/Eng/Design/QA/Sales/
  Tickets) inline — the standalone Projects section was removed; `components/
  projects/project-tabs.tsx` is reused there. It **polls** while a meeting is
  `analyzing` (via `useMeeting` refetchInterval) so progress climbs live, and shows a
  `failed`-state retry.
- The **Execution Review screen** (`meetings/[id]/review`) is the editable heart:
  every section — Customer Intent, PRD (all fields), work items (inline edit / reassign
  / decline / remove), timeline, follow-up email — is an editable draft until approval,
  built on reusable editors in `components/execution/editable.tsx`.
- **Publishing**: one reusable destination picker (`components/execution/publish-dialog.tsx`
  + the `publish-destinations.ts` service) powers both the PRD "Publish" and the
  work-items "Push to tools" dialogs. Each shows every destination — PDF · Notion ·
  Confluence · Google Docs · Jira · Linear — with per-row connection status + in-dialog
  Connect; connected rows push directly, disconnected offer Connect. **PDF export is
  real** (`@react-pdf/renderer`; `prd-pdf.tsx` / `plan-pdf.tsx`); **tool pushes are
  stubbed** behind the seam (`api.publishPrd`, `stubDocUrl` / `stubBoardUrl`).

## Conventions

- **Comments: only important ones.** A comment must carry a constraint, a why,
  a protocol, or a gotcha the code can't show. No narration, no decorative
  markers on self-evident code.
- **No `window.confirm`** — use the shared `ConfirmDialog`
  (`components/shared/confirm-dialog.tsx`): async-aware, destructive variant,
  stays open on failure.
- **External-source queries refetch on focus.** The app's QueryClient disables
  `refetchOnWindowFocus` globally; queries backed by external systems (calendar
  events) override with `"always"` so switching back to the Orbit tab re-syncs.
- Branding renders through `OrbitMark`/`OrbitWordmark`
  (`components/shared/logo.tsx` → `/public/orbit-logo.svg`; the circular crop +
  zoom trims the SVG's baked-in black background).

- Backend schemas serialize **camelCase** (`alias_generator=to_camel`) — keep
  frontend `lib/types.ts` in sync. **PATCH request bodies also accept camelCase**
  (e.g. `PatchProjectIn` uses `to_camel`), so the frontend can send `customerUpdate`.
- Graph node IDs: `g_{meetingId}_{kind}`; edges `e_{meetingId}_...`; tasks
  `tk_{meetingId}_...`. This keeps the graph **per-meeting** and re-runs idempotent.
- `persist_execution` calls `delete_execution` first, so analyzing is idempotent.
- Every persisted graph node stores its per-meeting "why" in `meta.reason`; skipped
  teams get `status="skipped"` + `meta.skipped` and no tasks.

## Gotchas (things that have bitten us)

- **Rebuild the api container after backend edits** — `docker compose up -d --build
  api`. No volume mount; code is baked into the image.
- **Postgres enforces FKs** (SQLite doesn't): in seed/persistence, `db.flush()`
  nodes before adding edges.
- **Use tz-aware datetimes** with `DateTime(timezone=True)` columns.
- **LLM enum drift**: models sometimes return off-enum values (e.g. urgency
  "Critical"). Normalize on the backend (`signals_to_analysis`) AND keep frontend
  badge lookups defensive (`meta[x] ?? meta.default`).
- After deleting an app route, `rm -rf frontend/.next/types` before `typecheck`
  (stale generated types reference the deleted page).
- **Analysis is async**: `/transcript` and `/analyze` return immediately (`status="analyzing"`,
  `analysis_progress=5`); the background task writes progress per stage. The UI must **poll**
  `GET /meetings/{id}` until `analyzed`/`failed` (already wired in `useMeeting`). The
  background task uses its **own** `SessionLocal()` session — never the request's `db`.
- Known cosmetic issue: the pipeline `events` activity log has duplicate entries (a
  LangGraph parallel-branch state-merge artifact). Doesn't affect graph/teams.

## Configuration

Everything degrades gracefully — the app runs with **none** of these set.

**Backend** (`backend/.env`, gitignored — see `backend/.env.example`):

| Var | Effect |
|---|---|
| `ENABLE_AI` | `true` to make real model calls; else deterministic fallbacks |
| `DEFAULT_MODEL` | `provider:name`, e.g. `google-gla:gemini-flash-lite-latest` (free dev), `ollama:llama3.1` (local), `anthropic:claude-opus-4-8` (prod) |
| `LLM_API_KEY` | key for the chosen provider (none for Ollama) |
| `DATABASE_URL` | SQLite by default; Compose sets Postgres |
| `REDIS_URL` | optional — enables the event stream |
| `CLERK_JWKS_URL` / `CLERK_ISSUER` | enables API bearer-token auth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | enables Google Calendar OAuth (read-only meeting sync) |
| `GOOGLE_REDIRECT_URI` | default `http://localhost:8000/calendar/oauth/callback` — must match the OAuth client |
| `FRONTEND_URL` | default `http://localhost:3000` — the post-OAuth redirect target |

**Frontend** (`frontend/.env.local`): `NEXT_PUBLIC_API_URL` (use the real API),
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (real auth).

**Never commit real `.env` files.** Only `*.env.example` (placeholders) are tracked.

## Current state

- **Done:** the MVP flow **upload → (background) analysis with live per-stage progress
  → editable review → approve → publish**. The Execution Review screen
  (`meetings/[id]/review`) is the centerpiece: **every** section is an editable draft
  until approval — Customer Intent, PRD (all fields), work items (inline edit / reassign
  / decline / remove), timeline, follow-up email — then a sticky **Approve** flips
  `Project.approval_status` draft→approved, which **locks** edits (PATCH returns 409).
- **Publishing:** a unified destination-picker dialog sends the PRD *or* the work-item
  plan to any of PDF · Notion · Confluence · Google Docs · Jira · Linear (per-row status,
  in-dialog Connect, redirect links after push). **PDF is real; every tool push is a
  stub** behind `api.publishPrd` / `POST /projects/{id}/publish-prd` (records
  `prd.publication`) + `stubDocUrl` / `stubBoardUrl`. `CONNECTABLE` (front + back) =
  jira · linear · google-docs · confluence · notion.
- **Also done earlier:** execution router (team relevance + "why" on every node);
  chat gated behind a **Coming soon** overlay; Projects folded into meetings.
- **Pipeline:** meeting-intelligence → product-manager → execution-router →
  {eng, design} → qa, sales → **execution-planner** (work items) → customer-success;
  timeline derived deterministically from the work items.
- **Own-the-call REMOVED (2026-07-09, product decision):** Orbit no longer replaces
  meeting links or hosts calls (`/call/{room}` page, `routers/calls.py`, `CallRoom`
  model, auto-link machinery — all deleted). Google Calendar is now a **read-only
  sync** (see the Calendar section); meetings arrive via upload, transcript, or Zoom
  import. Legacy `Meeting(source="orbit-call")` rows may exist in old DBs — the
  frontend keeps its `sourceMeta` entry so they still render.
- **Execution-platform core shipped (2026-07-09):** Customer entity + identity
  resolution, Context Engine feeding every generator one structured package,
  CRM Update section (router-gated like every section), approval →
  Knowledge (approved-only) → Approval audit → SyncJobs executed post-approval,
  total post-approval locking, real Ask Orbit chat grounded in the Context Engine,
  Alembic migrations (auto-applied at startup), workspace tenancy columns.
  Verified end-to-end (scripted TestClient flow: meeting → customer → context →
  plan → lock → approve → knowledge → sync → chat).
- **Next:** replace the sync-job executors' stubs with real destination APIs
  (Salesforce/HubSpot, Notion/Confluence/Google Docs, Jira/Linear, email); a
  Customers surface in the UI (profile + knowledge timeline); wire in the
  `leadership-advisor` verdict; real Clerk org → workspace mapping.
