# Sano Design System v1 — Phase 2 Implementation Plan

> **Role:** Lead frontend architect. **Status:** Plan for approval — *no code written yet.*
> **Goal:** migrate the existing Klinik Matras CRM frontend onto Sano Design System v1
> incrementally, without regressions, buildable by one moderate-skill dev in plain JS.
> **Non-negotiables carried from CLAUDE.md:** plain JavaScript (no TS), Bahasa Indonesia
> UI copy, cost/maintainability first, `Laporan` is the proven migration template,
> `index.css` ships *without* preflight so old and new coexist safely.

---

## 0. Current architecture — assessment

### 0.1 What's good (keep and build on)
- **App is code-split** (`App.jsx` lazy-loads all 12 pages) — migration can be page-by-page
  with no bundle penalty.
- **Coexistence already works:** `main.jsx` loads `index.css` then `tailwind.css`
  (`theme.css` + `utilities.css`, **no preflight**). Tailwind adds utilities without
  resetting legacy element styles. This is the single most important enabler — we can
  migrate one page at a time and the rest are untouched.
- **Token bridge exists:** `tailwind.css` `@theme` defines the `brand-*` + `chart-*`
  scales and `@theme inline` maps shadcn semantic tokens (`--color-background`, `-card`,
  `-primary`, …) onto the legacy `index.css` variables. Changing a token cascades.
- **Three areas are already well-decomposed:** `features/inbox` (hooks + zustand stores +
  ChatWindow/ConversationList/CustomerPanel subtrees), `features/dashboard`, and
  `features/laporan` (the only area fully on Tailwind + `components/ui/*`).
- **Primitive library seeded:** `components/ui/{button,card,badge,tabs,skeleton}.jsx`
  using `cva` + `cn()` + Radix. This is the pattern to extend.
- **Good infra:** React Query, zustand, socket.io + SSE, framer-motion, `useCountUp`,
  a global `prefers-reduced-motion` reset.

### 0.2 What's holding us back (the migration targets)
- **`index.css` is a 3,291-line monolith** (~75 sections) holding *both* design tokens
  *and* every legacy component's styles (sidebar, inbox, tables, kanban, wizard,
  automation, settings, product gallery, copilot…). It is the center of gravity.
- **Two token systems partially overlap:** the older `:root` block in `index.css`
  (`--accent #2563EB`, `--success #10B981`, sidebar vars) vs the newer `@theme` in
  `tailwind.css` (`brand-600 #2064B7`, `chart-green #16A34A`). Duplicate blue/green/red
  values must be reconciled (already flagged in the color-system doc).
- **Monolithic legacy pages** (Automation 68KB, Pengaturan 41KB, Customers 25KB, CoPilot
  24KB, Pengguna 21KB, Products 16KB, Broadcast 13KB, Tracking 12KB, Pipeline 9KB) mix
  markup, heavy inline `style={{…}}`, and `index.css` classes.
- **Inbox is structurally split but visually legacy** — components live in feature
  folders yet are styled by large `index.css` sections (FASE C/D/E). Its migration is a
  *CSS* job, not a *refactor* job — lower risk than it looks, but high-touch.
- **Inconsistent page scaffolding:** most pages use `.dash-page` / `.page-header`; some
  (Laporan historically) drifted. No shared `PageHeader`/`PageBody` component yet.

### 0.3 Guiding strategy
> **Strangler-fig migration.** Wrap and replace page-by-page from the design tokens
> outward. Tokens first (cascades everywhere), then shared primitives, then the highest-
> value screens (Dashboard, Customer 360, Inbox), then the long tail. Delete each
> `index.css` section only when its page is fully migrated. Never a big-bang rewrite.

---

## 1. App shell redesign

The shell = `Layout.jsx` (sidebar + content) + `Topbar.jsx` + the `.app-shell` /
`.sidebar` / `.app-content` styles in `index.css`, plus global overlays mounted in
`App.jsx` (`InstallPrompt`, `UpdateBanner`, `CoPilotFloat`).

### 1.1 Target
A single, consistent, token-driven shell: light sidebar with sectioned nav, a top bar
with global ⌘K search + notifications + user menu, and a standardized page container so
every page has identical padding/header behavior.

