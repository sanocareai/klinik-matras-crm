# Wave 4 — Sano Intelligence Engine — Architecture Proposal

> **Status:** Proposal for approval — *no code.*
> **Goal:** a **low-cost, scalable, rule-based** sales-intelligence layer over existing CRM
> data. Sano becomes *"an AI-powered sales decision system that tells salespeople who needs
> attention, why, and what to do next."* **Not** a chatbot, general assistant, or LLM
> workflow. **Wave 4A = rule-based only (no LLM).** Wave 4B (selective LLM) is later, gated.
> **Frozen:** WAHA, SSE, Inbox, WebSocket, authentication, existing customer/order APIs.

---

## 0. The key finding: the engine already exists — but scattered & duplicated

Waves 2B and 3A already shipped most of this intelligence — **rule-based, explainable, no
LLM.** The problem is it lives in **two places with two different formulas**:

| Capability | Where it lives today | Issue |
|---|---|---|
| Hot-lead score (`HOT_WEIGHTS`, `INTENT_RE`) | `backend/src/routes/analytics.js` | server-side, one formula |
| Customer Health/Score (`computeHealthScore`, base 50) | `frontend/customer360/lib/healthScore.js` | client-side, **different** formula |
| Signals / next action | `analytics.js` **and** `customer360/lib/customerSignals.js` | duplicated logic |
| Follow-ups, recommendations | `analytics.js` | server-side |
| Buying-intent keywords | `INTENT_RE` (`harga`, `katalog`, `order`…) | only in hot-leads |

**So Wave 4A is primarily a consolidation + elevation, not a from-scratch build:** unify all
scoring/signal/action logic into **one backend Intelligence Engine** (single source of
truth), then expose it through a dedicated **Sano Intelligence** surface and let Customer360
+ Hot Leads + Recommendations all read from it. This kills the current drift (a customer can
show one "score" on the dashboard and a different one in the drawer today).

---

## 1. Architecture principle — Hybrid Engine (Layer 1 now, Layer 2 later)

```
                         ┌─────────────────────────────────────────┐
   CRM DATA (existing)   │        SANO INTELLIGENCE ENGINE          │
   Customer, Conversation│                                         │
   Message, Order, Note, │   Signal Detection → Scoring → Insight   │
   Complaint, Pipeline,  │        → Next-Best-Action                │
   SalesTarget           │   (pure, deterministic, explainable)     │
        │                └──────────────────┬──────────────────────┘
        └───────────────────────────────────┘
                         │
                         ▼
        Read-only, role-scoped Intelligence API
                         │
                         ▼
        Sales Intelligence UI (dashboard section + Customer360 + Hot Leads)

   ── Layer 2 (Wave 4B, DEFERRED) ────────────────────────────────
        Only for a SELECTED high-value customer, on demand:
        Customer context → LLM → richer summary / reply suggestion
        (never bulk, never automatic, cost-capped)
```

- **Layer 1 (Wave 4A):** 100% rule-based. Zero external API cost. Deterministic and
  explainable — every score traces to named signals; no hallucination; never labeled "AI".
- **Layer 2 (Wave 4B):** optional LLM enhancement for *individual* high-value cases only
  (a button, not a pipeline). Out of scope here; the engine is designed so Layer 2 plugs in
  without changing Layer 1.

---

## 2. Wave 4A components (design)

### 2.1 Customer Priority Engine — "who needs attention?"
A **Priority Score (0–100)** answering *urgency to act now* (distinct from the 3A
**Customer Score** which is relationship health/value — both come from the same signal
engine, weighted differently; see §note).

**Signals (all from existing data):**
- **Positive / opportunity:** recent conversation (recency), buying-intent keywords,
  quotation activity (QUOTED), order history (count), high transaction value.
- **Negative / risk:** unresolved complaint, unanswered customer message, inactivity,
  abandoned quotation (QUOTED but silent > N days).

