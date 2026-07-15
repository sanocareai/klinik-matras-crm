# Wave 4A (4A.0 + 4A.1) — Implementation Checkpoint (REVIEW BEFORE CODE)

> **Status:** Pre-code review gate — *no code written.*
> **Scope:** Backend Intelligence Engine (4A.0) + read-only Intelligence API (4A.1). **No UI.**
> **Frozen:** WAHA, SSE, Inbox, WebSocket, authentication, existing customer/order API
> **contracts** (response shapes). No schema migration, no writes.
> **Four separate scores** (decision #2), never merged:
> Health (relationship quality · Customer360) · Priority (sales urgency · Dashboard) ·
> Opportunity (buying probability · Hot Leads) · + Next Best Action.

---

## 1. Exact files to modify / create

### Create — engine (pure, deterministic, no prisma, no LLM)
| File | Responsibility |
|---|---|
| `backend/src/services/intelligence/weights.js` | **Single source of tunable config**: weights, thresholds, keyword map. |
| `backend/src/services/intelligence/signals.js` | `detectSignals(ctx)` → normalized, labeled signal set (pure). |
| `backend/src/services/intelligence/healthScore.js` | `computeHealth(signals)` → relationship-quality score (exact port of current 3A formula). |
| `backend/src/services/intelligence/priorityScore.js` | `computePriority(signals)` → sales-urgency score. |
| `backend/src/services/intelligence/opportunityScore.js` | `computeOpportunity(signals)` → buying-probability score. |
| `backend/src/services/intelligence/insight.js` | `generateInsight(signals, scores)` → templated explainable text. |
| `backend/src/services/intelligence/nextBestAction.js` | ordered IF/THEN rules → `{ action, reason, urgency }`. |
| `backend/src/services/intelligence/index.js` | `buildCustomerIntelligence(ctx)` (pure composition) + `loadCustomerContext(prisma, id)` / `loadCandidates(prisma, scope)` (the only prisma access). |
| `backend/src/services/intelligence/README.md` | documents rules + weights (adjustable by one dev). |

### Create — API + verifier
| File | Responsibility |
|---|---|
| `backend/src/routes/intelligence.js` | new router: `GET /priority`, `GET /opportunities` (router-level `requireAuth`). |
| `backend/scripts/verify-wave4a.mjs` | ADMIN/SALES scoping + field-leak + shape checks (like verify-wave2b). |

### Modify — additive only (no existing route/contract changed)
| File | Change |
|---|---|
| `backend/src/index.js` | one line: `app.use("/api/intelligence", intelligenceRouter)` + import. |
| `backend/src/routes/customers.js` | **add one additive route** `GET /:id/intelligence` (router already has `requireAuth`); existing routes untouched. |

### NOT touched in this scope
`analytics.js` (hot-leads/recommendations/follow-ups stay as-is — gradual migration, §5),
frontend, schema, inbox, WAHA, SSE, auth middleware.

---

## 2. Intelligence module architecture
```
Route (intelligence.js / customers.js)
   │  requireAuth + role scope (req.user)
   ▼
index.js
   ├─ loadCustomerContext(prisma, id)      ← ONLY prisma access (bounded queries)
   ├─ loadCandidates(prisma, scope)        ← for list endpoints
   └─ buildCustomerIntelligence(ctx)  ─────────────────┐   (pure)
                                                        ▼
        signals.detectSignals(ctx) ──► { recencyDays, lastInbound, waitingMinutes,
                                          orderCount, orderValue, lastOrderDaysAgo, stage,
                                          complaintsOpen, intent[], activityCount,
                                          quotationAbandoned, isReturning, labels[] }
                     │
     ┌───────────────┼───────────────┬──────────────────┐
     ▼               ▼               ▼                  ▼
 computeHealth   computePriority  computeOpportunity  nextBestAction
     │               │               │                  │
     └──────────── generateInsight(signals, scores) ─────┘
                     ▼
   { health, priority, opportunity, nextAction, insight, signals }
```
- **Pure functions** take a plain `ctx`/`signals` object — no DB, no I/O, no randomness →
  unit-testable, deterministic, explainable.
- **`loadCustomerContext` / `loadCandidates`** are the only prisma callers (bounded, reuse 2B
  query patterns: nested `take:1` for last message, `orders` select, aggregates).

---

## 3. Scoring formulas (explicit — all clamp 0–100, integer)

### 3.0 Signals (shared input)
From `Customer` (+orders, notes, complaint fields), `Conversation`+`Message` (recency/last
direction/keywords), computed once:
`recencyDays`, `lastInbound`, `waitingMinutes`, `orderCount`, `orderValue`,
`lastOrderDaysAgo`, `stage`, `complaintsOpen`, `intent[]` (matched keywords),
`activityCount` (msgs in last 3 days), `quotationAbandoned` (stage QUOTED & recencyDays>3),
`isReturning` (orderCount≥1).

**Keyword map (`weights.js`, Bahasa Indonesia):**
```
price:       /harga|berapa|nego|biaya/i
size:        /ukuran|dimensi|160|180|200/i
promo:       /promo|diskon|potongan/i
installment: /cicilan|kredit|tempo/i
ready:       /ready|stok|tersedia|sedia/i
catalog:     /katalog|foto|gambar|brosur/i
```

### 3.1 Customer Health Score — relationship quality (EXACT PORT of 3A)
Behavior-preserving so Customer360 is unchanged when it later migrates.
```
base 50
+ orderCount>0 : +20 + min(15, round(orderValue/5,000,000 * 15))
+ stage WON +15 | QUOTED +10 | QUALIFIED +5
+ recencyDays ≤2 +15 | ≤7 +10 | ≤14 +5
− complaintsOpen>0 : −25
− recencyDays >60 : −25 | >30 : −15
− lastInbound & waitingMinutes>180 : −10
category: ≥80 Sehat · 50–79 Perlu Perhatian · <50 Berisiko
trend: rule-based up/down/flat (as 3A)
```

### 3.2 Priority Score — sales urgency ("act now")
Urgency signals weighted high; value pulls it up.
```
base 0
URGENCY:
  + complaintsOpen>0                         : +30
  + lastInbound & waitingMinutes>180         : +25, plus +min(10, daysWaiting*3)   (unanswered, worse over time)
  + quotationAbandoned                       : +20
VALUE / OPPORTUNITY PULL:
  + any intent keyword                       : +10
  + orderValue ≥ 5,000,000                   : +10
  + stage QUOTED                             : +8
  + recencyDays ≤2                           : +7
clamp 0–100
reasons[]        = the fired signals (human labels, e.g. "Belum dibalas 3 hari")
recommendedAction = nextBestAction(signals).action
```

### 3.3 Opportunity Score — buying probability (drives Hot Leads)
Expanded keyword set + behavior (improves current hot-leads).
```
base 0
+ intent keywords: price +20, ready +15, catalog +12, size +10, promo +8, installment +8   (cap 45)
+ stage QUOTED +20 | QUALIFIED +8
+ activityCount ≥3 (percakapan aktif)        : +15
+ isReturning (repeat customer)              : +10
clamp 0–100
signals[] = matched keywords + behavior labels
```

### 3.4 Next Best Action — ordered IF/THEN (first match wins)
```
IF complaintsOpen>0 AND recencyDays≥1      → "Selesaikan komplain — telepon langsung"  (urgent)
IF lastInbound AND waitingMinutes>180       → "Balas follow-up yang menunggu"           (high)
IF quotationAbandoned                       → "Follow up penawaran"                      (high)
IF isReturning AND lastOrderDaysAgo>365      → "Tawarkan repeat order"                    (medium)
IF stage QUALIFIED AND orderCount=0          → "Tawarkan rekomendasi kasur"               (medium)
IF recencyDays>30                            → "Reaktivasi — kirim info/penawaran"        (low)
ELSE                                         → "Jaga hubungan — pantau berkala"           (low)
```

### 3.5 Insight — templated, explainable (NOT "AI")
Composed from fired signals, e.g.:
> "Riwayat pembelian kuat (3 order · Rp8,5jt), namun ada komplain belum selesai.
> Pendekatan disarankan: follow-up retensi." — always traceable to signals; no hallucination.

---

## 4. API contracts (additive, read-only, role-scoped)

**Role scope (reused from 2B, server-enforced):** `ADMIN` → team-wide; `SALES` →
`assignedSalesId = me OR null` (own + unassigned claimable) only.

### 4.1 `GET /api/intelligence/priority`
Priority customers (candidates: recent activity ≤30d OR open complaint OR abandoned quote).
```jsonc
{ "items": [
  { "id":"cust_1","name":"Bapak Andi","phone":"628…","priorityScore":85,
    "reasons":["Pernah beli premium","Menanyakan harga","Belum dibalas 3 hari"],
    "recommendedAction":"Follow up hari ini","urgency":"high",
    "stage":"QUOTED","assignedTo":null,"sessionLabel":"CS-1" } ] }   // sort desc, cap 15
```

### 4.2 `GET /api/intelligence/opportunities`
Buying opportunities (candidates: QUALIFIED/QUOTED + activity ≤7d).
```jsonc
{ "items": [
  { "id":"cust_2","name":"Ibu Sari","phone":"628…","opportunityScore":78,
    "signals":["Tanya harga","Minta katalog","Percakapan aktif"],
    "stage":"QUOTED","valueEstimate":6200000,"assignedTo":"Farhan","sessionLabel":"CS-2" } ] } // sort desc, cap 10
```

### 4.3 `GET /api/customers/:id/intelligence`
Full per-customer intelligence (for future Customer360). 403 if SALES not allowed to view.
```jsonc
{ "health":      { "score":62,"category":"Perlu Perhatian","variant":"warning",
                   "trend":"down","signals":[{"type":"positive","label":"3 order · Rp8,5jt"}, …] },
  "priority":    { "score":85,"reasons":["…"],"urgency":"high" },
  "opportunity": { "score":70,"signals":["Tanya harga","…"] },
  "nextAction":  { "action":"Follow up penawaran","reason":"Penawaran terkirim, belum direspons 3 hari","urgency":"high" },
  "insight":     "Riwayat pembelian kuat, namun ada komplain belum selesai. …" }
```

---

## 5. Migration strategy (gradual, contract-preserving — decision #5)
- **This scope (4A.0+4A.1):** build the engine + the 3 new endpoints. **Existing
  `analytics.js` hot-leads / recommendations / follow-ups and the Customer360 client health
  score are LEFT AS-IS and keep working.** The engine becomes the *canonical* source;
  consumers migrate later.
- **Later, contract-preserving steps (separate, gradual):**
  1. Point `/analytics/hot-leads` at `computeOpportunity` (response **shape** unchanged; score
     **values** improve via expanded keywords — flagged, verified by `verify-wave2b.mjs`).
  2. Point `/analytics/recommendations` + `/follow-ups` at the shared signals/next-action.
  3. Customer360 (4A.3, UI wave) reads `GET /customers/:id/intelligence` and drops its
     client-side `healthScore.js` (exact-port means no behavior change).
- **No response contract is broken** at any step (fields preserved; only score values may
  improve, which is the point of "improve hot leads").
- **Anti-drift:** health is an *exact port*, so the two health formulas converge; opportunity
  supersedes `HOT_WEIGHTS`.

---

## 6. Risk assessment
| # | Risk | Level | Mitigation |
|---|---|---|---|
| R1 | New per-customer route added to `customers.js` | Low | **Additive** route only; router already has `requireAuth`; existing routes/contracts untouched. (Alt: mount under `/api/intelligence/customer/:id` if you prefer zero touch to customers.js.) |
| R2 | Temporary duplication (engine + old analytics formulas coexist) | Med | Intended during gradual migration; engine is canonical; consumers migrate in contract-preserving steps with the verify script |
| R3 | Role data leakage on new endpoints | Low | Reuse 2B `requireAuth` + scoping; new `verify-wave4a.mjs` (scoping + field-leak + shape); read-only |
| R4 | Candidate queries unbounded / N+1 | Low | Bounded `loadCandidates` (stage/recency filters + `take` limits), nested `take:1`, aggregates — 2B patterns; small dataset |
| R5 | Priority/opportunity weight tuning needs product input | Med | All weights in one `weights.js`; explainable outputs (reasons/signals) make tuning safe; ship sensible defaults, tune after seeing real output |
| R6 | Keyword matching naive (false positives) | Low | Transparent, in one editable map; Layer-2 LLM (4B) adds nuance later |
| R7 | Touching frozen zones | Low | Engine = new files; only additive route + one mount line; **nothing** in inbox/WAHA/SSE/auth/existing contracts changed |
| R8 | Scope creep | Low | UI explicitly excluded; existing-endpoint refactor deferred to gradual steps |

---

## 7. AI Reply Assistant readiness — ARCHITECTURE ONLY (deferred to Wave 4B/4C)

> **Nothing here is implemented in 4A.** No LLM, no UI, no WhatsApp/WAHA integration, no new
> endpoint. This section only *reserves the shapes and boundaries* so the 4A engine's signals
> are forward-compatible. 4A's only forward-compat concession: `detectSignals` may emit a
> rule-based `detectedIntents[]` array (keywords already exist) — inert until 4B/4C.

### 7.1 Conversation Context Schema (derived, ephemeral — NOT a table)
The read-only object a *future* reply assistant would receive. Assembled per-request from
existing data + the intelligence engine; never stored; messages capped; phone masked.
```jsonc
ConversationContext {
  conversationId, channel, sessionLabel,            // "CS-1" | "CS-2"
  customer: { id, name, stage, isReturning, orderCount, orderValue, complaintsOpen,
              health:{score,category}, priority:{score}, opportunity:{score} },  // from engine
  recentMessages: [ { direction, text, createdAt } ],   // last N (cap ~10), no full history
  detectedIntents: ["PRICE_INQUIRY", …],               // rule-based now (taxonomy §7.2)
  signals: { …from intelligence engine… },
  lastInbound, waitingMinutes,
  nextBestAction: { action, reason, urgency },
  knowledgeRefs: [ /* future: KB category ids relevant to intent */ ],
  meta: { locale: "id-ID", handoverRequired: bool, businessRuleFlags: [ … ] }
}
```

### 7.2 Reply Intent Taxonomy (rule-detectable now, LLM-refined later)
Fixed codes; each has `detection` (keywords today), `handoverRequired`, `llmEligible`.
Aligned with the buying-signal + handover rules in CLAUDE.md §9/§16.8.
| Code | Meaning | Handover? | LLM-eligible (4B/4C)? |
|---|---|---|---|
| `PRICE_INQUIRY` | tanya harga (harga/berapa/nego) | no | yes |
| `SIZE_INQUIRY` | tanya ukuran | no | yes |
| `PRODUCT_INFO` | spesifikasi/bahan/tipe | no | yes |
| `CATALOG_REQUEST` | minta katalog/foto | no | yes |
| `PROMO_INQUIRY` | promo/diskon | no | yes (no invented promos) |
| `PAYMENT_INQUIRY` | cicilan/bayar/DP | no | yes (no promised terms) |
| `AVAILABILITY` | ready/stok | no | yes |
| `ORDER_INTENT` | beli/pesan/order | **buying signal** | assist, human closes |
| `SCHEDULING` | jadwal/kirim/kapan | no | yes (no promised dates) |
| `OBJECTION` | mahal/pikir dulu/bandingkan | no | yes |
| `COMPLAINT` | komplain/rusak/kecewa | **YES — force human** | **no** |
| `HANDOVER_REQUEST` | "bisa telepon?"/minta orang | **YES** | no |
| `GREETING` / `SMALLTALK` | sapaan | no | yes |
| `OTHER` / `UNKNOWN` | tak terklasifikasi | no | human decides |

### 7.3 Future Suggestion Response Contract (RESERVED — not built in 4A)
Shape a future `POST /api/conversations/:id/reply-suggestions` (Wave 4B/4C) would return:
```jsonc
{ "intent": "PRICE_INQUIRY",
  "handoverRecommended": false,
  "blocked": null,                          // e.g. { reason: "COMPLAINT → wajib ditangani manusia" }
  "suggestions": [
    { "id":"s1","text":"…draf balasan…","tone":"informatif","intent":"PRICE_INQUIRY",
      "source":"template",                  // "template" | "llm"
      "confidence":null,                    // number only if source=llm
      "requiresHumanReview":true,           // ALWAYS true — draft only, never auto-send
      "disclaimers":["Harga final dikonfirmasi tim"] } ],
  "generatedAt":"…" }
```
Invariants baked into the contract: `requiresHumanReview` is always `true`; `COMPLAINT`/
`HANDOVER_REQUEST` → `suggestions:[]` + `blocked`; no price/delivery/discount promises
(disclaimers enforced).

### 7.4 Security boundaries (hard rules for the future assistant)
- **Draft-only, human-in-the-loop:** suggestions are drafts a salesperson edits & sends
  manually. The assistant **never sends** and has **no WAHA/send-path access** (isolated module).
- **Product hard-rules (CLAUDE.md):** never promise exact price/delivery/discount;
  **complaints/anger → human handover, no AI suggestion**; AI opens the door, human closes.
- **Data minimization / PII:** only necessary context to any future LLM; capped recent
  messages, masked phone, no full history/name unless required; configurable redaction.
- **No training on customer data:** provider opt-out / BYOK; self-hosted-first per CLAUDE.md §2.
- **Cost & rate caps:** Layer-2 LLM only on **explicit per-conversation request** (a button),
  never bulk/automatic; per-user daily caps.
- **Role scoping + audit:** suggestions only for conversations the requester may access (reuse
  auth/2B scoping); log request metadata (who/when/intent/source), not necessarily content.
- **Frozen-zone isolation:** this layer, when built, will not modify WAHA, SSE, Inbox send
  logic, WebSocket, or auth — same guarantees as 4A.

**4A deliverable impact:** none beyond the optional rule-based `detectedIntents[]` in
`signals.js`. No endpoint, no LLM client, no UI, no schema.

---

## 8. Confirm before I code
1. **`/customers/:id/intelligence` placement:** additive route in `customers.js` (honors your
   exact path) — OK? (Alt: `/api/intelligence/customer/:id`.)
2. **Weights:** ship the defaults above in `weights.js` and tune after real output — OK?
3. **Gradual migration:** confirm existing analytics/Customer360 stay **untouched** this scope
   (engine canonical; migrate later, contract-preserving).
4. **Verifier:** include `verify-wave4a.mjs` in this scope (recommended) — OK?
5. **Reply-assistant readiness:** documented as architecture only (§7). Include the inert
   rule-based `detectedIntents[]` in `signals.js` now (forward-compat, no endpoint/LLM/UI), or
   leave intent detection entirely to Wave 4B? — your call.
