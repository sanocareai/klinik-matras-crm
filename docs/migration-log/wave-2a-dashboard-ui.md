# Migration Log — Wave 2A: Dashboard UI System

**Date:** 2026-07-15
**Checkpoint before:** `09c295f feat: wave-1.1 shell visual refinement`
**Scope:** Dashboard UI only — three-band command center. **No backend changes.**
Band 1 & 3 use real `/analytics/*` adapters; Band 2 uses **mock contracts** (labeled
"Contoh") pending Wave 2B. **No WAHA/SSE/webhook/inbox/order/customer-API changes.**
**Build:** `npm run build` → clean (`✓ ~10s`).

---

## 1. Files changed
### Added
| File | Purpose |
|---|---|
| `features/dashboard/data/contracts.js` | **Mock data + JSDoc contracts** for the 3 Band-2 endpoints (`recommendations`, `hot-leads`, `follow-ups`) — the exact shape Wave 2B implements. `BAND2_IS_MOCK` flag. |
| `features/dashboard/hooks/useDashboardData.js` | React Query assembler: real adapters (Band 1/3) + mock (Band 2), per-widget status. |
| `features/dashboard/components/HeroMetricCard.jsx` | Revenue hero (gradient, count-up, inline sparkline). |
| `…/SalesPerformanceStrip.jsx` | Team attainment strip. |
| `…/AIRecommendations.jsx` ★ | Flagship — ranked, dismissible actions; ✨ + "Contoh" badge; positive empty state; `ai-shimmer` loading. |
| `…/HotLeads.jsx` | Ranked worklist + explainable 0–100 score ring. |
| `…/FollowUpTasks.jsx` | Unanswered/overdue queue. |
| `…/TeamHealth.jsx` | Per-rep progress vs target (replaces plain table). |
| `…/ConversationAnalytics.jsx` | WhatsApp op stats (from `/analytics/performance`). |
| `…/RevenueTrend.jsx` | Monthly area chart (recharts). |

### Modified
- `pages/Dashboard.jsx` — rewritten to compose Orient → Act → Analyze bands via
  `useDashboardData`; uses `PageContainer`/`PageHeader`/`PageBody`. Reuses `MetricCard`,
  `PipelineWidget`, `ChartWidget`, `LeadsDetailModal`.

### Reused unchanged
`MetricCard`, `ChartWidget` (lead sources), `PipelineWidget` (funnel), `LeadsDetailModal`.
`SessionDistributionWidget`/`RecentOrdersTable`/`TargetSalesWidget` no longer mounted by
the dashboard (consolidated) but left in place for now.

### NOT committed
- `frontend/dist/**` (build artifacts).

---

## 2. Hierarchy (as built)
- **Band 1 — Orient:** Hero Revenue + Leads/Orders/Conversion + full-width team strip.
- **Band 2 — Act (flagship):** ✨ Rekomendasi Sano full-width, then Hot Leads / Follow-ups / Team Health (3-col).
- **Band 3 — Analyze:** Funnel · Lead sources · Conversation analytics · Revenue trend (2×2).
- **Mobile:** KPIs 2-col; Band 2 rises above analytics.

## 3. Data honesty
All Band-2 widgets render mock data **explicitly badged "Contoh"** and gated by
`BAND2_IS_MOCK`. No fabricated data masquerades as real. Wave 2B flips the flag and swaps
mock queries for real endpoints returning the same shapes.

## 4. Wave 2B hand-off (the contract)
`contracts.js` defines the three endpoint response shapes precisely:
- `GET /analytics/recommendations` → `{ items: Recommendation[] }`
- `GET /analytics/hot-leads` → `{ items: HotLead[] }`
- `GET /analytics/follow-ups` → `{ items: FollowUp[] }`
All must be **role-scoped server-side** (SALES = mine, ADMIN = team). Wave 2B provides
route contracts, queries, permission rules, and performance notes **before** any backend
code (separate review checkpoint).

## 5. Remaining risks
| Risk | Level | Note |
|---|---|---|
| Band 2 shows mock in a deployed 2A build | Med | Mitigated by visible "Contoh" badges + `BAND2_IS_MOCK`; do not deploy 2A to production as "done" without that context, or hold deploy until 2B. |
| Request fan-out (6 real + 3 mock queries) | Low | React Query parallel + cache + per-widget skeletons. |
| Reused widget prop contracts (`PipelineWidget`/`ChartWidget`) | Low | Same props as before; build passes. |
| Full in-app runtime not exercised here | Low | Needs backend; mitigated by clean build; visual validated via preview artifact. |

**Rollback:** `git reset --hard 09c295f`, or per-file checkout.
