# Orbit — Backend System & Agent Architecture

A brief but complete explanation of how the Orbit backend works: how a customer
conversation, combined with everything Orbit already knows about that customer,
becomes a reviewed, approved, synchronized set of company updates.

---

## 1. What the backend does

Orbit is an **execution platform** — the **review and approval layer** between
customer conversations and company execution. The backend takes a **meeting
transcript**, identifies the **customer** behind it, retrieves that customer's
**history**, and prepares a complete **execution plan**: a CRM update proposal,
a PRD (on demand), per-team work items, a timeline, and a customer follow-up —
connected in an **execution graph** where every artifact explains *why* it exists.

Nothing is executed automatically. A human **reviews and edits every draft,
approves the plan (which locks it), and explicitly pushes each update** to the
tools the company already uses — Jira, Notion, the CRM, email. Those tools stay
the **system of record**. Only approved output becomes the customer's permanent
**knowledge**, which makes the next meeting's proposals smarter.

**Stack:** FastAPI (async) · LangGraph (agent orchestration) · PydanticAI (typed
LLM wrapper) · SQLAlchemy 2 (async) · PostgreSQL + **pgvector** / SQLite ·
**Alembic** (migrations) · Redis (optional) · Docker.

---

## 2. The layers

```
┌──────────────────────────────────────────────────────────────┐
│  HTTP LAYER        FastAPI + 14 REST routers                  │
│                    meetings · customers · chat · calendar ·   │
│                    zoom · meet · projects · tasks · graph ·   │
│                    timeline · integrations · activity · …     │
├──────────────────────────────────────────────────────────────┤
│  CONTEXT ENGINE ★  ONE structured ContextPackage per          │
│                    generation: SQL facts + pgvector semantic  │
│                    recall over the customer's history         │
├──────────────────────────────────────────────────────────────┤
│  AGENT LAYER ★     LangGraph pipeline of 10 typed PydanticAI  │
│                    agents + provider-agnostic model service   │
├──────────────────────────────────────────────────────────────┤
│  SERVICES          customers (identity) · knowledge (approved │
│                    truth) · sync (prepared jobs) · embeddings │
│                    · workspace (tenancy)                      │
├──────────────────────────────────────────────────────────────┤
│  PERSISTENCE       Agent output → ExecutionPlan, GraphNodes/  │
│                    Edges, Tasks (idempotent per meeting)      │
├──────────────────────────────────────────────────────────────┤
│  DATA / INFRA      Async SQLAlchemy · Alembic (auto-migrate   │
│                    at startup) · Postgres+pgvector / SQLite · │
│                    optional Redis · Clerk auth · settings     │
└──────────────────────────────────────────────────────────────┘
```

The two ★ layers are the product: the **Context Engine** decides what history a
generation sees, and the **agents** turn transcript + context into proposals.

---

## 3. The end-to-end flow

```
POST /meetings/transcript  { transcript, title, account }
   │
   ▼
[identify customer]   resolve_customer(): normalized name → aliases → email
   │                  domains; "acme" and "Acme Inc" land on the same Customer
   ▼
[retrieve context]    build_context_package(customer, wide=True):
   │                  semantically-matched past meetings + approved plans +
   │                  open commitments + approved knowledge → ONE text block
   ▼
[run pipeline]        10 agents (LangGraph), each seeing the SAME context —
   │                  signals → PRD draft → router → crm ∥ eng ∥ design → qa,
   │                  sales → work items + timeline → follow-up email
   ▼
[persist]             ExecutionPlan (draft) + graph + tasks; meeting embedded
   │                  for future semantic recall. PRD is NOT stored yet —
   ▼                  it's generated on demand in review (see §6).
[REVIEW]              every section is an editable draft; Generate PRD button;
   │                  nothing has left Orbit
   ▼
[APPROVE]             one moment, four effects — and NO execution:
   │                    1. plan LOCKS (all edits 409, UI mirrors it)
   │                    2. Approval audit row (who, when, which sections)
   │                    3. approved sections → KnowledgeItems (+ commitments)
   │                    4. SyncJobs PREPARED (status: pending)
   ▼
[SYNC — explicit]     each section's push button runs ONE job:
   │                  PRD→Notion · issues→Jira · CRM update · Send email
   ▼                  (destination connected? else job explains why not)
[REMEMBER]            knowledge + embeddings feed the NEXT meeting's context
```

