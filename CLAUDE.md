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

1. **HTTP** — 9 routers (`routers/`): `meetings`, `graph`, `projects`, `tasks`,
   `agents`, `timeline`, `integrations`, `activity`, `dashboard`. Mounted in
   `routers/__init__.py`. Auth via `deps.get_current_user` (Clerk JWT; **disabled
   in dev** when `CLERK_JWKS_URL` unset → everyone is `DEMO_PRINCIPAL`).
2. **Agents** (`agents/`) — the brain. See below.
3. **Persistence** (`agents/persistence.py`) — turns pipeline output into domain
   rows (Project + GraphNodes/Edges + Tasks).
4. **Data/infra** — `database.py` (async SQLAlchemy engine/session), `models.py`
   (10 tables, JSON-heavy), `redis_client.py` (optional, no-ops if no `REDIS_URL`),
   `config.py` (pydantic-settings from `.env`).

### The agent pipeline (the core)

A **LangGraph `StateGraph`** of typed **PydanticAI** agents, defined in
`agents/orchestrator.py`. Entry point: `run_pipeline()`, called by
`routers/meetings.py::_execute_pipeline` (shared by `POST /meetings/transcript`
and `POST /meetings/{id}/analyze`).

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

## Frontend architecture

Next.js App Router under `frontend/src/app/(app)/`: `dashboard`, `meetings`,
`meetings/[id]`, `graph`, `integrations`, `settings` (+ gated `chat`).

- **Graph** is the centerpiece: `components/graph/` (`graph-canvas`,
  `execution-node`, `node-detail`, `graph-meta`) using **@xyflow/react**.
- Data via TanStack Query hooks in `lib/hooks.ts` → REST against
  `NEXT_PUBLIC_API_URL`. Falls back to mock data (`lib/mock/`) if unset.
- Shared types in `lib/types.ts` (match the backend's camelCase output).
- The **meeting detail page** shows the breakdown tabs (PRD/Eng/Design/QA/Sales/
  Tickets) inline — the standalone Projects section was removed; `components/
  projects/project-tabs.tsx` is reused there.

## Conventions

- Backend schemas serialize **camelCase** (`alias_generator=to_camel`) — keep
  frontend `lib/types.ts` in sync.
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

**Frontend** (`frontend/.env.local`): `NEXT_PUBLIC_API_URL` (use the real API),
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (real auth).

**Never commit real `.env` files.** Only `*.env.example` (placeholders) are tracked.

## Current state

- **Done:** the MVP flow **upload → analysis → customer intent → draft PRD →
  execution plan → timeline → execution graph → customer follow-up → review →
  approve**. The Execution Review screen (`meetings/[id]/review`) is the
  centerpiece: editable PRD/email, per-work-item skip/reassign + "why"/confidence,
  a derived timeline, the embedded graph, and a sticky **Approve** CTA that flips
  `Project.approval_status` draft→approved (sync to Jira/Linear is mocked).
- **Also done earlier:** execution router (team relevance + "why" on every node);
  chat gated behind a **Coming soon** overlay; Projects section folded into meetings.
- **Pipeline now:** meeting-intelligence → product-manager → execution-router →
  {eng, design} → qa, sales → **execution-planner** (work items) → customer-success;
  timeline is derived deterministically from the work items.
- **Next:** real Jira/Linear push after approval; wire in the `leadership-advisor`
  "should we build this?" verdict; richer Customer-Intent editing.
