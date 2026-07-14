# Sano Design System v1 — Color System

> Grounded in the tokens that already ship in `frontend/src/styles/tailwind.css`
> (`@theme`) and `frontend/src/index.css` (`:root`). **Almost nothing here is new** —
> it formalizes and names what exists, adds the AI gradient, and writes down the
> "when NOT to use" rules that were missing. Light theme only for v1.

---

## 1. Principles

- **One brand color.** Brand blue is the only identity color. Everything else is either
  neutral or a semantic state.
- **Semantic colors are earned.** Green/amber/rose/violet mean success/warning/danger/AI.
  They never appear as decoration.
- **The AI gradient is reserved.** It marks AI surfaces and nothing else.
- **60/30/10.** Neutral surface / structural neutral / color. Color ≤ ~10% per screen.
- **Contrast floor:** body text ≥ 4.5:1, large text/UI ≥ 3:1 (WCAG AA). Never encode
  meaning with color alone — always pair with icon, label, or shape (pipeline dots +
  text, trend arrows + sign).

---

## 2. Brand (primary) — blue

The brand blue is `#2064B7` (brand-600), already defined as a full scale in
`tailwind.css`. This is the canonical scale.

| Token | HEX | Use |
|---|---|---|
| `brand-50`  | `#EAF2FC` | Selected row bg, badge bg, subtle AI-free highlight |
| `brand-100` | `#D3E5F8` | Hover on light brand surfaces, chart fill tints |
| `brand-200` | `#A7CBF1` | Borders on brand surfaces, disabled primary |
| `brand-300` | `#7BB1EA` | Secondary chart series |
| `brand-400` | `#4F97E3` | Chart gradients (top stop) |
| `brand-500` | `#2E7DDA` | Chart gradients, hover accents |
| **`brand-600`** | **`#2064B7`** | **Primary buttons, active nav, links, key data ink** |
| `brand-700` | `#1A5296` | Primary button hover (`hover:bg-brand-700`) |
| `brand-800` | `#164476` | Pressed, deep gradient stop, the "hero" navy card |
| `brand-900` | `#123655` | Text on light-brand chips, darkest gradient stop |

> **Note on the two blues.** `index.css` also defines `--accent: #2563EB` (the older
> blue-600 used across legacy pages). For v1, **treat `brand-600 #2064B7` as the target
> brand blue** and let `--accent` alias toward it during migration. Do not introduce a
> third blue.

**Dark blue / hero surface:** for the single "hero" KPI card (SalesMonk / Ultraleads
pattern), use `brand-800 #164476` → `brand-900 #123655` gradient with white text.
**Light blue:** `brand-50 #EAF2FC` for selected/active-soft states and badge backgrounds.

**When NOT to use brand blue:**
- ❌ Never for success/error/warning states (that's the semantic set's job).
- ❌ Never as a large background fill on more than one card per view (breaks "one hero").
- ❌ Never on AI surfaces *as the identity* — AI uses the gradient, not flat brand blue.
- ❌ Never for destructive actions (delete = rose).

---

## 3. AI colors — the intelligence layer

This is the **only genuinely new palette**. It exists so "Sano is thinking / suggesting"
is instantly recognizable and never confused with a normal brand action.

| Token | Value | Use |
|---|---|---|
| `ai-violet` | `#7C3AED` | AI gradient start; already exists as `--color-purple` / `chart-violet` |
| `ai-blue` | `#2E7DDA` (brand-500) | AI gradient end (ties AI back to brand) |
| **`--gradient-ai`** | `linear-gradient(135deg, #7C3AED 0%, #2E7DDA 100%)` | AI surfaces: Tanya Sano panel accents, AI insight card border/header, ✨ glyph, "Draf oleh Sano" chips |
| `ai-violet-soft` | `#EDE9FE` (`chart-violet-soft`) | AI card background tint (very light), AI badge bg |
| `ai-glow` | `rgba(124,58,237,0.18)` | The shimmer/thinking state (see animation doc) |
| `ai-ink` | `#5B21B6` | Text/icon on `ai-violet-soft` (meets AA) |

**Usage examples:**
- The "Tanya Sano" (co-pilot) send button and header bar use `--gradient-ai`.
- AI-generated customer summary card: `ai-violet-soft` bg, a 1px gradient left-border,
  `ai-ink` label "Ringkasan AI", ✨ glyph.
- Buying-signal / handover suggestion banner in Inbox: `ai-violet-soft` with `ai-ink`
  text and a gradient dot.
- "Draf oleh Sano" tag on an AI-suggested reply.

**When NOT to use the AI gradient / violet:**
- ❌ Never on non-AI UI (no gradient buttons for "Simpan", "Ekspor", etc. — those are
  brand blue). Diluting the gradient kills the signal.
