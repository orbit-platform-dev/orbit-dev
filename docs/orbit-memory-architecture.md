# Orbit Memory Architecture — HLD + LLD

**Status:** Living engineering reference · **Date:** 2026-07-12
**Companion to:** `docs/orbit-mvp-system-design.md` (this drills into the memory + loop internals)

This document describes how Orbit observes, remembers, understands, reasons,
learns, and how connectors feed it — the "AI Operating System" substrate. It also
records the security model, disconnect semantics, and how memory scales as more
tools are connected.

---

## 0. In plain terms — what Orbit is doing (read this first)

Orbit plugs into the tools your company already uses and quietly keeps a running
understanding of what's going on — so it can tell you the few things that need
you *before* they become problems. Nothing to fill in: it reads, you review.

The loop, in one breath:

1. **Observe** — it reads your tools (Linear tickets, Slack threads, pasted calls).
2. **Remember** — it saves each thing it read, with a link back to the source.
3. **Understand** — it connects the dots: who your customers are, what you
   promised them, what's actually being built.
4. **Reason** — it compares what you *said* you'd do against what's *happening*,
   and spots the gaps, the repeated asks, the wins.
5. **Recommend** — it surfaces those few things in the **Feed**, each with
   evidence and, where useful, a ready-to-go action.
6. **Approve** — you approve / edit / dismiss. Nothing leaves Orbit without you.
7. **Execute** — on approval it writes back into your tool (e.g. creates the Linear issue).
8. **Learn** — your edits and dismissals teach it your judgment; when the work
   ships it marks the promise delivered. Next pass is sharper.

**A concrete example.** On a call (or a Slack thread) you promise Acme SSO. Orbit
remembers that as a *commitment*. It checks Linear, finds no matching issue, and
puts one card in your Feed: *"SSO promised to Acme, no issue exists"* — with the
call as evidence and a drafted Linear issue attached. You click **Approve** → the
issue is created in Linear. When it's completed, Orbit marks the commitment
**delivered** and logs a win. You never touched a spreadsheet.

**Two tabs, two questions.** The **Feed** answers *"what needs me?"* (Orbit talks
to you). **Memory** answers *"what does Orbit know?"* (you look it up). Feed is the
judgment; Memory is the knowledge it reasons from.

---

## 1. High-Level Design (HLD)

Orbit is a **layer above the tools a company already uses**. It never replaces
them; it reads them as **sensors**, keeps a **memory + a model of the company**,
reasons across it, and proposes fixes a human approves that write **back** to
those tools.

```
        SENSORS (read)                 CORE (tool-agnostic)                 ACTUATORS (write)
  ┌───────────────────────┐   ┌──────────────────────────────────┐   ┌────────────────────┐
  │ Linear issues         │   │  MEMORY (observed)                │   │ Linear issue create│
  │ Slack threads         │──▶│    Artifact                       │──▶│ (human-approved)   │
  │ Calls (paste)         │   │  MODEL (derived)                  │   └────────────────────┘
  │ [GitHub …]            │   │    Entity + Link                 │
                              │  INTELLIGENCE                     │
                              │    Insight (finding | brief)      │
                              │  INTENT / LEARNING                │
                              │    Goal · Feedback                │
                              └──────────────────────────────────┘
```

**The loop:** `Observe → Remember → Understand → Reason → Recommend → Approve → Execute → Learn`.

**Two tiers of memory:**
- **Observed tier — `Artifact`.** Everything ingested from any source, verbatim,
  with provenance (source, external ref, url), time, and the Extractor's
  structured output. Broad and automatic. *This is what "Sources" shows.*
  (Embeddings are **not** created here — they're computed lazily only when
  matching needs them; see §2.2.)
- **Derived tier — the company model (`Entity` + `Link`).** Computed from
  artifacts: customers, commitments, feature requests, people, goals, and the
  typed relationships between them. *This is what "Knowledge" shows.*

**Key property:** the core is **tool-agnostic**. `Artifact.source` is just a
string (`linear-issue`, `call`, `slack-message`, and later `github-pr`). Nothing
in the model, reasoning, or learning layers knows a tool's name. Adding a sensor
is adding an adapter, not touching the core.