Re-analysis is **idempotent**: persistence deletes the meeting's old
plan/graph/tasks before writing fresh ones.

---

## 4. The Context Engine (`app/context/engine.py`)

The single door to history. Every generator — the whole pipeline AND chat —
consumes the same structured `ContextPackage`; nothing ever passes raw tables
or transcripts to an LLM.

**Hybrid retrieval:**

| Data | Retrieval | Why |
|---|---|---|
| Open commitments, approved plans, profile | plain indexed SQL | exact facts — you want *all* open commitments, not similar ones |
| "Which of N past meetings matter *now*?" | **pgvector** cosine search over embeddings | meaning-based: "login problems" finds the "SAML assertion errors" meeting |
| Approved knowledge (PRDs, CRM updates, emails) | pgvector too, recency backfill | same |

**Embeddings** (`services/embeddings.py`): Gemini `gemini-embedding-001`,
768-dim, written when a meeting is analyzed and when knowledge is approved
(+ a capped backfill at startup). On Postgres they're real `vector` columns
with HNSW indexes (migration 0003; compose db image `pgvector/pgvector:pg16`)
— similarity search stays fast at thousands of meetings per customer. On dev
SQLite the same values are JSON ranked by Python cosine; with no embeddings at
all (AI off), ranking degrades to keyword overlap + recency. Retrieval never
breaks.

**Caps** keep prompts lean: pipeline and chat use the *wide* set (12 meetings,
8 plans, 20 commitments, 15 knowledge items), every string clipped. More
context is not better context — the semantic ranking is what fills those slots
with the *right* history.

---

## 5. The agent system

### 5.1 What an agent is