**Output:** `{ priorityScore, reasons[], recommendedAction }` — e.g.
```
Bapak Andi — 85
  ✓ Pernah beli paket premium
  ✓ Menanyakan harga produk
  ⚠ Belum dibalas 3 hari
  → Follow up hari ini
```
Priority = weighted blend of **opportunity** (value + intent) **and** **risk/urgency**
(unanswered, complaint, going cold). A high-value customer who just asked price and hasn't
been answered ranks highest.

### 2.2 Sano Insight Generator — explainable summary (NOT "AI")
Rule-based, **templated** natural-language summary from the detected signals (server-side
formalization of the current `buildOverviewText`). Example:
> "Pelanggan punya riwayat pembelian kuat, namun ada komplain yang belum selesai.
> Pendekatan yang disarankan: follow-up retensi."

Requirements honored: transparent rules, explainable signals, **no hallucination, no fake
AI claims.** Named "Sano Insight" with a "Rule-based" tag (as in 3A).

### 2.3 Next-Best-Action Engine — ordered IF/THEN rules
A small, ordered, **table-driven** rules engine (formalizes today's scattered `deriveNextAction`
+ recommendation rules). Examples:
```
IF complaint = true AND lastContact > 24h        → "Selesaikan komplain segera"   (urgent)
IF quotation sent AND no response > 3 days        → "Follow up penawaran"          (high)
IF returning customer AND lastOrder > 12 months   → "Tawarkan repeat order"        (medium)
IF qualified AND no order                          → "Tawarkan rekomendasi kasur"   (medium)
ELSE                                               → "Jaga hubungan — pantau berkala"
```
First matching rule wins; each returns `{ action, reason, urgency }`. Rules live in **one
config** so they're readable and adjustable by a single dev.