---

## 2. Low-Level Design (LLD)

### 2.1 Tables (`backend/app/models.py`)

| Table | Tier | Purpose | Key columns |
|---|---|---|---|
| `workspaces` | tenancy | Tenant boundary | `id`, `name` |
| `artifacts` | observed | One ingested item | `source`, `kind`, `external_ref`, `url`, `title`, `content`, `extracted`(JSON), `meta`(JSON), `status`, `occurred_at`, `embedding` |
| `entities` | model | A company-model node | `kind` (customer/commitment/feature/person/goal), `name`, `normalized_name`, `aliases`, `identifiers`, `meta`, `state` (open→tracked→delivered) |
| `links` | model | Typed relationship | `from_type/from_id`, `to_type/to_id`, `type` (source_of/made_to/requested_by/fulfills/mentions), `source_artifact_id` |
| `insights` | intelligence | Finding / recommendation / brief | `kind` (gap/drift/trend/win/brief), `status` (open/approved/dismissed/resolved), `entity_ids`, `artifact_ids`, `action`(JSON), `dedupe_key` |
| `goals` | intent | Declared intention | `title`, `detail`, `target_date`, `status` |
| `feedback` | learning | One human correction | `section`, `field`, `before`, `after` |
| `integrations` | connectors | Connector row + credentials | `key`(PK), `status`, `account`, `credentials`(JSON, never exposed) |
| `activity_events` | audit | What Orbit/humans did | `actor`, `action`, `target` |

Every business row carries `workspace_id` **except `integrations`** (see §4).

### 2.2 The ingestion → understanding pipeline

`ingest_artifact()` (`services/ingestion.py`) is the single write path for any
observed item:

1. **Idempotency** — dedupe by `(workspace_id, source, external_ref)`; re-pulling
   never duplicates memory.
2. **Extract** (`agents/extractor.py`) — the Extractor turns raw content into
   `{summary, commitments, requests, decisions, entities}`.
   - **Calls and Slack threads** → the LLM Extractor (intent and commitments live
     in conversation).
   - **Linear issues** → **deterministic** extraction (summary only). Issues are
     execution reality, not a source of commitments; this is faster and keeps the
     model from being polluted with spurious commitments.
3. **No embedding on ingest.** Vectors are computed **lazily** during matching
   (§2.2 step 4), only when something actually reads them — so syncs stay fast and
   we never pay to embed a 652-issue backlog nothing queries.
4. **Build the model** (`services/model.py::build_from_artifact`):
   - `resolve_entity` — find-or-create by `normalized_name` (handles aliases).
   - `ensure_link` — idempotent typed edges (call→commitment `source_of`,
     commitment→customer `made_to`, request→customer `requested_by`).
   - `match_commitment_to_linear` — **deterministic `text_match` first**
     (shared-token + difflib ≥ 0.82); if that misses, a **lazy vector pass**
     (embeddings computed on demand for open issues, cached, cosine ≥ 0.75)
     catches semantic matches like "SSO" ↔ "single sign-on". A match links the
     commitment to its fulfilling Linear issue → `state = tracked`.

### 2.3 Reasoning (`services/reasoning.py`)

Deterministic detectors produce candidate findings with hard evidence; the LLM
only narrates/ranks/drafts — it never decides truth.

| Detector | Fires when | Finding |
|---|---|---|
| commitment-vs-Linear | open commitment with no `fulfills` link | **gap** (+ prepared Linear issue action) |
| repeated demand | a feature `requested_by` ≥ 2 customers | **trend** |
| unrequested work | ≥ 3 open Linear issues linked to nothing | **drift** |
| loop closure | a fulfilling issue reaches `completed` | **win** (commitment → delivered) |

`_upsert` dedups by `dedupe_key`, **resolves** findings whose condition no longer
holds, and **never resurfaces** a dismissed/approved key. The brief
(`kind="brief"`) is excluded from the resolve sweep.

### 2.4 The heartbeat (`services/heartbeat.py`)