1. **A system prompt** — a professional persona (*"write like a senior PM at a
   top-tier enterprise SaaS company…"*). Prompts demand real-world formats:
   Given/When/Then acceptance criteria, standard CRM stages, placeholder-free
   emails.
2. **A typed output schema** — a Pydantic model enforced via constrained
   decoding (`NativeOutput`), retried ×3 on validation failure. Outputs
   serialize to camelCase and drop straight into the frontend.
3. **A model** — from the provider-agnostic model service.

### 5.2 The model service

`DEFAULT_MODEL = "provider:name"` resolves against a registry
(`google-gla`, `google`, `ollama`, `anthropic`, `openai`). Switching providers
is an env change; adding one is a registry entry.

| Use case        | DEFAULT_MODEL                         | Key needed    |
| --------------- | ------------------------------------- | ------------- |
| Free dev        | `google-gla:gemini-flash-lite-latest` | Gemini key    |
| Local / offline | `ollama:llama3.1`                     | none          |
| Production      | `anthropic:claude-opus-4-8`           | Anthropic key |

### 5.3 The ten agents

| #  | Agent                  | Reads                          | Produces |
|----|------------------------|--------------------------------|----------|
| 1  | `meeting-intelligence` | transcript **+ context**       | signals: summary, sentiment, urgency, pains, requests, deadlines, revenue |
| 2  | `product-manager`      | signals **+ context**          | PRD draft (internal during pipeline; user-triggered for the stored PRD) |
| 3  | `execution-router` ★   | signals + PRD **+ context**    | **which sections this meeting needs + why** (crm, eng, design, qa, sales, cs) |
| 4  | `crm-analyst`          | signals **+ context**          | CRM update proposal: account summary, stage, risk, field updates w/ evidence |
| 5  | `engineering-planner`  | PRD **+ context**              | architecture, components, estimate, risks |
| 6  | `design-planner`       | PRD **+ context**              | flows, screens |
| 7  | `qa-planner`           | PRD + engineering **+ context**| test strategy, cases, coverage |
| 8  | `sales-planner`        | PRD **+ context**              | positioning, talk tracks, segments |
| 9  | `execution-planner`    | PRD + signals + routing **+ context** | cross-team work items, each with a WHY; timeline derived deterministically |
| 10 | `customer-success`     | signals + account **+ context**| follow-up email + commitments |

Plus `orbit-chat` (answers questions over the context package — §8) and
`leadership-advisor` (defined, not yet wired).

**Every agent receives the same rendered context block** — prior asks, approved
plans, open commitments — with the instruction: reference history, don't
re-commit delivered work, flag repeated themes. No update is ever drafted from
a single meeting in isolation.

### 5.4 The LangGraph pipeline

```
            transcript + ContextPackage
                        │
              meeting-intelligence → signals
                        │
                 product-manager → PRD (internal)
                        │
                execution-router ★ → sections {relevant, reason}
                ╱        │        ╲                (fan-out)
        crm-analyst  engineering  design    ← each skips itself if
                ╲        │  ╲       │          routed irrelevant
                 ╲       │   ╲      ▼
                  ╲      │    ╲   qa   (waits for eng + design)
                   ╲     │    sales
                    ╲    ▼    ╱
                  execution-planner → work items + timeline
                        │
                 customer-success → follow-up email
```

Nodes return **partial state updates** (only the keys they produced) and the
shared `events` list is a reducer channel (`operator.add`) — that is what makes
the three-way parallel branch safe. Returning full state from a node causes
LangGraph's `InvalidUpdateError`.

### 5.5 The execution router

Not every conversation needs every section: a pricing complaint needs no QA; a
support escalation may need no CRM stage change. The router decides per section
with a one-line reason; skipped sections generate nothing and appear in the
graph as `skipped` — with the reason.

### 5.6 Graceful degradation

Every agent call falls back to a deterministic, transcript-derived function on
any LLM failure; with `ENABLE_AI=false` the entire product runs offline. If
LangGraph itself is unavailable, the same nodes run sequentially. Embedding
failures degrade retrieval to keyword ranking. The pipeline never crashes the
request; failed analyses mark the meeting `failed`, never left spinning.

---

## 6. From agent output to the review screen

Persistence (`agents/persistence.py`) writes, per meeting:

- **ExecutionPlan** (table `projects`; `Project` is a compat alias) — the
  central business object: `crm_update`, `engineering`, `design`, `qa`,
  `sales`, `customer_update`, `timeline`, `internal_notes` as JSON sections,
  `approval_status`, `customer_id`, `workspace_id`. **`prd` starts empty** —
  the review screen's *Generate PRD* button (`POST /projects/{id}/generate-prd`)
  creates it on demand from the *current, possibly human-edited* intent plus
  the context package. No PRD exists until a human asks.
- **Graph nodes/edges** — Meeting → Intent → CRM Update → PRD → Plan →
  {Eng, Design, Sales} → QA → Timeline → Email → **Synchronization**. IDs are
  per-meeting (`g_{meetingId}_{kind}`); every node stores its "why"
  (`meta.reason`); the sync node sits `pending` until updates are pushed.
- **Tasks** — work items across all disciplines, each carrying its reason and
  confidence.
- The follow-up email's **recipient is auto-assigned** from the customer's
  learned contact (`Customer.meta.contactEmail`) and shown as an editable
  "To" field.

A signal guard keeps trivial chatter out: only meetings with real feature
requests or pain points produce a plan.

---

## 7. Approval → Knowledge → Synchronization

`POST /meetings/{id}/approve` **locks and prepares — it never executes**:

1. **Lock** — plan PATCH, meeting-analysis PATCH, and all task edits
   (assign/decline/delete included) return 409. Kanban column moves stay open
   (delivery tracking, not plan editing).
2. **Audit** — an `Approval` row records who approved which sections, when.
3. **Knowledge** — `services/knowledge.py` snapshots the approved sections into
   `KnowledgeItem`s: meeting summary, CRM update, PRD, timeline, email, and
   each commitment as an individual open item. **Only approved output becomes
   knowledge — raw AI output is never stored as truth.** Items are embedded for
   semantic recall.
4. **SyncJobs prepared** — one pending job per approved section
   (`crm-update`, `publish-prd`, `create-tasks`, `send-email`). No connected
   destination → the job is `skipped` with a human-readable reason.

**Execution is a separate, human act**: each section's push button calls
`POST /projects/{id}/sync-jobs/{job}/run` (Send email requires a recipient;
sending learns it back onto the Customer). Executors in `services/sync.py`
never fabricate results: `create-tasks` creates **real Linear issues** via the
GraphQL API (`services/linear.py`, personal API key validated on connect);
`crm-update`, `publish-prd` and email delivery are honestly recorded as
on-the-roadmap notes instead of fake deep links. Everything flows through the
audited job pipeline (status / result / error / retry). When the last job
finishes, the graph's Synchronization node completes.

---

## 8. Customers, chat and history

- **Customer identity** (`services/customers.py`): meetings resolve their
  account label to a real `Customer` (normalized name → aliases → email
  domains; suffixes like "Inc" ignored). Generic labels stay unlinked rather
  than guessing. Customers can also be created directly (`POST /customers`).
- **Chat** (`routers/chat.py`): conversations **persist**
  (`chat_conversations`) like Claude/GPT chats — each carries its transcript
  and customer binding. Customer detection is fuzzy ("nortwind" → Northwind
  Labs). No customer named → the answer is grounded in **company-wide context**
  (`build_company_context`: recent signals across customers, open commitments,
  approved proposals, open insights) instead of nagging "which customer?".
  Customer-scoped answers use a *wide* ContextPackage; with AI off, a
  deterministic context-derived answer is returned. History endpoints:
  `GET/DELETE /chat/conversations[/{id}]`.
- **Intelligence** (`routers/insights.py` + `services/insights.py`): the AI-OS
  output layer. `POST /insights/scan` runs deterministic, **evidence-backed**
  detectors — aging open commitments, themes raised across signals, stalled
  proposals, and commitment-vs-Linear gaps (open Linear issues are fetched
  live as a sensor when connected). `POST /insights/brief` renders
  company-wide context through the `intelligence-brief` agent and stores the
  result as an `Insight(kind="brief")` with risks / highlights /
  recommendations in `evidence`. Insights are idempotent by open title and
  acknowledged/resolved via PATCH. Nothing here is generated without evidence
  rows behind it.

---

## 9. The data model

Eighteen tables (JSON-rich), all business rows carrying `workspace_id`:

```
Workspace ─── Customer ──┬─► Meeting (embedding) ──► ExecutionPlan (projects)
                         │        │                     ├─► GraphNode ─► GraphEdge
                         │        ├─► TimelineEvent     ├─► Task
                         │        └─► ActivityEvent     ├─► Approval
                         ├─► KnowledgeItem (embedding)  └─► SyncJob
                         └─► ChatConversation
Member · Agent · Integration · CalendarConnection   (supporting data)
```

**Migrations are Alembic** (`backend/alembic/`), applied automatically at
startup: fresh DB → create_all + stamp head; pre-Alembic DB → stamp baseline +
upgrade (+ a drift repair for old dev DBs); managed DB → upgrade. Schema
changes require a migration, never just a model edit.

---

## 10. Supporting infrastructure

- **Ingestion** — pasted transcripts, **Zoom** (OAuth → cloud-recording VTT
  import) and **Google Meet** (OAuth → transcript *entries* via the Meet REST
  API). Google Calendar is a **read-only** schedule sync. Orbit performs no
  transcription itself.
- **Redis** — optional event stream; no-ops when unset.
- **Auth / tenancy** — Clerk JWT (disabled in dev → demo principal);
  `services/workspace.py` maps org claims to a workspace (dev: `ws_default`).
- **Config** — one settings object from `.env`; the app degrades gracefully
  with none of it set.

---

## 11. The ideas that explain every decision

1. **Orbit proposes; humans approve; tools stay the system of record.**
   Approval locks — it never executes. Every outbound update is an explicit,
   audited human action.
2. **Only approved output becomes knowledge** — and knowledge (retrieved
   semantically, per customer) feeds every future generation. The loop
   compounds.
3. **One Context Engine** — a single, capped, hybrid-retrieval package for
   every generator and the chat. Never dump the database into a prompt.
4. **Provider-agnostic + degrade-gracefully** — swap the LLM by env var; the
   product still runs with no LLM at all.
5. **The graph is the product** — real artifacts, real relationships, a router
   that reasons about *what's needed*, and a "why" on every node.

> **In one sentence:** a transcript enters, Orbit identifies the customer and
> retrieves their history through one Context Engine (SQL facts + pgvector
> semantic recall), a LangGraph pipeline of ten typed agents drafts the full
> execution package, a human edits and approves it (which locks it, audits it,
> and turns it into customer knowledge), each update is explicitly pushed to
> the tools that remain the system of record — and everything approved makes
> the next conversation smarter.