### 1.2 Changes
1. **Introduce `components/ui/PageHeader.jsx` + `PageBody.jsx`** (or a `Page` wrapper) —
   encapsulates the `.dash-page` padding contract + `.page-header` (title/sub/actions,
   responsive wrap). Every migrated page adopts it. Fixes the clipped-padding drift and
   the mobile-clipping bugs on Pengaturan/Laporan/Pengguna.
2. **Refactor `Layout.jsx` sidebar markup to Tailwind** while preserving the existing
   `NAV_SECTIONS` data, role gating, collapse/mobile-drawer logic, unread badge, SSE, and
   notification sound. This is re-skinning, not re-architecting — behavior stays byte-for-
   byte identical; only class names change from `.sidebar-*` to utilities/tokens.
3. **Upgrade `Topbar.jsx`:** add the global command palette (⌘K) surface and standardize
   notification bell + user menu. Palette is additive (new component), can ship dark or
   later without blocking the shell reskin.
4. **AI affordance in the shell:** the "Tanya Sano" nav item gets the ✨ treatment; a
   gradient dot appears when Sano has a new suggestion. `CoPilotFloat` stays but is
   hidden on Inbox (known collision bug) — encode that rule in the shell.
5. **Token move:** migrate the shell-related tokens (`--sidebar-*`, `--shadow-*`,
   `--radius-*`) into the `@theme` layer (or keep as aliases) so the shell reads from one
   source.

### 1.3 Order & risk
Shell is **step 2** (right after tokens), because every page renders inside it and a
consistent container de-risks all subsequent page migrations. Risk: medium — the shell
carries critical realtime/notification logic; we reskin markup only and keep logic
untouched, verified against the existing behavior.

---

## 2. Component migration strategy

### 2.1 Principle
**Extend the existing `ui/` + `cva` pattern; never fork.** Build primitives once, compose
features from them. Domain constants (stage/status labels + colors, money/date format)
live in `utils/format.js` as the single source of truth.

### 2.2 Three tiers

**Tier 1 — Primitives (`components/ui/`)** — build/upgrade first; everything depends on them:
- Extend existing: `button` (+`danger`, +`ai` gradient, +`lg`), `card` (+`hero`,
  +`ai-insight` variants), `badge` (stage/status/health/complaint/channel/AI variants),
  `tabs`, `skeleton`.
- Add missing: `Table`, `ProgressBar`, `Timeline`, `Dropdown/Menu` (Radix),
  `Input`/`Select`/`Field`, `Modal/Sheet` (Radix Dialog), `Toast` (unify the two existing
  toasts), `SearchInput`, `Tooltip` (Radix), `EmptyState`.

**Tier 2 — Shared composites (`components/`)** — used across pages:
- `MetricCard` (exists) → align to tokens; add `HeroMetricCard`.
- `AIInsightCard` (new) — the flagship recommendation surface.
- `StageSelect` (exists in `components/customer/`) → make it the *one* stage selector
  reused by Pipeline, Customers table, Inbox drawer (kills the "Penawaran" hardcode drift).
- Unify `CustomerDrawer` + `features/inbox/CustomerPanel/*` → **one shared Customer 360
  component** (a stated goal in CLAUDE.md; two implementations currently drift).
- `DateRangePicker`, `Pagination`, `Avatar`, `ProductPicker` → re-skin to tokens.

**Tier 3 — Feature widgets (`features/*/components/`)** — migrate per page:
- Dashboard widgets, Inbox subtree, Laporan (mostly done — use as reference).

### 2.3 Rules
- A component is "migrated" when it: (a) uses only design tokens/utilities, (b) has no
  hard-coded hex outside tokens, (c) covers loading/empty/error states, (d) is keyboard-
  accessible with a visible focus ring, (e) ≥44px touch targets on mobile.
- Prefer Radix primitives for anything with a11y surface (menu, dialog, tooltip, tabs) —
  already a dependency.
- No new heavy dependencies. Reuse framer-motion, recharts, `useCountUp`, `tw-animate-css`.

---

## 3. CSS migration strategy

### 3.1 The model
`index.css` = tokens (top) + ~75 legacy component sections. `tailwind.css` = `@theme`
tokens + utilities. Migration converts legacy sections to utilities/`ui` components, then
**deletes the corresponding `index.css` section** — shrinking the monolith to zero over time.

### 3.2 Steps (in order)

