# Sano Intelligence Engine (Wave 4A)

Canonical, **rule-based**, deterministic, explainable sales-intelligence over existing CRM
data. **No LLM, no external AI API, zero token cost.** Source of truth for scoring.

## Modules
- `weights.js` — **the only place to tune** weights/thresholds/keywords + `ENGINE_VERSION`.
- `signals.js` — `detectSignals(ctx)` → normalized signals (incl. inert `detectedIntents[]`).
- `healthScore.js` — `computeHealth` (relationship quality; **exact port** of Customer360 3A).
- `priorityScore.js` — `computePriority` (sales urgency; `reasons[]`, `urgency`).
- `opportunityScore.js` — `computeOpportunity` (buying probability; `signals[]`).
- `nextBestAction.js` — ordered IF/THEN rules → `{ action, reason, urgency }`.
- `insight.js` — templated Sano Insight text (not "AI").
- `index.js` — `buildCustomerIntelligence(ctx)` (pure) + `loadCustomerContext` /
  `buildPriorityList` / `buildOpportunityList` (the **only** prisma access).
- `replyReadiness.js` — **architecture-only** (Wave 4B/4C): intent taxonomy, conversation
  context schema builder, future suggestion contract + invariants, security boundaries.
  Not wired to any endpoint in 4A.

## Four separate scores (never merged)
Health (relationship) · Priority (urgency) · Opportunity (buying) · + Next Best Action.

## Consumers
- `GET /api/intelligence/priority`, `GET /api/intelligence/opportunities`
- `GET /api/customers/:id/intelligence`
- Existing `analytics.js` (hot-leads/recommendations) and Customer360 frontend **not yet
  migrated** — they consume the engine later, contract-preserving.

## Guarantees
Pure scorers (no I/O), deterministic (same input → same output), role-scoped at the route,
read-only, no schema/migration. Reply-assistant readiness is inert (no endpoint/LLM/UI).
