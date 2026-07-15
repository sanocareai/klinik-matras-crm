# Migration Log — Wave 3A: Customer 360 (Pelanggan drawer)

**Date:** 2026-07-15
**Checkpoint before:** `bcecf4a` (wave-3 proposal)
**Scope:** Unify the Pelanggan customer-detail UI into a shared `Customer360`, rendered
inside the existing drawer. **Frontend only — no backend/schema.** Inbox **not** touched.
**Build:** `npm run build` → clean.

---

## 1. Files changed
### Added (`frontend/src/components/customer360/`)
| File | Role |
|---|---|
| `Customer360.jsx` | Orchestrator: header + left rail + right rail (tabs); top-level loading/error+retry |
| `Customer360Header.jsx` | Identity, stage badge, health chip, "Pernah Komplain" badge, assignee, Buka chat, close |
| `hooks/useCustomer360.js` | React Query over **existing** `getCustomer` + `getCustomerConversations`; `invalidate()` for edits |
| `lib/customerSignals.js` | Pure: `deriveCustomerSignals`, `deriveNextAction`, `buildOverviewText` (rule-based) |
| `lib/healthScore.js` | Pure: `computeHealthScore` → score + category + explainable signals |
| `lib/timelineAdapter.js` | Pure: `buildTimeline` (orders+notes+complaints + **capped** recent messages) + `groupByDay` |
| `panels/CustomerOverview.jsx` | **"Sano Insight"** — rule-based text (labeled "Rule-based", **not AI**) |
| `panels/HealthScoreCard.jsx` | **Customer Health Score** — ring + category badge + signal chips |
| `panels/NextActionCard.jsx` | Recommended next step + "Buka chat" CTA |
| `panels/ProfileFields.jsx` | Profile edit (name/city/email/tags/stage/health/type) via existing `api.updateCustomer` + `StageSelect`; keluhan history |
| `panels/ActivityTimeline.jsx` | Default tab; day-grouped timeline; loading/empty/error+retry |
| `panels/ConversationHistoryTab.jsx` | Capped chat view (8/conv) + "Buka Chat penuh"; loading/empty/error+retry |

### Modified
- `components/CustomerDrawer.jsx` — now a **thin shell**: overlay + panel (existing slide-in
  CSS, widened to `min(880px,96vw)`; mobile stays full-width) rendering `<Customer360/>`.
  **Public props unchanged** (`customerId/onClose/onUpdated`) → `Customers.jsx` untouched.

### Reused unchanged
`components/customer/{OrderSection, NotesSection, StageSelect}`, all `api.js` methods,
`Avatar`, and the `ui/*` primitives.

### NOT committed
`frontend/dist/**`.

---

## 2. Locked decisions honored
- **Default right tab = Activity Timeline** (sales sees history/context first).
- **"Sano Insight"** naming; labeled **"Rule-based"**; no "AI Analysis/Prediction/Generated";
  no AI gradient on these cards (reserved for real Phase-4 LLM later).
- **Customer Health Score**: score number + category (80–100 Healthy → *Sehat*, 50–79 Needs
  Attention → *Perlu Perhatian*, 0–49 At Risk → *Berisiko*) + signal chips. *(Category labels
  shown in Indonesian per the app's language rule; thresholds exactly as specified — flag if
  you'd prefer the English words.)*
- **Timeline** always shows orders/notes/complaints; messages **capped** (recent 15 in
  timeline, 8/conversation in chat tab); "Buka Chat" is the full-conversation entry point.
- **Component ownership:** domain logic stays in `OrderSection`/`NotesSection`/`StageSelect`/
  `ProfileFields` + existing API; Customer360 only orchestrates + hosts the new intelligence.
- **States:** every panel has loading, empty, and error + retry.

## 3. Isolation (verified)
- Only `CustomerDrawer.jsx` modified; new files under `customer360/`.
- `grep` confirms **no** import of `features/inbox`, `lib/socket`, `useSSE`, or inbox stores
  from any `customer360/*` file.
- No changes to inbox, WAHA, SSE, webhooks, backend routes, or `schema.prisma`.

## 4. Health-score signals (explainable)
Positive: purchase history (order count/value), quotation activity (QUOTED/WON stage),
engagement (recency). Negative: unresolved complaint, inactivity (>30/>60d), unanswered
follow-up (last msg INBOUND & waiting >3h). Each firing signal renders as a chip.

## 5. Remaining risks
| Risk | Level | Note |
|---|---|---|
| `getCustomerConversations` returns all messages (fetch volume unchanged from old drawer) | Low | Rendering is capped; a read-only endpoint can paginate later if needed |
| No stage-change history in schema | Low | Timeline shows orders/notes/messages/complaints only (documented) |
| Edit → invalidate refetch (slight delay vs optimistic) | Low | Correct/fresh derived fields; can add `setQueryData` later |
| Full in-app click-through not run here | Low | No DB in sandbox; build clean + isolation verified; visual via artifact |

**Rollback:** `git revert` the Wave 3A commit (additive files + thin drawer). The old
drawer is one revert away.