1. **Token consolidation (do first, cascades everywhere).**
   - Make `@theme` in `tailwind.css` the source of truth. Reconcile duplicates:
     standardize on `brand-600 #2064B7`, `chart-green #16A34A`, `chart-rose #DC2626`
     (per color-system doc). Point the legacy `:root` aliases (`--accent`, `--success`,
     `--danger`, sidebar vars) *at* the canonical tokens so old classes shift color for
     free and nothing breaks.
   - Add the **AI layer tokens** (`--gradient-ai`, `--color-ai-*`, `--ai-glow`).
   - Add the **motion tokens** (durations/easings) in one place.
   - This is a small, high-leverage change: the whole app nudges toward the new palette
     before a single page is rewritten.

2. **Per-page conversion (strangler).** For each page, in migration order:
   - Rebuild markup with Tailwind utilities + `ui`/composite components.
   - Move any page-specific one-offs into co-located styles or utilities.
   - **Delete that page's `index.css` section(s)** in the same PR (verified by grepping
     the removed class names have zero remaining references).
   - Keep the section header comments as a checklist — each deleted header = progress.

3. **Shared-section conversion.** Sections used by many pages (buttons, forms, cards,
   badges, tables, modals, skeletons) migrate to `ui/` components early (Tier 1), then
   their `index.css` sections are removed once no page references the old classes.

4. **End state.** `index.css` collapses to: the `@font-face`/base body rule, the app-shell
   height fix (`100dvh`), and the reduced-motion reset — everything else lives in tokens +
   components. Target: from 3,291 lines to a few dozen.

### 3.3 Safety rules
- **Never enable Tailwind preflight** during migration — it would reset every un-migrated
  legacy element at once. (Only reconsider once `index.css` component sections are gone.)
- One page's classes are deleted only after that page is fully migrated **and** a grep
  confirms no other page reuses them (some classes like `.btn`, `.badge`, `.avatar` are
  shared — those migrate at the primitive tier, not per page).
- Inline `style={{…}}` blocks in legacy pages get converted alongside their page (they're
  the hidden bulk of the styling in Automation/Pengaturan/CoPilot).

---

## 4. File-by-file change plan

Ordered by wave. "Type" = R(reskin, logic untouched) · X(extract/decompose) ·
N(new file) · D(delete section/file) · A(align tokens only).

### Wave 0 — Foundations (no visual page rewrites)
| File | Type | Change |
|---|---|---|
| `styles/tailwind.css` | A | Reconcile duplicate tokens; add AI + motion tokens; make `@theme` canonical |
| `index.css` (`:root` only) | A | Repoint legacy aliases → canonical tokens; do **not** touch component sections yet |
| `utils/format.js` | X/N | Centralize STAGE_LABELS + stage/status/health **colors**, money/date formatters as the one source of truth |
| `lib/utils.js` | A | Confirm `cn()`; add motion-preset helpers if useful |
| `components/ui/button.jsx` | R | Add `danger`, `ai`, `lg` variants |
| `components/ui/card.jsx` | R | Add `hero` + `ai-insight` variants |
| `components/ui/badge.jsx` | R | Add domain variants (stage/status/health/complaint/channel/AI) |
| `components/ui/{Table,ProgressBar,Timeline,Menu,Input,Field,Modal,Toast,SearchInput,Tooltip,EmptyState}.jsx` | N | New primitives per component doc |

### Wave 1 — App shell
| File | Type | Change |
|---|---|---|
| `components/ui/PageHeader.jsx`, `PageBody.jsx` | N | Standard page container (padding, header, responsive) |
| `components/Layout.jsx` | R | Reskin sidebar markup to tokens; keep all logic (nav data, roles, collapse, drawer, unread/SSE/sound). Hide `CoPilotFloat` on Inbox |
| `components/Topbar.jsx` | R/N | Reskin; add ⌘K command palette + standardized bell/user menu |
| `App.jsx` | A | Minor: session-expired modal → `Modal` primitive; wrap routes in nothing new (Layout already wraps) |
| `pages/Login.jsx` | R | Small, self-contained — good first full-page reskin to validate the system |
| `index.css` §APP SHELL/§SIDEBAR/§TOPBAR/§LOGIN | D | Remove after the above land |

