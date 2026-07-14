# Sano Design System v1 — Spacing & Components

> Defines the spacing scale first (requirement #4), then the reusable component library.
> Grounded in what exists: Radix primitives + `class-variance-authority` + `cn()` +
> Tailwind v4, with `card.jsx` / `button.jsx` / `badge.jsx` / `tabs.jsx` already in
> `components/ui/`. New components extend that pattern; they do **not** invent a new one.

---

## PART A — SPACING SYSTEM

### A.1 The scale (4px base)

Use a strict 4px grid. This is exactly Tailwind's default spacing scale — no custom
values, so it's free to adopt.

| Token | px | Typical use |
|---|---|---|
| `0.5` | 2 | Icon-to-text hairline nudge |
| `1` | 4 | Tight inline gaps (chip padding y) |
| `2` | 8 | Icon–label gap, badge padding x, button gap |
| `3` | 12 | Compact card padding, list row padding y, input padding |
| `4` | 16 | Default gap between related elements |
| `5` | 20 | Card inner padding (matches current `CardHeader/Content` p-5) |
| `6` | 24 | Gap between cards in a grid; section title → content |
| `8` | 32 | Page padding (desktop); gap between major sections |
| `10` | 40 | Large section separation |
| `12` | 48 | Hero / empty-state vertical breathing room |

**Rule:** if a value isn't on this scale, it's a bug. No `13px`, no `7px`.

### A.2 Applied spacing

| Context | Value |
|---|---|
| **Page padding** | 32 desktop (`p-8`), 24 tablet (`p-6`), 16 mobile (`p-4`) — reuse the existing `.dash-page` padding contract so all pages match |
| **Page title → content** | 24 (`mb-6`) |
| **Card inner padding** | 20 (`p-5`); compact/table cards 16 (`p-4`) |
| **Card → card (grid gap)** | 24 desktop (`gap-6`), 16 mobile (`gap-4`) |
| **Within a card, title → body** | 12 (`pb-3` header, matches current Card) |
| **Related controls (buttons, filters)** | 8 (`gap-2`) |
| **Form field → field** | 16 (`gap-4`); label → input 6 (`gap-1.5`) |
| **List/table row padding** | 12 y (`py-3`), 16 x (`px-4`) |
| **Sidebar link padding** | `9px 12px` (existing — keep) |

### A.3 Radii & elevation (already tokenized)

- `--radius` = `1rem` (16px) for cards (`rounded-2xl` in current `Card`), inputs use
  `--radius-input` 8px (`rounded-lg`), buttons `rounded-xl` (12px, per current button),
  pills/badges `rounded-full`.
- Shadows: `--shadow-card` at rest, `--shadow-md` on hover/popover/modal (see color doc).
- **Consistency rule:** one card corner radius across the app. Don't mix `rounded-xl`
  and `rounded-2xl` cards on the same screen.

---

## PART B — COMPONENT LIBRARY

Each component below lists: **Purpose · Layout · States · Hover · Motion.** All are
built as small plain-JS React components in `components/ui/` (primitives) or
`features/*/components/` (composed), styled with Tailwind utilities + `cn()`, following
the existing `cva` variant pattern.

---

### B.1 Layout components

#### App Shell
- **Purpose:** the fixed frame: sidebar + top bar + scrollable content. Already exists
  as `.app-shell` / `.app-content` (uses `100dvh` correctly for mobile — keep that fix).
- **Layout:** `flex`; sidebar `w-60` (240px) fixed, content `flex-1 overflow-y-auto`.
- **States:** default, `sidebar-collapsed` (icon-only rail), `mobile` (sidebar becomes
  an overlay drawer with backdrop — already implemented in `Layout.jsx`).
- **Motion:** sidebar collapse width transition 200ms ease; mobile drawer slides in
  from left 220ms with backdrop fade.

#### Sidebar
- **Purpose:** primary nav, grouped by section (OPERASIONAL / DATA / OUTREACH / ANALITIK /
  AI & OTOMASI / PENGATURAN — already defined in `Layout.jsx`).
- **Layout:** brand header · sectioned nav (overline label + links) · user footer ·
  version tag. Light surface, hairline right border.
- **States per link:** default (slate-500), hover (`bg-slate-100`, slate-900), active
  (`bg-brand-50`, brand-600 text + icon full opacity), disabled ("SOON" badge),
  with-badge (unread count pill in danger). **AI links** ("Tanya Sano") get the ✨ glyph;
  when Sano has a new suggestion, a small gradient dot may appear.
- **Hover:** background fill + text darken, 150ms (existing).
- **Motion:** active state has no slide; keep it instant and calm.

#### Header / Top Bar
- **Purpose:** page context + global actions. Exists as `Topbar.jsx`.
- **Layout:** mobile hamburger · (optional page breadcrumb/title) · global search
  (⌘K, Raycast-style) · notifications bell (unread badge) · user avatar/menu.
- **States:** search idle/focused/results; bell has/none unread.
- **Motion:** ⌘K palette opens with a 120ms scale-fade (see animation doc).

#### Page Container
- **Purpose:** consistent page padding + max width + header slot. Standardize the
  current `.dash-page` + `.page-header` into one `<PageHeader title sub actions>` +
  `<PageBody>` pair so every page matches (the Laporan header fix noted this gap).
- **Layout:** header row (title/sub left, actions right, wraps on mobile) then content.

---

### B.2 Cards

All cards share the base `Card` (`rounded-2xl border border-black/5 bg-card shadow-sm
hover:shadow-md` — already in `card.jsx`). Variants below are composed on top.

#### Metric Card
- **Purpose:** a single KPI. Exists as `MetricCard.jsx` (framer-motion + `useCountUp`).
- **Layout:** top row (label left, tinted icon chip right) · big `tabular-nums` value ·
  trend row (arrow + % + "dari periode sebelumnya").
- **States:** loading (skeleton), value, with-trend up/down, clickable (opens detail
  modal — already used by "Total Leads"), zero/empty.
- **Hover:** `scale 1.01` + shadow-md (existing); clickable variant shows pointer + ring
  on focus.
- **Motion:** entrance fade-rise (staggered across the row); number count-up on data change.

#### Hero Metric Card (new variant)
- **Purpose:** the *one* standout KPI per view (SalesMonk/Ultraleads pattern).
- **Layout:** same structure, but `brand-800→brand-900` gradient bg, white text, a
  small inline sparkline, and an "open" ↗ affordance top-right.
- **Rule:** max one per view. Everything around it stays white.

#### AI Insight Card (new)
- **Purpose:** surfaces a Sano recommendation ("what to do next"). Core to positioning.
- **Layout:** `ai-violet-soft` bg, 1px `--gradient-ai` left border, overline
  "✨ REKOMENDASI SANO" in `ai-ink`, a one-line insight (H3), a one-line rationale
  (Body-sm), and a primary action link. Dismissible (×).
- **States:** loading (shimmer), insight present, dismissed, empty ("Semua lead sudah
  ditangani 👍").
- **Hover:** action link underlines; card lifts to shadow-md.
- **Motion:** shimmer while generating; content fades in; dismiss slides + collapses.

#### Revenue Card
- **Purpose:** revenue over time with target context.
- **Layout:** big value + trend chip · area/line chart (brand blue, soft fill) · target
  progress bar underneath ("Rp42jt / Rp50jt · 84%").
- **States:** loading, on-track (green), behind (amber), no-target-set (prompt to set).

#### Performance Card (Sales/CS)
- **Purpose:** per-person progress vs monthly target (replaces the "plain table" the
  team flagged as unfinished in `CLAUDE.md §8`).
- **Layout:** avatar + name · milestone/progress bar to target · key stats
  (conversations, avg response, closing rate, order value). Ranked list.
- **States:** above/at/below target color-coded on the bar; no-target state.

#### Customer Card (mobile list item / drawer summary)
- **Purpose:** compact customer identity. Used in mobile Pelanggan list & Inbox list.
- **Layout:** colored initial avatar · name + phone · pipeline dot + stage · right meta
  (last activity, order status, health chip, complaint badge if any).
- **States:** default, unread (bold + dot), selected (`bg-brand-50`), assigned/unassigned,
  "belum dibalas 1j+" warning badge (per takeover rule in `CLAUDE.md §7C`).
- **Hover:** `bg-slate-50`; selected persists.

#### Activity Card / Item
- **Purpose:** one entry in a timeline (message, note, order, stage change, AI action).
- **Layout:** left icon/dot (type-colored) · content · timestamp (right, muted). Vertical
  connector line between items.
- **States:** by type (inbound msg, outbound msg, note, order, system/AI).

---

### B.3 Data components

#### Charts (Recharts — already a dependency)
- **Purpose:** trends & breakdowns. Reuse the `features/laporan` chart components.
- **Style:** single series = brand blue line + soft area fill; multi-series = the
  dataviz sequence (color doc §6); gridlines `slate-100`; axis text `slate-400`;
  custom tooltip = white card, shadow-md, `tabular-nums`, period-compare like Ramp.
- **States:** loading skeleton, empty ("Belum ada data untuk periode ini"), populated.
- **Motion:** draw-in on mount (line sweeps L→R ~600ms), tooltip fade 100ms. No looping.

#### Progress Bar
- **Purpose:** target attainment, funnel share, health.
- **Layout:** track `slate-100`, fill rounded, label + value inline or above.
- **States/color:** brand (neutral progress), green (met), amber (behind), rose (critical).
- **Motion:** fill width animates from 0 on first paint (400ms ease-out).

#### Timeline
- **Purpose:** the Customer 360 activity history (Intercom-style).
- **Layout:** vertical connector, type-colored nodes, grouped by day ("Hari ini",
  "Kemarin", date). Activity Cards as rows.
- **States:** loading, empty, load-more.

#### Tables (Attio-inspired)
- **Purpose:** power view for Pelanggan (and any list). This is the density workhorse.
- **Layout:** sticky header, hairline row separators, right-aligned numbers, colored
  stage dots, inline-editable cells where safe, row hover fill, multi-select checkboxes,
  sortable headers, pagination footer (reuse `Pagination.jsx`).
- **States:** loading (skeleton rows), empty, row hover, row selected, cell editing,
  sorted asc/desc.
- **Hover:** row `bg-slate-50`; action affordances appear on hover (Attio move).
- **Motion:** none on scroll (keep tables instant); cell-edit popover fades 120ms.
- **Mobile:** collapses to Customer Cards (already the current behavior — keep).

#### Kanban Card (Pipeline)
- **Purpose:** a deal/customer in a pipeline column. Exists (HTML5 DnD).
- **Layout:** name · value (`tabular-nums`) · stage-colored top accent or dot · assignee
  avatar · meta (last contact, city). Compact.
- **States:** default, dragging (lifted shadow-md + slight scale + reduced opacity on
  origin), drop-target column highlight, "stale" warning if untouched > N days.
- **Motion:** drag lift 150ms; drop settle spring; column total re-counts with count-up.

---

### B.4 Interaction components

#### Buttons
- **Purpose:** actions. Exists as `button.jsx` (`cva`, variants: default/outline/ghost,
  sizes default/sm). Extend, don't replace.
- **Variants:** `default` (brand-600 → hover brand-700), `outline` (border + white),
  `ghost` (text + hover slate-100), **`danger`** (rose, for destructive — add),
  **`ai`** (`--gradient-ai`, white text, **AI actions only** e.g. "Tanya Sano",
  "Buat draf balasan"). Sizes: `sm` (h-8), `default` (h-9), add `lg` (h-10) for primary
  page CTAs. Icon-only variant is square with `aria-label`.
- **States:** default, hover, active/pressed, focus-visible (brand ring), disabled
  (opacity-50, no pointer), loading (spinner replaces icon, label stays, width locked).
- **Hover:** background shift 150ms; never move/scale the button.
- **Motion:** press = subtle 40ms scale 0.98 (optional); loading spinner only.

#### Dropdowns / Menus
- **Purpose:** contextual actions, selects, filters. Build on Radix (already used).
- **Layout:** white surface, shadow-md, rounded-xl, 8px padding, item hover slate-100,
  section labels as overlines, destructive items in rose.
- **States:** closed, open, item hover/focus (keyboard), selected (check), disabled.
- **Motion:** open 120ms scale-fade from trigger origin; close 90ms.

#### Search (global ⌘K + local)
- **Purpose:** find anything fast (Raycast/Linear). Global command palette + inline
  list/table search.
- **Layout (palette):** centered modal, search input with ✨ hint, grouped results
  (Pelanggan, Percakapan, Halaman, Aksi), keyboard nav, recent items.
- **Local search:** input with leading magnifier icon, debounced, clearable.
- **States:** idle, typing (loading dots), results, no-results (helpful empty),
  AI-assisted answer row when relevant (gradient-tinted).
- **Motion:** palette 120ms scale-fade; results list stagger-in lightly.

#### Filters
- **Purpose:** narrow tables/lists (city, stage, assignee, order count — per current
  Pelanggan quick filters).
- **Layout:** pill/segmented row above the table; active filters show as removable chips;
  "Filter" button opens a popover for advanced combos (Attio pattern).
- **States:** inactive pill, active pill (`bg-brand-50` + brand text), applied-chip
  (with ×), count badge ("Filter · 2").
- **Motion:** chip add/remove 150ms; result list cross-fades.

#### Tabs
- **Purpose:** sub-navigation within a page. Exists as Radix `tabs.jsx` (used in Laporan).
- **Layout:** underline or segmented style; active = brand-600 text + 2px brand underline.
- **States:** default, hover, active, focus-visible, disabled.
- **Motion:** active underline slides between tabs 180ms (or instant if reduced-motion).

#### Notifications / Toasts
- **Purpose:** transient feedback + incoming-message alerts. Exists as `Toast.jsx` /
  `ToastNotif.jsx`.
- **Layout:** bottom-right (desktop) / top (mobile), white card, shadow-md, type icon
  (success/warn/danger/info), message, optional action, auto-dismiss.
- **States:** success, warning, danger, info, and the special **incoming WhatsApp**
  toast (avatar + name + preview + "Buka" action, with the notif sound already wired).
- **Motion:** slide-in + fade 200ms; auto-dismiss after 4–6s; hover pauses timer.

#### Badges / Chips (status)
- **Purpose:** encode state compactly. Exists as `badge.jsx`.
- **Layout:** rounded-full, soft semantic bg + on-soft text, 12px medium, optional dot.
- **Variants:** pipeline stage, conversation status, order status, health (SAKIT/
  TIDAK_SAKIT), "Pernah Komplain" (rose), channel (CS-1/CS-2, WA green), "Draf oleh Sano"
  (gradient).
- **Rule:** always pair color with text (never color-only meaning).

#### Inputs & Forms
- **Purpose:** data entry (add customer, order editor, settings).
- **Layout:** label (12/500) · input (`rounded-lg`, `border-slate-200`, `h-9`, 14px) ·
  helper/error below. City becomes a fixed dropdown; order items are repeatable rows.
- **States:** default, focus (brand ring), filled, error (rose border + message),
  disabled, loading.
- **Motion:** focus ring fade 120ms; error message slides in.

---

## PART C — Governance

- **Where things live:** primitives → `components/ui/`; composed feature widgets →
  `features/<area>/components/`. Shared logic (money/date format, stage labels/colors)
  → `utils/format.js` as single-source constants (fixes the "hardcoded 'Penawaran'"
  drift noted in `CLAUDE.md §8`).
- **How to extend:** add a variant to the existing `cva` config; don't fork a component.
- **Accessibility baseline:** every interactive element is keyboard-reachable, has a
  visible focus ring, a 44×44px min touch target on mobile (already a rule), and an
  accessible name. Radix primitives give this for free — prefer them.
- **Migration order** for components mirrors the page order in the implementation plan;
  `Laporan` is the reference implementation to copy.
