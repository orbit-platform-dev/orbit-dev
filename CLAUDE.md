# CLAUDE.md

Guidance for Claude Code when working in this repo. Read this first.

## What Orbit is (read before building)

Orbit is an **AI Execution Engine** — it transforms customer conversations into
**coordinated, company-wide execution**. It answers *"what should the company do
next?"*, not *"what happened in the meeting?"*

It is **NOT** a meeting summarizer, note-taker, or PM/Jira tool. The core problem
is **execution coordination** — eliminating the manual Customer → Sales → Product →
Eng → Design → QA → CS → Customer handoffs.

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
└── docker-compose.yml   db (Postgres) · redis · adminer · api · web
```

## Commands

**Dev hybrid (what we usually run):** API + Postgres in Docker, frontend on the host.

```bash
# Backend stack (api on :8000, adminer DB UI on :8080)
docker compose up -d db redis api adminer

# IMPORTANT: the api image BAKES the code (no volume mount). After ANY backend
# edit you must rebuild for it to take effect:
docker compose up -d --build api

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

1. **HTTP** — 11 routers (`routers/`): `meetings`, `calls`, `calendar`, `graph`,
   `projects`, `tasks`, `agents`, `timeline`, `integrations`, `activity`,
   `dashboard`. Mounted in `routers/__init__.py`. Auth via `deps.get_current_user`
   (Clerk JWT; **disabled in dev** when `CLERK_JWKS_URL` unset → everyone is
   `DEMO_PRINCIPAL`). The call-room endpoints (`GET /calls/{id}`, the WS) are
   **deliberately public** — external guests join calls by link.
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
transcript
 └ meeting-intelligence → signals
    └ product-manager → PRD
       └ execution-router → teams{relevant, reason}   ← decides WHO is needed
          ├ engineering ┐  (each node skips itself if the router said irrelevant)
          ├ design      ┤→ qa
          └ sales ──────┘→ customer-success
```

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

### Orbit Calls + Google Calendar (Orbit hosts the call — the Lyra model)

Orbit **is** the meeting surface, not a bot in someone else's: calls run at
`frontend /call/{room}` (full-screen page outside the `(app)` sidebar group,
public in `middleware.ts` so guests can join by link).

- **Media is WebRTC peer-to-peer** (mesh + Google STUN). The backend never sees
  media — `routers/calls.py` is only the signaling plane (`/ws/calls/{room}`:
  join/roster/SDP/ICE relay) + the live transcript sink. Room registry is
  in-memory → **single-process server only** (fine for dev; an SFU like LiveKit
  is the scale path).
- **Per-mic transcription (the Lyra trick):** each participant's own browser
  transcribes their own mic via the Web Speech API (Chrome/Edge; free, no key)
  and streams `{type:"transcript", text, dur}`. The server stamps times against
  the room clock (`end ≥ 0.5s`, `start < end`) and broadcasts to everyone —
  **including the sender** (the echo is what renders in captions/panel). This is
  the seam where live listening/agents plug in later.
- **Call end → Meeting:** `POST /calls/{room}/end` finalizes the room into a
  `Meeting(source="orbit-call")` with real per-speaker, timestamped transcript +
  participants, then schedules the normal `_analyze_in_background` pipeline
  (only if anyone actually spoke). Idempotent; broadcasts `{type:"ended"}` so
  every client shows the "view analysis" screen.
- **Google Calendar** (`routers/calendar.py`): real OAuth (httpx only, no Google
  SDK) — `GET /calendar/connect` → consent URL → `GET /calendar/oauth/callback`
  → tokens in `CalendarConnection` (+ flips the `calendar` Integration row);
  redirects back to `/calendar`. Refresh tokens handled in `_access_token`.
  **Fails loudly (503 + setup hint) when `GOOGLE_CLIENT_ID/SECRET` are unset —
  never mocked.**
- **Auto-link, always replace, read-only** (product decision, 2026-07-04):
  events are **created in the user's calendar apps, never in Orbit** (attendees
  span companies). With `CalendarConnection.auto_link` ON (default; NULL counts
  as ON), `GET /calendar/events` links every eligible upcoming event (timed +
  other attendees or a Meet link) as part of the sync and **always replaces the
  Meet conference** (`conferenceData: null` + `conferenceDataVersion=1`) so
  every invited party sees one link — Orbit's. Rooms are created locally first,
  then the Google PATCHes run **concurrently** (`asyncio.gather`), so
  steady-state loads make exactly one Google call. Where Google 403s the edit
  (attendee on someone else's event) the room still exists with
  `linkedInInvite:false` — the UI says copy the link. Manual fallback:
  `POST /calendar/events/{id}/orbit-link` (same replace behavior).
  `PATCH /calendar/settings {autoLink}` toggles.

## Frontend architecture

Next.js App Router under `frontend/src/app/(app)/`: `dashboard`, `calendar`,
`meetings`, `meetings/[id]`, `graph`, `integrations`, `settings` (+ gated `chat`).

- **Calendar tab** (`(app)/calendar/page.tsx`): **read-only Google
  Calendar-style week grid** (user's explicit design choice) — Sunday-start day
  columns, hour gutter, events absolutely positioned with an interval-partition
  lane layout for overlaps, red now-line on today, ‹ › week paging + Today
  (each week is its own query key via `GET /calendar/events?time_min&days`),
  auto-scroll to the working hour, event click → popover with details +
  actions. Auto-link toggle in the header; connect empty-state (Google now,
  Zoom coming soon). No event creation in Orbit. Per-event actions (Join /
  copy / manual link) live in ONE shared component,
  `components/calendar/event-actions.tsx`, reused by the grid popover and the
  Meetings page's **"Starting soon"** strip — which shows ONLY calls live now
  or starting within 30 minutes (with a countdown), nothing else.
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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | enables Google Calendar OAuth (Orbit call links on invites) |
| `GOOGLE_REDIRECT_URI` | default `http://localhost:8000/calendar/oauth/callback` — must match the OAuth client |
| `FRONTEND_URL` | default `http://localhost:3000` — used to build `/call/{room}` links |

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
- **Orbit Calls (own-the-call) shipped:** Google Calendar OAuth → Orbit link on the
  invite → in-browser WebRTC call at `/call/{room}` with per-mic live transcription →
  end call → Meeting (`source="orbit-call"`, real speakers + timestamps) → the standard
  analysis pipeline. Meetings page shows upcoming calendar events + "Start Orbit call".
- **Next:** replace the publish stubs with real integration pushes (behind the existing
  service seam); wire in the `leadership-advisor` verdict; live in-call AI (the
  transcript stream is already the seam).
