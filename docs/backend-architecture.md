# Orbit — Backend System & Agent Architecture

A brief but complete explanation of how the Orbit backend works, with a focus on
the AI agents: what they are, how they reason, and how a single customer
transcript flows through them into a company-wide execution plan.

---

## 1. What the backend does

Orbit's backend takes a **customer conversation** (a meeting transcript) and turns
it into **coordinated execution across the whole company** — a PRD, engineering and
design plans, a QA strategy, sales enablement, and a customer follow-up — connected
together in an **execution graph** where every artifact explains *why* it exists.

It is not a meeting summarizer. The job is **execution coordination**: replacing the
manual Customer → Sales → Product → Engineering → Design → QA → Customer Success
handoffs with one automated, explainable pipeline.

**Stack:** FastAPI (async) · LangGraph (agent orchestration) · PydanticAI (typed LLM
wrapper) · SQLAlchemy 2 (async) · PostgreSQL / SQLite · Redis (optional) · Docker.

---

## 2. The four layers

```
┌────────────────────────────────────────────────────────────┐
│  HTTP LAYER        FastAPI + 9 REST routers                  │
│                    (meetings, graph, projects, tasks, ...)   │
├────────────────────────────────────────────────────────────┤
│  AGENT LAYER  ★    The brain: a LangGraph pipeline of 8      │
│                    typed PydanticAI agents + a model service │
├────────────────────────────────────────────────────────────┤
│  PERSISTENCE       Turns agent output into domain rows       │
│                    (Project, GraphNodes/Edges, Tasks)        │
├────────────────────────────────────────────────────────────┤
│  DATA / INFRA      Async SQLAlchemy · Postgres/SQLite ·      │
│                    optional Redis · Clerk auth · settings    │
└────────────────────────────────────────────────────────────┘
```

Everything exists to feed the **agent layer (★)** transcripts and store what it
produces.

---

## 3. The end-to-end flow

When a transcript arrives (`POST /meetings/transcript`), here's the full trip:

```
POST /meetings/transcript
   │
   ▼
[router]  create Meeting row (status = "analyzing")
   │
   ▼
_execute_pipeline(meeting)
   │
   ├─►  run_pipeline()                ← AGENT LAYER runs the 8 agents
   │       returns `state` = {
   │         signals, prd, teams,
   │         engineering, design, qa, sales, customer_update
   │       }
   │
   ├─►  signals_to_analysis(...)      ← normalize for the UI, attach to meeting
   │
   ├─►  if the call had real signals (feature requests / pain points):
   │        persist_execution()       ← PERSISTENCE writes graph + project + tasks
   │     else:
   │        delete_execution()        ← trivial chat → no graph
   │
   └─►  commit + return { analysis, full pipeline state }
```

The same `_execute_pipeline` is shared by two endpoints — `POST /meetings/transcript`
(paste + analyze) and `POST /meetings/{id}/analyze` (re-run a stored meeting) — so
both behave identically. Re-running is **idempotent**: persistence deletes the
meeting's old graph/project/tasks before writing fresh ones.

---

## 4. The agent system (the core)

### 4.1 What an agent is

Every agent is built from **three ingredients**:

1. **A system prompt** — its role and personality (e.g. *"You are Orbit's Engineering
   Planner…"*).
2. **A typed output schema** — a Pydantic model describing exactly what it must
   return. The model is told to use **constrained decoding** (`NativeOutput`), which
   forces valid JSON matching the schema. If validation fails, it retries (×3).
3. **A model** — supplied by the model service, not hard-coded.

In code, that's a one-liner:

```python
Agent(build_model(model),
      output_type=NativeOutput(output_type),   # schema-constrained JSON
      system_prompt=system_prompt,
      retries=3)
```

Because outputs are typed and serialize to **camelCase**, an agent's result drops
straight into the frontend's data shapes with no manual mapping.

### 4.2 The model service — provider-agnostic by design

Agents never name an LLM provider. They call `build_model()`, which reads one
setting, `DEFAULT_MODEL = "provider:name"`, and looks the provider up in a registry:

```
DEFAULT_MODEL = "google-gla:gemini-flash-lite-latest"
                 └ provider ┘ └────── model name ──────┘
                       │
        build_model() → registry → returns a PydanticAI model
        { google-gla, google, ollama, anthropic, openai }
```

| Use case        | DEFAULT_MODEL                          | Key needed     |
| --------------- | -------------------------------------- | -------------- |
| Free dev        | `google-gla:gemini-flash-lite-latest`  | Gemini key     |
| Local / offline | `ollama:llama3.1`                      | none           |
| Production      | `anthropic:claude-opus-4-8`            | Anthropic key  |

**Switching providers is an environment change, not a code change.** Adding a new
provider is a single registry entry.

### 4.3 The eight agents

| # | Agent                  | Reads                | Produces                                            |
|---|------------------------|----------------------|-----------------------------------------------------|
| 1 | `meeting-intelligence` | raw transcript       | signals: summary, sentiment, urgency, pain points, feature requests, opportunities, action items |
| 2 | `product-manager`      | signals              | PRD: problem, goals, non-goals, metrics, user stories |
| 3 | `execution-router` ★   | signals + PRD        | **which teams are relevant + why** (the differentiator) |
| 4 | `engineering-planner`  | PRD                  | architecture, components, week estimate, risks      |
| 5 | `design-planner`       | PRD                  | user flows, screens                                 |
| 6 | `qa-planner`           | PRD + engineering    | test strategy, test cases, coverage estimate        |
| 7 | `sales-planner`        | PRD                  | positioning, talk tracks, target segments           |
| 8 | `customer-success`     | signals + account    | follow-up email draft + commitments                 |

(A ninth, `leadership-advisor`, is defined but not yet wired in — that's the next
phase.)

### 4.4 How they're wired — the LangGraph pipeline

The agents form a **directed graph** (a LangGraph `StateGraph`). Every node is an
async function that reads and updates one shared `state` object. The graph runs in
"supersteps", so branches that don't depend on each other run in parallel, and a
node that needs two inputs waits for both.

```
                    transcript
                        │
                        ▼
              ┌───────────────────┐
              │ meeting-          │  → signals
              │ intelligence      │
              └───────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │  product-manager  │  → PRD
              └───────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ execution-router ★│  → teams {relevant, reason}
              └───────────────────┘     decides WHO is needed
                     ╱       ╲              (fan-out)
                    ▼         ▼
             ┌──────────┐ ┌──────────┐
             │engineering│ │  design  │  ← each skips itself if the
             └──────────┘ └──────────┘     router marked it irrelevant
                  │  ╲        │
                  ▼   ╲       ▼
             ┌──────┐  ▼  ┌──────┐
             │ sales│  └─▶│  qa  │   (qa waits for eng + design)
             └──────┘     └──────┘
                  ╲         ╱
                   ▼       ▼
              ┌────────────────┐
              │ customer-      │   (waits for qa + sales)
              │ success        │
              └────────────────┘
                        │
                        ▼
                    final state
```

### 4.5 The execution router — reasoning about *who* is needed

This is what makes Orbit feel like a human operator rather than a template. Not every
conversation needs every team: a pricing/copy change needs no QA; a backend-only API
fix needs no design; an internal fix needs no sales.

After the PRD is drafted, the **`execution-router`** agent decides, for each of
engineering / design / QA / sales / customer-success, whether it is *genuinely
relevant to this conversation*, and gives a one-line reason. Downstream nodes then
**guard on that decision** — an irrelevant team is skipped entirely instead of
generating throwaway work:

```python
relevant, reason = _relevant(state, "design")
if not relevant:
    state["design"] = {"skipped": True, "reason": reason}
    return state            # no LLM call, no filler
```

**Worked example** — a "504 timeouts on our API" transcript routes to:

| Team             | Decision   | Reason                                                        |
|------------------|------------|---------------------------------------------------------------|
| Engineering      | ✅ run      | Backend optimization and load testing required                |
| QA               | ✅ run      | Must validate the fix under simulated peak load               |
| Customer Success | ✅ run      | Manage the customer's Black-Friday-deadline expectations      |
| Design           | ⏭ skipped  | Purely a backend issue, no UI/UX change                       |
| Sales            | ⏭ skipped  | Technical remediation, no commercial change                   |

The graph then shows engineering / QA / CS as completed nodes and design / sales as
**skipped** nodes — each carrying its reason.

### 4.6 Graceful degradation — the pipeline always completes

Every agent call is wrapped so it can never crash the request:

```python
if AI is enabled:
    try:    return await agent.run(prompt)      # real LLM
    except: log + fall through
return fallback()                               # deterministic, transcript-derived
```

There is a **deterministic fallback for every agent** (regex/heuristics over the
transcript). This means:

- With **no API key / `ENABLE_AI=false`**, the whole product runs **offline** with
  plausible, transcript-grounded output.
- On **any LLM failure** (rate limit, bad JSON, timeout), just that node falls back —
  the pipeline still finishes.
- If **LangGraph itself** is unavailable, the same nodes run sequentially via a
  plain fallback path.

---

## 5. From agent output to the execution graph

Once the pipeline returns its `state`, the **persistence layer** turns it into the
rows the UI reads:

- **A Project** — the umbrella record (name, health, revenue impact, target date),
  with each team's plan mapped onto it.
- **Graph nodes** — Meeting → Feature-Request → PRD → {Engineering, Design, Sales} →
  QA → Customer-Followup. Node IDs are keyed by meeting (`g_{meetingId}_{kind}`) so
  the graph is **per-meeting** and re-runs are idempotent. **Every node stores its
  "why"** (`meta.reason`); skipped teams are saved as `status = "skipped"` with their
  reason and no tasks.
- **Graph edges** — the relationships; each edge encodes *why* an artifact exists
  (this PRD exists *because of* this request).
- **Tasks** — engineering components become tickets, linked back to the meeting and
  graph node.

A **signal guard** decides whether any of this happens: only meetings with real
feature requests or pain points get a graph; trivial chatter is cleaned up.

---

## 6. The data model (brief)

Ten tables (JSON-rich — nested structures like PRDs live in JSON columns):

```
Meeting ──(linked project)──► Project ──┬─► GraphNode ──► GraphEdge
   │                                     ├─► Task
   ├─► TimelineEvent                     └─► PRD / Eng / Design / QA / Sales (JSON)
   └─► ActivityEvent
Member · Agent · Integration  (supporting data)
```

Each table is exposed through a REST router under one API: `/meetings`, `/graph`,
`/projects`, `/tasks`, `/agents`, `/timeline`, `/integrations`, `/activity`,
`/dashboard`.

---

## 7. Supporting infrastructure (brief)

- **Database** — async SQLAlchemy. On startup it creates tables and (optionally)
  seeds a demo dataset. A fresh session is provided per request.
- **Redis** — **optional**. Backs a pipeline event stream; if not configured, the
  helpers no-op and the API runs fine without it.
- **Auth** — Clerk JWT verification. In dev (no Clerk config) auth is **disabled** and
  every request runs as a demo user.
- **Config** — one settings object loaded from `.env`. Everything provider / database
  / auth-related is an environment variable; the app degrades gracefully with none of
  them set.

---

## 8. The two ideas that explain every decision

1. **Provider-agnostic + degrade-gracefully** — swap the LLM by env var, and the
   product still runs even with no LLM at all.
2. **The graph is the product** — agents don't just summarize; they produce real
   artifacts and the relationships between them, reason about *who is actually
   needed*, and explain *why* on every node.

> **In one sentence:** a transcript enters through a router, a LangGraph pipeline runs
> eight typed PydanticAI agents (each with a deterministic fallback) — a routing agent
> decides which teams even participate — and the persistence layer turns the result
> into a per-meeting execution graph where every node is a real artifact that explains
> why it exists.