### Wave 2 — Dashboard (the thesis screen)
| File | Type | Change |
|---|---|---|
| `pages/Dashboard.jsx` | R | Reorder into Orient → Act → Analyze bands (dashboard-layout doc) |
| `features/dashboard/components/MetricCard.jsx` | A | Align to tokens; wire `HeroMetricCard` |
| `features/dashboard/components/{ChartWidget,PipelineWidget,RecentOrdersTable,TargetSalesWidget,SessionDistributionWidget,LeadsDetailModal,DashboardLayout}.jsx` | R | Reskin to tokens; charts adopt viz palette + Ramp-style tooltip |
| `features/dashboard/components/AIRecommendations.jsx`, `HotLeads.jsx`, `TeamHealth.jsx` | N | New "Act" band widgets (real-data backed) |
| `index.css` §KPI CARDS/§CHARTS/§RECENT CONVERSATIONS/§PROGRESS BAR/§FUNNEL/§PERFORMANCE MINI | D | Remove as widgets migrate |

### Wave 3 — Customer 360 (unify the two implementations)
| File | Type | Change |
|---|---|---|
| `components/Customer360/*` | N/X | New shared 360 (summary + score + next action + timeline + tabs) |
| `components/CustomerDrawer.jsx` | X | Refactor to render shared Customer360 |
| `features/inbox/components/CustomerPanel/*` (Profile/Pipeline/Orders/Notes/Info/Media/Group) | X | Point at shared Customer360 sections; delete drifted duplicates |
| `components/customer/{StageSelect,OrderSection,NotesSection}.jsx` | R | Become the shared, reused building blocks |
| `features/dashboard/components/AIInsightCard`… (AI summary) | N | `AIInsightCard` reused here |
| `index.css` §CUSTOMER DRAWER/§FASE E CUSTOMER PANEL | D | Remove after unification |

### Wave 4 — Inbox (high-touch, CSS-heavy, logic-stable)
| File | Type | Change |
|---|---|---|
| `pages/Inbox.jsx` | R | Reskin shell/3-panel layout to tokens |
| `features/inbox/components/ConversationList/*` | R | Reskin list/filter tabs/search/transfer popover |
| `features/inbox/components/ChatWindow/*` | R | Reskin composer, message bubbles, media, search, handover banner, voice |
| `features/inbox/components/CustomerPanel/*` | X | (done in Wave 3) |
| Add buying-signal / handover / AI-draft surfaces | N | AI banners + "Draf oleh Sano" per UX doc |
| `index.css` §INBOX 3-PANEL + §FASE C/D/E + all chat/media/attach/emoji/voice sections | D | The single biggest `index.css` reduction — remove incrementally per subcomponent |

### Wave 5 — Pipeline & Pelanggan (data-dense views)
| File | Type | Change |
|---|---|---|
| `pages/Pipeline.jsx` | R | Reskin kanban to `KanbanCard`; drag motion per animation doc |
| `pages/Customers.jsx` | R/X | Rebuild on new `Table` (Attio-style) + filters + mobile Customer Cards; extract table into a component |
| `components/Pagination.jsx`, `DateRangePicker.jsx`, `Avatar.jsx` | R | Reskin (shared) |
| `index.css` §CUSTOMER TABLE/§KANBAN/§QUICK FILTER/§STAGE BUTTONS | D | Remove after migration |

### Wave 6 — Long tail (lower traffic, larger files)
| File | Type | Change |
|---|---|---|
| `pages/Products.jsx` + `components/ProductPicker.jsx` | R | Reskin galeri + picker |
| `pages/Broadcast.jsx` | R | Reskin wizard steps |
| `pages/TrackingLinks.jsx` | R | Reskin |
| `pages/CoPilot.jsx` + `components/CoPilotFloat.jsx` + `components/knowledge/MarkdownEditor.jsx` | R | Reskin AI surfaces to the gradient language (this is where AI identity shines) |
| `pages/Automation.jsx` (68KB) | X/R | **Decompose first** into `features/automation/components/*`, then reskin — too big to reskin in place |
| `pages/Pengaturan.jsx` (41KB) | X/R | Decompose into sections, reskin, fix mobile clipping |
| `pages/Pengguna.jsx` | R | Reskin, fix mobile clipping |
| `index.css` §WIZARD/§AUTOMATION/§AI PLAYGROUND/§KNOWLEDGE/§CODEMIRROR/§SETTINGS/§USER MGMT/§GALERI PRODUK/§PRODUCT PICKER/§COPILOT | D | Remove as each migrates |

