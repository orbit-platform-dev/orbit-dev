# Orbit
## what is orbit ?
Orbit is an execution platform with its own native meeting platform. Teams can run customer meetings in Orbit or automatically import conversations from the meeting platforms they already use. After every conversation, Orbit prepares proposed updates across the company—from CRM records and product plans to engineering work, timelines, and customer follow-ups. Every change is reviewed by humans before Orbit synchronizes approved updates into the tools the team already uses.

**Meetings → shipped, on autopilot.**

Orbit ingests customer meetings and an orchestra of AI agents turns them into PRDs,
engineering/design/QA/sales plans, tasks, a live execution graph, and customer
follow-ups — tracking revenue impact at every step.

This repository contains the **authenticated product** (no marketing site): a
premium, dark-first Next.js application and a FastAPI backend whose AI pipeline is
orchestrated with LangGraph + PydanticAI.

---

## Highlights

- **Dashboard** — recent meetings, live agents, execution progress, follow-ups, project health, blocked items, revenue opportunities, customer requests, delivery estimates and active integrations.
- **Meetings** — upload video / audio / transcript, then a rich analysis view: transcript, summary, sentiment, pain points, feature requests, business opportunities, action items, stakeholders, urgency and revenue impact.
- **AI Agents** — eight specialized agents (Meeting Intelligence, Product Manager, Engineering / Design / QA / Sales Planners, Customer Success, Leadership Advisor) each with live status, current thinking, generated documents, confidence and execution time.
- **Projects** — every project traceable to a meeting, with **9 tabs**: Overview, PRD, Engineering, Design, QA, Sales, Timeline, Activity, Documents.
- **Execution Graph** — the signature feature. A React Flow canvas from `Meeting → Business Goal → Feature Request → PRD → Engineering → Design → QA → Sales → Deployment → Customer Follow-up`, with live-updating nodes, animated edges, zoom, minimap, stage filtering, node search and per-node history.
- **Timeline** — animated chronological execution of every stage.
- **Tasks** — a Kanban board (Backlog / Todo / In Progress / Review / Done) with drag-and-drop, where every card links back to its meeting, feature request, PRD and graph node.
- **Integrations** — Google Meet, Zoom, Slack, GitHub, Jira, Linear, Notion, HubSpot, Salesforce, Calendar — connect / disconnect / last-sync.
- **Settings** — Workspace, Members, Billing, AI Models, Notifications, API Keys, Integrations, Security (SAML SSO + SCIM).
- **Command palette** (⌘K), glass surfaces, Framer Motion throughout, fully responsive.

## Tech stack

| | |
|---|---|
| **Frontend** | Next.js 15 (App Router), TypeScript, TailwindCSS, shadcn-style UI, React Flow (`@xyflow/react`), Framer Motion, TanStack Query, Clerk |
| **Backend** | FastAPI, SQLAlchemy 2 (async), PostgreSQL, Redis, PydanticAI, LangGraph |
| **Infra** | Docker Compose (web + api + Postgres + Redis) |

---

## Quick start

You have three ways to run Orbit, from zero-setup to full stack.

### 1. Frontend only (zero config)

The app ships with a complete in-memory mock dataset, so it runs with **no backend
and no keys**. Auth falls back to a demo identity; data comes from the mock layer.

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
# open http://localhost:3000  → redirects to /dashboard
```

### 2. Full stack with Docker Compose

Brings up the Next.js app, the FastAPI API, PostgreSQL and Redis together.

```bash
docker compose up --build
# web → http://localhost:3000   api → http://localhost:8000/docs
```

### 3. Backend manually (zero config, SQLite)

The API defaults to a local SQLite database and seeds itself on first boot — no
Postgres required for development.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# http://localhost:8000/docs  ·  http://localhost:8000/health
```

Then point the frontend at it:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Configuration

Everything degrades gracefully — the app is fully functional with **none** of these set.

**Frontend** (`frontend/.env.local`, see `.env.example`)

| Variable | Effect when set |
|---|---|
| `NEXT_PUBLIC_API_URL` | Use the FastAPI backend instead of mock data |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | Enable real Clerk auth + route protection (otherwise demo identity) |

**Backend** (`backend/.env`, see `.env.example`)

| Variable | Default / effect |
|---|---|
| `DATABASE_URL` | SQLite by default; Compose uses PostgreSQL |
| `REDIS_URL` | Optional — enables response caching + agent event streams |
| `ANTHROPIC_API_KEY` | Enables real model calls; without it the pipeline uses deterministic, transcript-derived fallbacks |
| `CLERK_JWKS_URL` / `CLERK_ISSUER` | Enables bearer-token verification on the API |

---

## The agent pipeline

`POST /meetings/{id}/analyze` runs a **LangGraph** state machine that mirrors the
execution graph. Each node is a **PydanticAI** agent with a typed, validated output:

```
transcript
  └─ meeting-intelligence  (signals: pain points, requests, sentiment, revenue)
       └─ product-manager  (PRD: problem, goals, metrics, user stories)
            ├─ engineering-planner  (architecture, components, estimate, risks)
            ├─ design-planner       (flows, screens)
            │     └─ qa-planner     (strategy, test cases, coverage)
            └─ sales-planner        (positioning, talk tracks, segments)
                  └─ customer-success  (follow-up draft + commitments)
```

When `ANTHROPIC_API_KEY` is unset (or LangGraph isn't installed), the same nodes run
with deterministic fallbacks, so the entire pipeline is runnable offline. The
architecture is built so new agents and integrations slot in without refactoring:
add a system prompt + output schema in `backend/app/agents/`, wire a node into the
graph, and (optionally) a new integration row.

---

## Project structure

```
.
├── docker-compose.yml          # web + api + postgres + redis
├── frontend/                   # Next.js 15 app (authenticated product)
│   ├── src/app/(app)/          # dashboard, meetings, agents, projects,
│   │                           # graph, timeline, tasks, integrations,
│   │                           # activity, settings  (+ sign-in / sign-up)
│   ├── src/components/         # ui/ (primitives), shared/, and per-feature
│   ├── src/lib/                # types, mock data, api client, TanStack hooks
│   └── ...
└── backend/                    # FastAPI service
    └── app/
        ├── main.py             # app + lifespan (create tables + seed)
        ├── models.py schemas.py routers/ seed.py
        ├── agents/             # definitions, schemas, fallback, orchestrator
        ├── database.py redis_client.py deps.py config.py
```

## API surface

`GET /health` · `GET|POST /meetings` · `GET /meetings/{id}` · `POST /meetings/{id}/analyze`
· `GET /agents` · `GET /projects` · `GET /projects/{id}` · `GET|PATCH /tasks`
· `GET /graph` · `GET /timeline` · `GET /integrations` · `GET /activity` · `GET /dashboard`

Interactive docs at `http://localhost:8000/docs`. Response shapes match the
frontend's TypeScript types in `frontend/src/lib/types.ts` (camelCase).

---

## Notes

- **Design**: dark-mode first with a light theme; glass cards, refined typography (Inter + JetBrains Mono), Framer Motion, professional spacing — aiming for the polish of Linear / Vercel / Notion.
- **Demo data is intentionally coherent**: the Northwind SSO renewal story threads through meetings → analysis → project → PRD/plans → tasks → graph → timeline → follow-up, so you can follow one signal end-to-end.
