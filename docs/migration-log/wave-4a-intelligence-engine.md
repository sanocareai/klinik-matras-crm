# Migration Log — Wave 4A: Sano Intelligence Engine (Core + API)

**Date:** 2026-07-15
**Scope:** Canonical **rule-based** intelligence engine (4A.0) + read-only API (4A.1).
**No UI.** No LLM, no external AI API, zero token cost. **Frozen:** WAHA, SSE, Inbox,
WebSocket, auth, existing customer/order **contracts**, schema (no migration).
**Verified:** all backend files `node --check` OK; pure engine runtime-tested (scores 0–100,
deterministic, intent detection). Live API test pending DB (see `scripts/verify-wave4a.mjs`).

---

## 1. Files
### Added — engine (`backend/src/services/intelligence/`)
`weights.js` (central config + `ENGINE_VERSION`), `format.js`, `signals.js`
(+ inert `detectedIntents[]`), `healthScore.js` (exact port of 3A), `priorityScore.js`,
`opportunityScore.js`, `nextBestAction.js`, `insight.js`, `index.js` (orchestrator +
only prisma access), `replyReadiness.js` (**architecture-only**), `README.md`.

### Added — API + verifier
`backend/src/routes/intelligence.js` (`/priority`, `/opportunities`),
`backend/scripts/verify-wave4a.mjs`.

### Modified — additive only
`backend/src/index.js` (+import + `app.use("/api/intelligence", …)`),
`backend/src/routes/customers.js` (+`GET /:id/intelligence`, additive; router already
`requireAuth`). **No existing route/contract changed.**

### Docs
`docs/design-system/wave-4-intelligence-engine-architecture.md` (proposal),
`docs/design-system/wave-4a-implementation-checkpoint.md` (spec incl. §7 reply readiness).

---

## 2. Four separate scores (never merged)
- **Health** (relationship quality · Customer360) — exact port of 3A → behavior-preserving.
- **Priority** (sales urgency · Dashboard) — urgency-weighted + value pull; `reasons[]`, `urgency`.
- **Opportunity** (buying probability · Hot Leads) — expanded keyword set + behavior; `signals[]`.
- **Next Best Action** — ordered IF/THEN → `{action, reason, urgency}`.
Plus rule-based **Insight** (templated, not "AI"). All in one `weights.js`; pure & deterministic.

## 3. API contracts (additive, read-only, role-scoped 2B-style)
- `GET /api/intelligence/priority` → `{ items:[{id,name,phone,priorityScore,reasons,recommendedAction,urgency,stage,assignedTo,sessionLabel}] }`
- `GET /api/intelligence/opportunities` → `{ items:[{id,name,phone,opportunityScore,signals,stage,valueEstimate,assignedTo,sessionLabel}] }`
- `GET /api/customers/:id/intelligence` → `{ health, priority, opportunity, nextAction, insight, signals, meta{engineVersion,generatedAt} }`; **403** if SALES not allowed to view.

## 4. AI Reply Assistant readiness (architecture only — inert)
`replyReadiness.js`: Reply Intent Taxonomy (COMPLAINT/HANDOVER → `handoverRequired`,
`llmEligible:false`), `buildConversationContext` (masked phone, capped messages, **trace**),
`FUTURE_SUGGESTION_CONTRACT` (+ `assertContractInvariants`) enforcing `requiresHumanReview=true`,
complaints/handover blocked, no auto-send, no price/delivery/discount promises,
audit trace. `signals.detectedIntents[]` shipped (inert). **No endpoint / LLM / UI.**

## 5. Migration strategy (gradual — decision #3)
Engine is now canonical. `analytics.js` hot-leads/recommendations and Customer360 frontend
scoring **left untouched** this phase; they migrate later (contract-preserving; opportunity
supersedes `HOT_WEIGHTS`, Customer360 → `/customers/:id/intelligence` with the exact-port
health so no behavior change).

## 6. Verification (run where DB reachable)
```bash
cd backend
SALES_EMAIL=<sales-email> SALES_PASS=<pass> node scripts/verify-wave4a.mjs
```
Checks: API contracts · score 0–100 · reasons/signals present · no field leak · ADMIN/SALES
scoping · inaccessible customer → 403 · deterministic consistency.

**Rollback:** revert the Wave 4A commit — engine is new files + additive routes; existing
routes/contracts/schema untouched.