### Wave 7 — Cleanup
| File | Type | Change |
|---|---|---|
| `index.css` | D | Collapse to base body + `100dvh` shell fix + reduced-motion reset only |
| `components/Toast.jsx` + `ToastNotif.jsx` | X | Merge into one `Toast` system |
| Global | A | Final token audit: zero hard-coded hex outside `@theme`; a11y + mobile pass; on-device Android/PWA QA |

---

## 5. Risk assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Token reconciliation shifts colors app-wide unexpectedly** (two blues/greens) | Med | Med | Alias legacy vars → canonical tokens in one PR; visual diff each page before/after; the values are close, so shifts are subtle |
| R2 | **Deleting a shared `index.css` class breaks an un-migrated page** (e.g. `.btn`, `.badge`, `.avatar`, `.dash-page`) | Med | High | Never delete a class until grep shows zero refs; shared classes migrate at the primitive tier, not per page; keep the section-header checklist |
| R3 | **Accidentally enabling Tailwind preflight** resets all legacy elements at once | Low | High | Explicit rule + comment already in `tailwind.css`; keep preflight off until `index.css` component sections are gone |
| R4 | **Inbox regressions** — it carries realtime (socket/SSE), zustand stores, virtuoso, media, voice; reskin could break behavior | Med | High | Reskin is CSS-only; do not touch hooks/stores; migrate subcomponent-by-subcomponent behind the existing structure; test send/receive/media/scroll each step |
| R5 | **Shell logic breakage** (unread badge, notification sound, mobile drawer, session-expired) | Low | High | Treat `Layout`/`Topbar`/`App` as reskin-only; keep every effect/handler; verify notifications + collapse + mobile drawer after |
| R6 | **Automation (68KB) / Pengaturan (41KB) too large to reskin in place** | High | Med | Decompose into feature folders *before* reskinning; do these last (Wave 6), lower traffic |
| R7 | **AI widgets tempt fabricated data** to look impressive | Med | High | Enforce "real-data or honest empty" rule from design docs; AI recommendations derive only from existing signals (reply time, assignment, order status, targets) |
| R8 | **Customer 360 unification** merges two drifted implementations; data-shape mismatches | Med | Med | Reconcile the drawer vs panel data contracts first; build shared component, migrate one caller at a time |
| R9 | **Scope creep / solo-maintainer burnout** — 12 pages + new components is large | High | Med | Strict wave gating; each wave ships independently and is usable; no wave depends on a later one; Login + Dashboard early to prove value fast |
| R10 | **Deploy pipeline foot-guns** (VPS: must `npm run build`; Node 20; bind-mount `dist`) — per CLAUDE.md §12 | Med | High | Follow the documented deploy runbook exactly; verify bundle hash changes after each wave; no schema coupling in this frontend work |
| R11 | **Mobile clipping bugs persist** if `PageHeader/PageBody` isn't adopted uniformly | Med | Med | Make the page container mandatory in Wave 1; convert clipped pages (Pengaturan/Laporan/Pengguna) to it explicitly |
| R12 | **PWA/service-worker serves stale bundle** during rollout | Med | Med | Existing `UpdateBanner` + force-relogin flow covers this; bump version each wave |

### Rollback posture
Because migration is per-page and additive (old CSS deleted only after new lands),
**any wave can be reverted independently** by restoring its page file + `index.css`
section. No wave is a point of no return until Wave 7 cleanup.

---

## 6. Recommended sequence (summary)

`Wave 0 Tokens+Primitives` → `Wave 1 Shell+Login` → `Wave 2 Dashboard` →
`Wave 3 Customer 360` → `Wave 4 Inbox` → `Wave 5 Pipeline+Pelanggan` →
`Wave 6 Long tail (decompose Automation/Pengaturan first)` → `Wave 7 Cleanup`.

Each wave is independently shippable and demoable. Value shows up fast (Dashboard by
Wave 2), and the riskiest, highest-touch area (Inbox) is attempted only after the system
is proven on three simpler surfaces.

---

**Awaiting approval before writing any Phase 2 code.**