### 2.4 Opportunity Detection — improve Hot Leads
An **Opportunity Score** (explainable, not a prediction) from:
- **Keywords (Bahasa Indonesia):** `harga`, `ukuran`, `promo`, `cicilan`, `ready`, `katalog`
  (extends today's `INTENT_RE`), each mapped to a labeled signal.
- **Behavior:** repeated recent conversations, quotation requested, active thread.
Output feeds/upgrades the existing Hot Leads list with clearer "why" chips. Keyword matching
is naive by design (Layer-2 LLM can add nuance later) — kept transparent.

### 2.5 Sano Intelligence Dashboard — new section
A dedicated **"Sano Intelligence"** dashboard block (evolves the current Band-2 "Sano
Intelligence" zone) with four lists:
- **🔥 Priority Customers** — ranked by Priority Score, each with reasons + one action.
- **✅ Today's Actions** — the Next-Best-Action worklist for today (role-scoped).
- **⚠ Risk Customers** — high negative-signal (complaints, going cold, abandoned quotes).
- **💡 Sales Opportunities** — high Opportunity Score (buying signals) not yet closed.
```
🔥 Need Attention
  Bapak Andi
  Alasan: Komplain belum selesai · Belum dibalas 3 hari
  Aksi:   Hubungi customer
```
Each card deep-links to Customer360 / Inbox (existing routes). This supersedes and unifies
the current Hot Leads / Follow-ups / Recommendations widgets under one coherent engine.

> **Note — two scores, one engine:** *Customer Score* (3A, health/value: "how strong is this
> relationship?") and *Priority Score* (4A, urgency: "who do I act on now?"). Same signal
> detector, different weightings. The proposal unifies the **signal + scoring code**; the two
> *outputs* remain distinct and clearly labeled to avoid confusion.

---

## 3. Component structure

**Backend — new service module (the source of truth):**
```
backend/src/services/intelligence/
  signals.js         detectSignals(customer, conversations, orders) → { positive[], negative[], flags, meta }
  weights.js         ONE central, adjustable config: weights, thresholds, keyword map
  priorityScore.js   computePriority(signals) → { score, reasons[] }
  opportunityScore.js computeOpportunity(signals) → { score, reasons[] }
  insight.js         generateInsight(signals, scores) → templated string
  nextBestAction.js  ordered IF/THEN rules → { action, reason, urgency }
  index.js           buildCustomerIntelligence(ctx) — orchestrates the above
  README.md          documents rules & weights (adjustable by one dev)
backend/src/routes/intelligence.js   new router (read-only, requireAuth, role-scoped)
```
Existing `analytics.js` hot-leads/recommendations/follow-ups are **refactored to call this
module** (same response shapes preserved → the verify script still passes).

**Frontend — new dashboard section + Customer360 alignment:**
```
frontend/src/features/intelligence/
  components/ IntelligenceSection, PriorityCustomers, TodaysActions, RiskCustomers,
              SalesOpportunities, PriorityCustomerCard
  hooks/      useIntelligence (React Query)
frontend/src/api.js  + intelligence read methods
```
`components/customer360/lib/{healthScore,customerSignals}` become a **thin client** that
renders server intelligence (via `GET /customers/:id/intelligence`) instead of recomputing —
removing the dual-formula drift. (Optionally keep a minimal client fallback.)

---

## 4. Data flow
```
Customer / Conversation / Message / Order / Note / Complaint / Pipeline / SalesTarget
        │  (existing endpoints & queries — no new data required)
        ▼
signals.detectSignals()                         ← Signal Detection
        ▼
priorityScore + opportunityScore (weights.js)   ← Scoring Engine
        ▼
insight.generateInsight() + nextBestAction()    ← Insight + Recommendation
        ▼
GET /intelligence/*  and  GET /customers/:id/intelligence   (read-only, role-scoped)
        ▼
Sano Intelligence dashboard section  +  Customer360  +  Hot Leads
        ┊
        ┊ (Wave 4B, deferred) high-value customer → LLM enhancement (on demand)
```

---

## 5. Technical requirements (as requested)

### 5.1 Database impact
- **None required for correctness.** Everything is computable from existing tables using the
  same access paths as 2B (Customer, Conversation, Message, Order, Note, SalesTarget). No
  changes to existing customer/order APIs or schema.

### 5.2 New tables (only if/when scale demands)
- **Optional, deferred:** a precomputed read-model, e.g.
  `CustomerIntelligence { customerId (unique), priorityScore, opportunityScore, signals Json,
  nextAction Json, computedAt }` — a **cache/snapshot** refreshed by a background job.
- **Recommendation: do NOT add it in 4A.** At current scale (≤ ~thousands of customers,
  50–100 msgs/day) on-demand compute is trivial. Add the snapshot table only if profiling
  later shows a need (its own migration + checkpoint). Keeps schema untouched now.

### 5.3 API changes (all additive, read-only, role-scoped)
- New router `GET /api/intelligence/…`:
  - `/priority` → Priority Customers · `/actions` → Today's Actions · `/risk` → Risk
    Customers · `/opportunities` → Sales Opportunities.
- `GET /api/customers/:id/intelligence` → per-customer `{ priority, opportunity, insight,
  nextAction, signals }` for Customer360.
- Existing `analytics.js` endpoints keep their response shapes (internally delegate to the
  engine). **No existing route signature changes.**

### 5.4 Scoring architecture
- **One pure, deterministic module** with a **single `weights.js` config** (weights,
  thresholds, keyword map) — adjustable in one place, unit-testable, explainable. Signal
  detectors are pure functions; scorers compose signals; the insight + next-action layers are
  templated. No randomness, no external calls. This is the anti-drift core.

### 5.5 Background processing strategy
- **4A: none — compute on demand per request** (cheap, bounded queries, parallelized on the
  client via React Query). No queue, no worker, no new infra (respects "maintainable by one
  dev").
- **Later (optional):** a simple scheduled recompute (e.g. `node-cron` in the existing
  backend process, or a periodic `scripts/` run) populating the snapshot table — **only** if
  volume grows. Explicitly deferred; not part of 4A.

### 5.6 Performance
- Small dataset; each endpoint runs a **bounded, fixed** set of queries reusing existing
  indexes (`Conversation[status,lastMessageAt]`, `[assignedToId,status]`, `Order[customerId]`);
  target < 50ms. No N+1 (nested `take:1` / aggregates as in 2B). Client caches with
  `staleTime` 30–60s. Snapshot table is the scale lever if ever needed.

### 5.7 Security
- Reuse `requireAuth` (router-level) + the **2B role-scoping**: SALES = own + unassigned
  claimable only; ADMIN = team. Enforced server-side, never via client params. **Field
  surface locked to explicit contracts** (no PII beyond contract) — extend the existing
  `verify-wave2b.mjs`-style checks with an intelligence verifier. Read-only; no writes.

---

## 6. Implementation phases (4A)
Each phase is additive, independently shippable, and (for backend) preceded by a **pre-code
checkpoint** like 2B (contracts, queries, permissions, perf).

| Phase | Deliverable | Touches |
|---|---|---|
| **4A.0** | Engine core: `services/intelligence/*` (pure fns) + `weights.js` + unit tests. Refactor `analytics.js` hot-leads/recs/follow-ups to call it (shapes unchanged; verify script still green). | Backend (additive + internal refactor) |
| **4A.1** | Intelligence API: new `/api/intelligence/*` + `/customers/:id/intelligence`, role-scoped. | Backend (additive routes) |
| **4A.2** | Sano Intelligence dashboard section (Priority / Today's Actions / Risk / Opportunities). | Frontend |
| **4A.3** | Customer360 consumes server intelligence (unify scoring; remove client-side drift). | Frontend |
| **4A.4** | Intelligence verifier script (role-scoping + field-leak + shape) + docs of rules/weights. | Backend script + docs |
| **4A.5** *(optional, deferred)* | Snapshot table + scheduled recompute — only if perf needs it. | Backend + 1 migration (separate approval) |

Wave 4B (selective LLM: AI summary / explanation / reply suggestion) is evaluated **after 4A
is stable** — separate proposal, cost-capped, on-demand per customer only.

---

## 7. Risk assessment
| # | Risk | Level | Mitigation |
|---|---|---|---|
| R1 | Refactoring `analytics.js` to the shared engine changes hot-leads/recs/follow-ups behavior | Med | Keep response shapes identical; port the exact current rules first, then improve; re-run the verify script (shape + role + field-leak) |
| R2 | Scoring **drift** persists if frontend keeps its own formula | Med (the thing we're fixing) | Customer360 reads server intelligence (4A.3); delete/deprecate client scoring |
| R3 | Over-engineering (snapshot table, cron) at small scale | Med | Deferred by default; on-demand compute in 4A; add infra only on measured need |
| R4 | Scoring quality / weight tuning needs product judgment | Med | Central `weights.js` + documented rules; easy to tune; explainable outputs make tuning safe |
| R5 | Keyword buying-signals are naive (miss nuance / false positives) | Low | Transparent by design; Layer-2 LLM (4B) adds nuance later; keywords in one editable map |
| R6 | Role data leakage / new endpoints | Low | Reuse 2B `requireAuth` + scoping + a new verifier script; read-only |
| R7 | Touching frozen zones (WAHA/SSE/Inbox/auth/existing APIs) | Low | Engine is a **new** service + **new** routes; existing routes only delegate internally, signatures unchanged; nothing in inbox/WAHA/SSE/auth touched |
| R8 | Scope creep (5 components + dashboard + Customer360) | Med | Strict phase gates (4A.0→4A.4); each shippable; LLM explicitly deferred |
| R9 | "Feels like AI / fake precision" | Low | Named rule-based; integer scores + categories, not false decimals; signal chips always shown |

---

## 8. Open questions for approval
1. **Scope of first build:** 4A.0 (engine core + refactor) alone first, or 4A.0 + 4A.1 (engine + API) together before any UI?
2. **Priority vs Customer Score:** keep both distinct (recommended) or collapse into one score on all surfaces?
3. **Weights/rules:** any product input on weightings now, or ship sensible defaults in `weights.js` and tune after seeing real output?
4. **Snapshot table:** confirm we **defer** it (on-demand compute for 4A) — yes/no.
5. **Backend checkpoint:** confirm each backend phase (4A.0/4A.1) gets a pre-code review checkpoint (contracts, SQL, permissions, perf) like Wave 2B.