A lifespan-managed loop. Per tick, per workspace: `pull_all` (Observe) →
`detect_findings` (Reason) → refresh brief if stale. It **only reads and writes
memory/findings — it never executes an outbound action or approves anything.**
`run_now()` is the same path triggered immediately on connect / "Scan now", with
progress streamed to the UI via `GET /heartbeat.sync`.

---

## 3. Provenance (trust is the product)

Every derived fact traces back to an artifact:
- A `Link` carries `source_artifact_id`.
- An `Insight` carries `entity_ids` + `artifact_ids` (its evidence).
Nothing is shown that can't be traced to a source. No claim without provenance.

---

## 4. Security & Multi-Tenancy

**Tenancy today.** `workspace_id` scopes every business row and is resolved once,
in `services/workspace.py::get_workspace_id` (Clerk `org_id` claim → workspace;
dev/demo → `ws_default`). All reads/writes filter by it.

**Credentials.** `Integration.credentials` (API key or OAuth token) is stored
server-side and **never serialized** — `IntegrationOut` omits it. OAuth tokens are
requested with least-privilege scopes (`read,write` for Linear).

**Known gaps (must close before multi-tenant GA):**
1. **`integrations` has no `workspace_id`.** Connectors are **global** — one Linear
   connection shared across all workspaces. Fine for single-tenant dev; a
   **cross-tenant data-leak risk** the moment there are two real workspaces. Fix:
   add `workspace_id` to `integrations` (composite key `workspace_id + key`) and
   scope every connector lookup. This is the "going into a different workspace"
   concern — the connector, and the workspace it reads, must be pinned to the
   Orbit workspace that owns it.
2. **OAuth callback is unauthenticated** (a browser redirect). It targets the
   default workspace today; with real tenancy the workspace must be carried in the
   signed OAuth `state` and verified on return.
3. **Credentials at rest are plaintext JSON.** Encrypt at rest (KMS / app-level
   envelope encryption) before GA.

---

## 5. Connection & Disconnection Lifecycle — the loop as a user lives it

This is exactly what happens when a founder connects or disconnects a tool,
mapped to `Observe → Remember → Understand → Reason → Recommend → Approve →
Execute → Learn`.

### On connect · `[Observe → Remember → Understand → Reason → Recommend]`

1. **Authorize.** The user clicks "Connect with X" (OAuth) or pastes an API key.
   The credential is validated **live** against the tool and stored server-side
   (never exposed). A bad credential fails loudly — nothing is assumed.
   (`routers/integrations.py` → `linear.validate_key` / OAuth `exchange_code`.)
2. **Immediate sync — no waiting for the next tick.** Connecting fires
   `heartbeat.start_sync(workspace, "…-connect")`, which runs the whole path at
   once and streams progress to the UI via `GET /heartbeat.sync`:
   - **Observe** — `pull_all` reads the tool (Linear: *every* issue, paginated,
     full descriptions; Slack: threads in the channels the bot is in).
   - **Remember** — each new item becomes an `Artifact` (idempotent by
     `external_ref`), with provenance, `occurred_at`, and an embedding.
   - **Understand** — the Extractor structures it; `build_from_artifact` resolves
     entities and forms links (commitment→customer, commitment→issue, …).
   - **Reason** — detectors + the Reasoner produce findings and refresh the brief.
3. **See it live.** The Feed's scan surface shows *"Orbit is scanning your
   workspace…"* → *"Analysed N issues, M customers, K commitments, X findings"*,
   and Memory + Feed refresh automatically. The user did nothing but authorize —
   no data entry. That is the "legible by default" promise.

### While connected · `[Observe … Execute … Learn]`

The heartbeat re-runs the same path every interval, per workspace, pulling only
*new* items (idempotent) and re-reasoning. When a human **approves** a finding it
writes back to the tool (`[Execute]`); the **outcome watcher** notices the issue
complete and advances the commitment to `delivered` (`[Learn]`); **edits and
dismissals** become corrections that sharpen the next pass (`[Learn]`).

### On disconnect · `[stop Observe, keep Remember]`  *(implemented)*

1. Credentials are cleared and status flips to `disconnected` — **pulling stops.**
2. That source's artifacts are flagged **`stale`** via `set_source_stale()` — kept
   as history and shown **"No longer syncing"** in Memory. Memory is never
   silently deleted: a commitment made on a call, or an issue that shipped, is
   still true after you unplug the tool.
