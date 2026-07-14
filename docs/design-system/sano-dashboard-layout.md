# Sano Design System v1 — Dashboard Layout Foundation

> The dashboard is the product's thesis statement. It must answer, in this order:
> **"How am I doing?" → "What needs me now?" → "Why / the trends behind it."**
> Today's dashboard (`pages/Dashboard.jsx`) shows KPIs → target → session split →
> charts+pipeline+recent-orders. Good bones; the redesign re-sequences them around
> *decisions* and adds the AI layer that defines Sano.

---

## 1. Layout principle: the inverted pyramid

Read top-to-bottom = most actionable to most analytical. A sales rep who looks for 5
seconds should leave knowing what to do. An owner who scrolls should understand the
business. Three bands:

```
┌───────────────────────────────────────────────────────────────┐
│  HEADER:  Halo, {nama} 👋 · {tanggal}          [Date range ▾]  │
├───────────────────────────────────────────────────────────────┤
│  BAND 1 — ORIENT  (status: "how am I doing?")                  │
│  [Hero KPI]  [KPI]  [KPI]  [KPI]        ← 4-up, one hero        │
├───────────────────────────────────────────────────────────────┤
│  BAND 2 — ACT  (decisions: "what needs me now?")              │
│  [ ✨ Rekomendasi Sano ]   [ Lead Panas ]   [ Sales Health ]  │
├───────────────────────────────────────────────────────────────┤
│  BAND 3 — ANALYZE  (trends: "why / how")                     │
│  [ Revenue/Traffic chart ]        [ Pipeline funnel ]         │
│  [ WhatsApp analytics ]           [ Lead source donut ]       │
│  [ Recent orders / activity ]     [ Customer health ]         │
└───────────────────────────────────────────────────────────────┘
```

Role-awareness: **SALES** sees a "my leads / my targets" framing; **ADMIN/OWNER** sees
team-wide rollups (the sidebar already gates admin-only areas — the dashboard follows
the same `isAdmin` logic).

---

## 2. Top section — BAND 1: Orient

**What appears first:** four KPI cards, one styled as the **Hero** (gradient, sparkline).

| Card | Metric | Why here |
|---|---|---|
| **Hero: Revenue** | Total order value for the period + trend + mini target bar | The number the business lives or dies by; earns the one hero slot |
| Total Leads | New customers/leads + trend (clickable → detail modal, already built) | Top of funnel; is demand healthy? |
| Conversion Rate | % leads that ordered | Efficiency; already computed from real data |
| Total Order | Count of orders + trend | Volume/throughput |

**Why this position:** orientation before action. You can't decide what to do until you
know if you're up or down. Trends (`▲/▼` vs previous period) turn raw numbers into
judgment. Keep the count-up animation (it already exists and reads as "live").

**Do not** fill a KPI slot with a fake/placeholder metric (removes the current dummy
"intent distribution" energy). Four honest cards beat six padded ones.

---

## 3. Middle section — BAND 2: Act (the Sano difference)

This band is what makes Sano a *command center* rather than a report. Three operational
widgets, all answering "what should I do next?":

#### 3a. ✨ Rekomendasi Sano (AI Recommendations) — the flagship
- **Content:** a ranked, dismissible list of the 2–4 highest-value actions Sano infers
  from real data: "5 lead panas belum di-follow up >2 jam", "3 percakapan belum ada
  yang ambil (unassigned)", "Order NEW-… siap diambil, konfirmasi ke customer",
  "Target Risel 40% dari target, 8 hari tersisa."
- **Why here, why first in the band:** it's the single strongest expression of the
  positioning. It converts the whole dashboard from passive to active. Placing it left/
  first in the act-band means the eye lands on *a decision* right after orientation.
- **Data honesty:** every recommendation links to the real record and is derived from
  existing signals (last message time, assignment, order status, targets) — no fabrication.

#### 3b. Lead Panas / Hot Leads
- **Content:** top leads by recency + intent + value; each with a one-tap "Buka chat" /
  "Ambil" action and a "belum dibalas 1j+" warning where the takeover rule applies.
- **Why here:** revenue is won or lost on follow-up speed; this is the rep's worklist.

#### 3c. Sales Team Health (Performance)
- **Content:** per-rep progress bars vs monthly target (the milestone view that
  `CLAUDE.md §8` flagged as still-a-plain-table). Ranked, color-coded on/behind target.
- **Why here:** managers act on who's ahead/behind *now*, mid-period, while it's fixable.
  For a SALES role this collapses to just their own target progress.

**Why the middle, not the top:** these are decisions, and decisions need the context
that Band 1 provides. Why not the bottom: they're time-sensitive; burying them under
charts defeats the purpose.

---

## 4. Bottom section — BAND 3: Analyze

Analytical widgets for understanding *why*. Two-column grid, scannable, each a `Card`.

| Widget | Content | Why bottom |
|---|---|---|
| **Revenue / Traffic over time** | Monthly bar or area (brand blue), period-compare tooltip (Ramp-style) | Trend context — reference, not action |
| **Pipeline overview (funnel)** | LEAD→QUALIFIED→QUOTED→WON with counts + value per stage | Where deals sit / where they leak |
| **WhatsApp analytics** | Volume, avg response time, CS-1 vs CS-2 split, inbound:outbound ratio (anti-ban signal) | Channel health; the core operational surface but reviewed, not acted on live here |
| **Lead source breakdown (donut)** | META_ADS / GOOGLE_ADS / ORGANIC / REFERRAL with conversion per source | Attribution / where to spend — strategic, periodic |
| **Recent orders / activity** | Latest 8 orders or a unified activity feed | Pulse check; drill-in on demand |
| **Customer health** | Segments: VIP, no-order, inactive 30d, "pernah komplain" | Retention/risk radar — reviewed periodically |

**Why this order within the band:** revenue/pipeline (money) before channel/source
(operations) before health (retention). Money questions are asked most often.

---

## 5. Grid & responsive behavior

- **Desktop (≥1024px):** Band 1 = 4-col; Band 2 = 3-col (AI card can span wider if it
  has more items); Band 3 = 2-col. Gaps `gap-6`. Page padding `p-8`.
- **Tablet (768–1023px):** Band 1 = 2×2; Band 2 = stacked or 1-col with AI card full
  width; Band 3 = 1-col. Charts keep full width.
- **Mobile (<768px):** everything single column in priority order — **AI recommendations
  and Hot Leads rise near the top** (a rep on the floor wants the worklist, not the
  annual chart). KPIs become a 2-col compact grid or a horizontal snap-scroll row.
  Page padding `p-4`.

Every widget fetches and fails independently (the current `WidgetError` pattern is
correct — keep it; one broken widget must never blank the page).

---

## 6. States

- **Loading:** skeletons that match final layout (KPI skeletons + chart skeletons already
  exist) — no spinners, no layout shift.
- **Empty (new account / no data in range):** honest, guiding empty states —
  "Belum ada order di periode ini. Coba rentang lebih luas." Never a blank card.
- **AI band empty:** "Semua lead sudah ditangani, kerja bagus 👍" — a *positive* empty
  state, reinforcing the co-pilot relationship.

---

## 7. What changes vs today (summary)

| Today | Sano v1 |
|---|---|
| KPIs → Target → Session split → Charts/Pipeline/Orders | Orient → **Act (AI + Hot Leads + Team Health)** → Analyze |
| No AI presence on the dashboard | AI recommendations are the flagship middle widget |
| Sales performance is a plain table | Milestone/progress cards vs target |
| Some placeholder/dummy data | Every widget backed by real data or an honest empty state |
| One flat visual weight | One hero KPI + clear three-band hierarchy |