- ❌ Never as a full-screen or large-surface background (it's an accent, not a theme).
- ❌ Never for a status the user can't act on — AI color implies "Sano did/suggests
  something."
- ❌ Never combine violet + brand-blue flat fills adjacent (reads as two competing
  primaries); use the gradient to blend them instead.

---

## 4. Semantic colors

These already exist in `index.css` and `tailwind.css` (as `--success/--warning/--danger`
and the `chart-*` set). Formalized:

| Meaning | Token | HEX | Soft bg | On-soft text |
|---|---|---|---|---|
| **Success** (positive trend, WON, healthy) | `success` | `#16A34A` | `#DCFCE7` | `#166534` |
| **Warning** (pending, needs attention, unassigned) | `warning` | `#F59E0B` | `#FEF3C7` | `#92400E` |
| **Danger** (LOST, error, delete, complaint) | `danger` | `#DC2626` | `#FEE2E2` | `#991B1B` |
| **Info / neutral-accent** (open, informational) | `brand-600` | `#2064B7` | `#EAF2FC` | `#123655` |

> There are two greens/reds floating in the codebase (`--success #10B981` in the newer
> token block vs `#16A34A` in `chart-green` and `CLAUDE.md §10`). **Standardize on the
> `chart-*` values** (`#16A34A` green, `#DC2626` red) so badges and charts match. This
> is a one-line token reconciliation in Phase 2, called out here so it isn't missed.

**Domain mappings (single source of truth — keep in `utils/format.js` constants):**

- **Pipeline stage:** LEAD = amber · QUALIFIED = brand blue · QUOTED = violet ·
  WON = green · LOST = rose. (Matches `CLAUDE.md §10`. Note QUOTED shares AI's violet
  hue but as a *dot/badge*, never a gradient — no conflict.)
- **Conversation status:** OPEN = brand blue · PENDING = amber · RESOLVED = slate/neutral.
- **Order status:** WAITING_LIST = amber · PENGERJAAN = brand blue · PENGAMBILAN = violet ·
  FINISH = green.
- **Health status:** SAKIT = rose-soft chip · TIDAK_SAKIT = green-soft chip · (unset) = neutral.
- **Trend:** up = success green + ▲ · down = danger rose + ▼ (always paired with sign).

**When NOT to use semantic colors:**
- ❌ Green ≠ "brand" or "go" generically — only genuine positive/success meaning.
- ❌ Amber ≠ mild brand accent — only warning/pending.
- ❌ Rose ≠ emphasis — only danger/negative/destructive. A red "Ekspor" button is wrong.
- ❌ Don't use a semantic *soft bg* as a large surface; it's for chips/badges/rows.

---

## 5. Neutrals (the 90%)

Slate scale, already the app's foundation (`index.css`):

| Token | HEX | Use |
|---|---|---|
| `--bg-base` | `#F8FAFC` (slate-50) | Page background |
| `--bg-card` | `#FFFFFF` | Cards, panels, sidebar (light) |
| `--bg-subtle` | `#F1F5F9` (slate-100) | Hover fills, secondary surfaces, selected rows |
| `--border` | `#E2E8F0` (slate-200) | Hairline borders (the primary separator — prefer over fills) |
| `--text-primary` | `#0F172A` (slate-900) | Headings, key numbers, primary body |
| `--text-secondary` | `#64748B` (slate-500) | Secondary text, labels |
| `--text-muted` | `#94A3B8` (slate-400) | Meta, placeholders, timestamps, axis labels |

**When NOT to use neutrals:**
- ❌ Don't use slate-400 for anything that must be read carefully (fails contrast for
  small critical text on white — it's ~2.9:1; use slate-500+ for real content).
- ❌ Don't stack three gray fills to build hierarchy — use border + shadow + spacing.

---

## 6. Data-visualization palette

For multi-series charts, use this ordered, colorblind-considerate sequence (built from
existing `chart-*` tokens + brand). Assign in order; stop at what you need.

1. `brand-600 #2064B7` (primary series)
2. `chart-green #16A34A`
3. `chart-violet #7C3AED`
4. `chart-orange #F59E0B`
5. `brand-300 #7BB1EA`
6. `chart-rose #DC2626`

Rules: single-series charts use brand blue with a soft `brand-100`→transparent area
fill (the Ramp/Aether look). Category colors stay consistent across the whole app (lead
source X is always the same color on every chart). Gridlines are `slate-100`, axis text
`slate-400`, never heavier than the data.

---

## 7. Elevation & focus (color-adjacent)

- `--shadow-card`: `0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)` (rest).
- `--shadow-md`: `0 4px 16px rgba(15,23,42,0.10)` (hover / popovers / modals).
- **Focus ring:** `2px` ring in `brand-600` at ~40% + `2px` offset. Focus is always
  visible and never removed — keyboard users are first-class (Linear/Attio principle).

---

## 8. Quick reference — copy/paste token block (Phase 2)

```css
/* AI layer — the only additions to the existing @theme in tailwind.css */
--color-ai-violet:      #7C3AED;
--color-ai-blue:        #2E7DDA;
--color-ai-violet-soft: #EDE9FE;
--color-ai-ink:         #5B21B6;
--gradient-ai:          linear-gradient(135deg, #7C3AED 0%, #2E7DDA 100%);
--ai-glow:              rgba(124, 58, 237, 0.18);
```
Everything else (brand scale, chart set, semantic, neutral) already exists — Phase 2
reconciles the two green/red/blue duplicates and standardizes on the values above.