3. **Reconnect** clears the `stale` flag and resumes syncing (and immediately
   re-syncs).
4. A separate, explicit **"Forget this source's data"** purge is the *only* path
   that deletes artifacts+links — **disconnect ≠ delete** (future, confirm-gated).

**Isolation note:** connect/disconnect and every read are per **workspace**
(tenant). Today `Integration` is global (§4) — closing that is the prerequisite
for real multi-tenant isolation.

---

## 6. How Orbit Learns (honest)

Two real mechanisms, and their limits:

1. **Durable suppression.** Dismiss/approve a finding and its `dedupe_key` is
   blocked forever — Orbit never nags twice. Durable and genuinely useful.
2. **Correction memory.** Edits and dismissals become `Feedback` rows;
   `render_corrections` injects the most recent ~8 into the Extractor and Reasoner
   prompts, so extraction and drafting converge on the team's judgment.

**Limits (be honest):** it is last-N corrections as prompt text (global, not
per-customer/per-pattern), and only the two LLM calls see it — the deterministic
detectors don't "learn," they're suppressed per-key. There are no weights and no
fine-tuning. Outcome-weighted ranking and per-entity preference learning are
explicitly post-MVP. So "learning" today = *remembers your recent corrections +
never repeats a dismissed finding*, converging the company model as more real
activity flows in. That convergence is the moat; the depth compounds later.

---

## 7. Scaling: many sources, many artifacts

Connecting Linear ingested **652 issues** — the "Sources" tab becomes a firehose,
and with 5–10 connectors it is unusable as a flat list. The fix is a product +
data stance, not more raw rows:

- **Memory is entity-first, not artifact-first.** The primary surface is
  **Knowledge** (customers, commitments, requests) — a bounded, meaningful set.
  **Sources** is the audit/provenance drawer, **not** the daily view.
- **Sources must be filtered + paginated by source and time** (already time-
  filtered; add a source filter and server-side pagination). Never render 652 rows.
- **Signal, not noise.** The value isn't "we stored 652 tickets"; it's the handful
  of **findings** the tickets + calls produce. The Feed is the surface; Sources is
  the receipts.
- **Reasoning cost stays bounded** because issues are extracted deterministically
  (no per-ticket LLM) and detectors are aggregate (e.g., drift is one finding for
  N unlinked items, not N findings).

---

## 8. Extending with a new sensor (the pattern we actually use)

A sensor is a small module that turns a tool's data into `Artifact`s; the core is
untouched. Each connector module exposes the **same OAuth interface** so the
router drives them generically, and adds a `pull_*` that `pull_all` calls.

```
services/
  linear.py    # OAuth iface (oauth_configured/oauth_url/exchange_code/account_name/get_auth)
  slack.py     #   + same iface  (DONE — threads in bot channels → source="slack-message")
  ingestion.py # pull_linear + pull_slack; pull_all() = every connected sensor
routers/integrations.py
  PROVIDERS = {"linear": linear, "slack": slack}   # generic /{key}/oauth/{start,callback}, /{key}/disconnect
```

To add the next sensor (e.g. GitHub): write `services/github.py` with that same
interface + a `pull_github`, add it to `PROVIDERS` and `pull_all`, add a seed row,
and register the artifact source in `SOURCE_BY_INTEGRATION` (for disconnect/stale).
Each adapter (1) resolves its own credential, (2) fetches new items paginated,
(3) calls `ingest_artifact(..., source="<tool>-<kind>")`. **Nothing in `model.py`,
`reasoning.py`, or `learning.py` changes** — that is the connective layer.

*(A `services/sensors/` package with a formal `Sensor` protocol + registry is the
natural next refactor once there are ~4 connectors; today two modules with a
shared interface are enough.)*

**Doc alignment note:** `orbit-mvp-system-design.md` scoped the MVP to **Linear
only**; **Slack** was added as a deliberate, founder-directed expansion (GitHub is
next). All new sensors must obey the engineering principles (evidence, never
replace systems of record, human approval, reuse before rewrite).
