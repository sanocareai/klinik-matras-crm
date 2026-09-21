# Wave 2 — Dashboard Architecture & UX Plan

> **Status:** Planning for approval — *no code.*
> **Goal:** Transform the dashboard from a **reporting** surface into an **AI-powered
> sales command center**, structured as What's happening → What should I do → Why.
> **Constraint carried:** logic/realtime/WAHA/auth remain frozen; this plan *does* flag
> where new **backend endpoints** are required (a scope decision for you).

---

## 0. Where the current dashboard stands

`pages/Dashboard.jsx` today renders: KPI row (Total Leads, Total Order, Conversion,
Revenue) → `TargetSalesWidget` → `SessionDistributionWidget` (CS-1/CS-2) → a grid of
`ChartWidget` (lead source donut) + `PipelineWidget` (funnel) + `RecentOrdersTable`.
It already does three things well we will **keep**:
- **Per-widget error isolation** (`WidgetError`) — one widget failing never blanks the page.
- **Skeletons + count-up** entrance.
- **Real data** from `/analytics/*` (with one exception: any leftover dummy "intent
  distribution" must go — honesty rule).

What it lacks is the entire **"what should I do?"** layer. It reports; it does not direct.
That layer is Wave 2's reason to exist.

---

## 1. Information hierarchy

The inverted pyramid — most actionable at top of attention, most analytical at bottom:

```
HEADER   Halo, {nama} 👋 · {tanggal}                      [Date range ▾]

BAND 1 — ORIENT   "What is happening?"        (status, at a glance)
BAND 2 — ACT      "What should I do?"         (the command center — flagship)
BAND 3 — ANALYZE  "Why is this happening?"    (trends & attribution)
```

**Two hierarchy rules:**
1. **One hero** — Revenue is the single saturated/gradient element in Band 1; everything
   else is quiet white with a colored detail.
2. **Band 2 is visually elevated** — it is the product's identity. The AI Recommendations
   card is the first thing the eye lands on after the KPIs.

**Role-awareness** (enforced server-side, not just hidden in UI):
- **SALES**: "my" framing — my leads, my target, my follow-ups, my conversations.
- **ADMIN / OWNER**: team-wide rollups — team revenue, team attainment, all hot leads,
  unassigned queue.
The sidebar already gates admin areas; the dashboard mirrors this with `user.role`, and
the data must be scoped on the server so a SALES token cannot pull team-wide numbers.

---

## 2. Widget layout

### Desktop (≥1024px) — 12-column grid, `gap-6`, page `p-8`

**BAND 1 — ORIENT**
```
┌───────────────────────┬───────────┬───────────┬───────────┐
│  HERO: Revenue        │  Leads    │  Orders   │ Conversion│   (hero spans 6, 3× span-2)
│  Rp84,2jt ▲12,5%      │  1.284    │  417      │  32%      │
│  sparkline + target   │  ▲8%      │  ▲5%      │           │
├───────────────────────┴───────────┴───────────┴───────────┤
│  Sales performance — team attainment strip (Rp / target · %)│   (full-width slim bar)
└─────────────────────────────────────────────────────────────┘
```
Revenue = `Card variant="hero"` (brand navy gradient, sparkline, mini target bar). The
"Sales performance" item from your TOP list becomes a **slim full-width attainment strip**
(team % to monthly target) — a teaser whose full breakdown lives in Band 2 Team Health.

**BAND 2 — ACT** (the flagship)
```
┌─────────────────────────────────────────────────────────────┐
│  ✨ Rekomendasi Sano   (2–4 ranked, dismissible actions)      │   (full-width, ai-insight)
├───────────────────┬───────────────────┬─────────────────────┤
│  🔥 Hot Leads      │  ⏱ Follow-up      │  👥 Team Health     │   (3 cols, span-4 each)
│  ranked worklist  │  unanswered queue │  per-rep progress   │
└───────────────────┴───────────────────┴─────────────────────┘
```
Recommendations spans full width at the **top** of the band so a decision is the first
thing seen after orientation. Below it, three operational cards.

**BAND 3 — ANALYZE** (2-column, reuse existing widgets)
```
┌───────────────────────────────┬─────────────────────────────┐
│  Sales funnel (Pipeline)       │  Lead sources (+ conv/source)│
├───────────────────────────────┼─────────────────────────────┤
│  Conversation analytics        │  Revenue trend               │
│  (response time, CS-1/CS-2,    │  (monthly area, period       │
│   inbound:outbound)            │   compare)                   │
└───────────────────────────────┴─────────────────────────────┘
```

### Tablet (768–1023px)
Band 1 → hero full-width + 3 KPIs in a row (or 2×2). Band 2 → Recommendations full width,
then the three cards stack to 1-col (or 2+1). Band 3 → 1-col.

### Mobile (<768px) — single column, **re-prioritized**
`KPIs (2-col compact / snap-scroll)` → **✨ Recommendations** → **Hot Leads** →
**Follow-ups** → Team Health → funnel → sources → conversation → revenue trend.
The worklist rises to the top; deep analytics sinks. A rep on the floor sees "what to do"
first, not the annual chart.

---

## 3. Component structure

Thin `Dashboard.jsx` that composes three band components; each widget fetches/fails
independently and is built from Wave 0/1.1 primitives.

```
pages/Dashboard.jsx                     (composition + date range + role branch)
features/dashboard/
  components/
    bands/
      OrientBand.jsx                    (KpiRow + SalesPerformanceStrip)
      ActBand.jsx                       (AIRecommendations + HotLeads + FollowUps + TeamHealth)
      AnalyzeBand.jsx                   (Funnel + LeadSources + ConversationAnalytics + RevenueTrend)
    KpiRow.jsx                          (reuse MetricCard; + HeroMetricCard)
    HeroMetricCard.jsx        [NEW]     (Card variant="hero" + sparkline + ProgressBar)
    SalesPerformanceStrip.jsx [NEW]     (team attainment; from getSalesPerformance)
    AIRecommendations.jsx     [NEW ★]   (Card variant="ai-insight" list; the flagship)
    HotLeads.jsx              [NEW]     (ranked lead worklist; Badge, customer score)
    FollowUpTasks.jsx         [NEW]     (unanswered/overdue conversations queue)
    TeamHealth.jsx            [NEW]     (per-rep ProgressBar vs target; evolves TargetSalesWidget)
    ConversationAnalytics.jsx [NEW]     (response time, CS split, inbound:outbound)
    RevenueTrend.jsx          [NEW]     (monthly area chart; reuse Laporan chart parts)
    -- reused as-is / restyled --
    MetricCard.jsx  PipelineWidget.jsx  ChartWidget.jsx (lead sources)
    RecentOrdersTable.jsx  SessionDistributionWidget.jsx  LeadsDetailModal.jsx  DashboardLayout.jsx
  hooks/
    useDashboardData.js       [NEW]     (React Query: parallel fetch + caching + per-widget status)
```

**Primitives used:** `Card` (`default`/`hero`/`ai-insight`), `Badge` (+ `format.js`
variant helpers for stage/health), `ProgressBar`, `EmptyState`, `Tooltip`, `PageHeader`/
`PageBody`, `MOTION`/`fadeRise`/`staggerContainer`. **No new UI primitives needed.**

**Reuse, don't discard:** `PipelineWidget`, `ChartWidget`, `MetricCard`,
`TargetSalesWidget` (→ becomes `TeamHealth`), `RecentOrdersTable` (moves to Band 3 or folds
into Follow-ups), `SessionDistributionWidget` (→ into `ConversationAnalytics`),
`LeadsDetailModal` (reused by KPI + Hot Leads drill-in).

---

## 4. Data requirements

The decisive finding. **Green = ready today. Red = needs new backend work.**

| Widget | Source | Status |
|---|---|---|
| Revenue (hero) + sparkline + target | `getAnalyticsOverview` (`totalOrderValue`, `growthOrderValue`, `monthlyRevenue`) + `getSalesPerformance` (target) | ✅ ready |
| Leads / Orders / Conversion | `getAnalyticsOverview` (`totalCustomers`, `totalOrders`, `customersWithOrders`, `growth*`) | ✅ ready |
| Sales performance strip / Team Health | `getSalesPerformance` (per-rep vs target), `getSalesTargets` | ✅ ready |
| Sales funnel | `getAnalyticsPipelineFunnel` | ✅ ready |
| Lead sources (+ conv/source) | `overview.leadSourceBreakdown`, `getAnalyticsSourcePerformance` | ✅ ready |
| Conversation analytics | `getAnalyticsPerformance` (`closingRate`, `avgResponseMinutes`), `overview.channelBreakdown`, session split | ✅ ready |
| Revenue trend | `overview.monthlyRevenue` | ✅ ready |
| **Hot Leads** | needs ranked leads by recency + stage + value + assignment | 🔴 **new endpoint** `GET /analytics/hot-leads` (or a sorted `getCustomers` query) |
| **Follow-up Tasks** | conversations with last message inbound + >N min no reply (the takeover rule, CLAUDE.md §7C) + unassigned queue | 🔴 **new endpoint** `GET /analytics/follow-ups` |
| **✨ Sano AI Recommendations** | ranked synthesis of the above signals | 🔴 **new endpoint** `GET /analytics/recommendations` (rule-based; see §5) |

**So:** Bands 1 and 3 ship on existing data. **Band 2 — the whole point — needs 3 new
read-only endpoints.** They query existing tables (Customer, Conversation, Message, Order,
SalesTarget); no schema changes, no writes, no WAHA/realtime coupling. This is the key
scope decision in §7.

**Fetch strategy:** a `useDashboardData` hook using React Query — parallel requests,
per-widget `status`, caching, and `staleTime` so the date-range picker and role branch
don't refetch everything. Keeps the current per-widget error isolation.

---

## 5. AI widget opportunities

### ✨ Sano AI Recommendations — the flagship (v1 = rules, not LLM)
The card that makes Sano a *command center*. **v1 is a deterministic ranking engine over
real signals** — explainable, zero hallucination, zero token cost, aligned with the
product rule that "AI opens doors, the human decides." Example rules (each → real record +
one-tap action, dismissible):

| Signal (all from existing tables) | Recommendation |
|---|---|
| Leads with inbound last msg, unanswered > 2h | "5 lead panas belum di-follow up — buka" |
| Conversations with no `assignedToId` | "3 percakapan belum diambil" |
| Orders in WAITING_LIST/PENGERJAAN past SLA | "2 order siap dikonfirmasi ke customer" |
| Sales rep < X% of target with < N days left | "Target Risel 40% · 8 hari tersisa" |
| Customers with a complaint flag, open | "1 komplain perlu telepon langsung" (handover rule) |

Rendered as `Card variant="ai-insight"` with ✨, ranked by value/urgency, each dismissible,
each linking to the real record. Honest **positive empty state**: "Semua lead sudah
ditangani, kerja bagus 👍".

### Hot Leads with an explainable "why-hot" score
A 0–100 **customer score** (UX doc §2.2) from real signals (recency, stage, order value,
response gap) shown as a `Badge`/ring with a plain-language reason ("Panas: baru chat,
belum di-follow up"). No fake math — the formula is documented and explainable.

### Future (Phase 4 tie-in — NOT v1)
Clearly separated so v1 stays trustworthy and cheap:
- LLM narrative summary ("Hari ini fokus ke 3 lead dari Meta Ads yang menanyakan harga…").
- Buying-signal detection feeding Hot Leads (from the AI Warming pipeline).
- Per-lead AI next-best-action.
These wait until the Phase 4 AI infra (Fase C+) is live and stress-tested. **v1 ships the
command center on rules; the LLM layer is an upgrade, not a dependency.**

---

## 6. Migration risks

| # | Risk | Level | Mitigation |
|---|---|---|---|
| R1 | **Band 2 needs 3 new backend endpoints** — the differentiator isn't buildable on current data alone | High | The scope decision in §7. Endpoints are read-only, no schema change, no realtime coupling. |
| R2 | **Data honesty** — temptation to fake Hot Leads/Recommendations to look impressive | High | Hard rule: real-data or honest empty. Rule-based recommendations only; remove any dummy "intent distribution". |
| R3 | **Request fan-out** — dashboard now fires ~8–10 endpoints; slow first paint / N round-trips | Med | React Query parallel + caching + per-widget skeletons; consider one combined `/analytics/dashboard` later. Per-widget error isolation stays. |
| R4 | **Role data leakage** — SALES pulling team-wide numbers | Med | Scope every endpoint server-side by `req.user`; never rely on UI hiding alone. |
| R5 | **Realtime read-refresh** — Hot Leads/Follow-ups go stale between polls | Low | Optional: subscribe the two act-band widgets to the existing `new_message` SSE for a light refetch. **Do not touch** the shell's SSE/unread logic. |
| R6 | **Reuse regressions** — restyling `PipelineWidget`/`ChartWidget`/`TargetSalesWidget` | Low | Restyle to tokens, keep data contracts; migrate one widget at a time. |
| R7 | **Mobile ordering** — analytics burying the worklist | Low | Explicit mobile source-order (§2): Recommendations/Hot Leads near top. |
| R8 | **Scope creep** — Band 2 is large; solo maintainer | Med | Phase it (§7 Option C) if needed: ship Bands 1+3 first, then Band 2 behind the new endpoints. |
| R9 | **Deploy** — new endpoints need backend rebuild/deploy on VPS (CLAUDE.md §12) | Med | Follow the runbook; endpoints are additive routes, low blast radius. |

---

## 7. The one decision to make before Wave 2 coding

Band 2 (the command center) requires 3 new **read-only** backend endpoints
(`hot-leads`, `follow-ups`, `recommendations`) over existing tables. Options:

- **Option A — Full (recommended):** add the 3 endpoints + build all three bands. Delivers
  the real command center. Touches backend (additive routes only; no schema, no writes, no
  WAHA/realtime).
- **Option B — Frontend-only interim:** derive Hot Leads/Follow-ups client-side from
  `getCustomers` + `getConversations`, recommendations as client-side rules. No backend
  change, but heavier client, less precise, and re-implements ranking logic that belongs
  on the server.
- **Option C — Phased:** ship Bands 1 + 3 now on existing endpoints (pure frontend, zero
  backend), then Band 2 in a follow-up once the endpoints are approved.

Everything else (hierarchy, layout, components, primitives, motion) is frontend-only and
ready to build on approval.

---

## 8. Decision (LOCKED) & build order

**Chosen:** **Option A — Full** + **Restyle & consolidate**.
- Wave 2 **will add 3 read-only backend routes** (`hot-leads`, `follow-ups`,
  `recommendations`) — additive `GET` handlers over existing tables. **No schema change,
  no writes, no WAHA/realtime coupling.** This is the first backend touch in the migration;
  every route is scoped by `req.user` (role) server-side.
- Reused widgets get a **token restyle**; **SessionDistribution (CS-1/CS-2) folds into
  Conversation Analytics**; **Recent Orders** moves to Band 3 / folds into Follow-ups.

### Proposed build sub-waves (each independently shippable, own commit)
1. **2.0 — Data layer:** the 3 backend endpoints (role-scoped, real signals) +
   `useDashboardData` React Query hook + contract tests. *Backend + fetch only, no UI.*
2. **2.1 — Band 1 (Orient):** `HeroMetricCard`, `KpiRow`, `SalesPerformanceStrip`.
3. **2.2 — Band 2 (Act):** `AIRecommendations` (rules engine) ★, `HotLeads`,
   `FollowUpTasks`, `TeamHealth`.
4. **2.3 — Band 3 (Analyze):** restyle Funnel + Lead sources; new `ConversationAnalytics`
   (with CS split) + `RevenueTrend`.
5. **2.4 — Polish:** mobile ordering, motion, empty/error states, optional SSE read-refresh
   on the two act-band widgets (no shell-logic changes), verification + screenshots.

### Frozen throughout
WAHA, SSE/realtime shell logic, `unreadCount`, notification handlers, auth/session,
navigation data, role permissions, **existing** DB schema. New backend work is **read-only
additive routes only.**
