# Migration Log — Wave 0: Foundations

**Date:** 2026-07-14
**Design system:** Sano Design System v1
**Plan reference:** `docs/design-system/sano-phase2-implementation-plan.md` (Wave 0)
**Scope:** Token layer + shared primitives only. **No page rewrites.** All changes are
additive or default-preserving, so the running app is visually identical except for one
intended, subtle palette reconciliation (see Token changes).
**Build:** `npm run build` → passes clean (only the pre-existing 620 KB MarkdownEditor
chunk-size warning, untouched by this wave).

---

## 1. Files changed

### Modified (source)
| File | Change | Breaking? |
|---|---|---|
| `frontend/src/styles/tailwind.css` | Added AI color tokens + `--ease-entrance` + shimmer keyframe to `@theme`; added `--gradient-ai`, `--ai-glow`, `--motion-*` vars + `.bg-ai-gradient` / `.text-ai-gradient` / `.ai-shimmer` utility classes | No (additive) |
| `frontend/src/index.css` | `:root` legacy aliases now reference canonical `@theme` tokens (single source of truth) | Subtle color shift only |
| `frontend/src/lib/utils.js` | Added `MOTION`, `fadeRise`, `staggerContainer`, `EASE_ENTRANCE` framer-motion presets | No (additive) |
| `frontend/src/utils/format.js` | Added centralized domain status→variant maps + helpers | No (additive) |
| `frontend/src/components/ui/button.jsx` | Added `danger`/`ai` variants, `lg`/`icon` sizes, focus ring; export `buttonVariants` | No (default variant unchanged) |
| `frontend/src/components/ui/card.jsx` | Converted to `cva`; `default` variant byte-for-byte identical; added `hero` + `ai-insight` | No (default preserved) |
| `frontend/src/components/ui/badge.jsx` | Added `success`/`warning`/`danger`/`info`/`violet`/`ai` variants | No (existing 4 unchanged) |

### Added (source — new primitives)
| File | Purpose |
|---|---|
| `frontend/src/components/ui/progress.jsx` | `ProgressBar` — target/attainment/funnel/health, animated fill, semantic variants |
| `frontend/src/components/ui/empty-state.jsx` | `EmptyState` — honest, action-guiding empty views |
| `frontend/src/components/ui/input.jsx` | `Input` — standard text input, focus ring, error state |
| `frontend/src/components/ui/field.jsx` | `Field` — label + control + helper/error wrapper |
| `frontend/src/components/ui/search-input.jsx` | `SearchInput` — local list/table search with leading icon + clear |
| `frontend/src/components/ui/tooltip.jsx` | `Tooltip` — accessible, on Radix (already a dependency) |

### Added (docs)
- `docs/design-system/` — Phase 1 spec (7 files) + `sano-phase2-implementation-plan.md`
- `docs/migration-log/wave-0-foundations.md` — this file

### Deliberately NOT committed
- `frontend/dist/**` — build artifacts; the VPS rebuilds `dist` on deploy (CLAUDE.md §12).
  Left out to keep the commit source-focused.

---

## 2. Components added / extended

**New primitives (6):** `ProgressBar`, `EmptyState`, `Input`, `Field`, `SearchInput`,
`Tooltip`. None are wired into any page yet — they are foundations for later waves.

**Extended primitives (3):**
- `Button` — `variant`: `default` (unchanged), `outline`, `ghost`, **`danger`**, **`ai`** (gradient, AI-only); `size`: `default`, `sm`, **`lg`**, **`icon`**.
- `Card` — `variant`: `default` (unchanged), **`hero`** (brand navy gradient), **`ai-insight`** (violet tint).
- `Badge` — added **`success`/`warning`/`danger`/`info`/`violet`/`ai`** to the existing `up`/`down`/`neutral`/`brand`.

**Deferred from Wave 0 (with rationale):**
- `Table`, `Timeline` — build alongside their first consumers (Waves 5 / 3) to avoid a speculative, wrong-fit API.
- `Modal`, `Menu` — require new deps `@radix-ui/react-dialog` + `@radix-ui/react-dropdown-menu`; approve at Wave 1 start.
- `Toast` unification — scheduled for Wave 7.

---

## 3. Token changes

### New (AI layer — the only genuinely new palette)
```
--color-ai-violet      #7c3aed
--color-ai-blue        #2e7dda   (= brand-500)
--color-ai-violet-soft #ede9fe
--color-ai-ink         #5b21b6
--gradient-ai          linear-gradient(135deg, #7c3aed 0%, #2e7dda 100%)
--ai-glow              rgba(124,58,237,0.18)
```
Utilities: `.bg-ai-gradient`, `.text-ai-gradient`, `.ai-shimmer` (the "Sano is thinking"
state — reduced-motion aware). **AI surfaces only.**

### New (motion)
```
--ease-entrance  cubic-bezier(0.16,1,0.3,1)
--motion-instant 110ms   --motion-base 180ms   --motion-entrance 300ms
--motion-count   750ms   --motion-draw 600ms
```

### Reconciled (the one intended visual shift)
Legacy `index.css` `:root` had its own values that differed slightly from the `@theme`
scale. Aliases now point at the canonical tokens (single source of truth); all legacy
pages inherit the final palette without touching individual references:

| Token | Before | After (canonical) |
|---|---|---|
| `--accent` | `#2563EB` | `#2064B7` (brand-600) |
| `--accent-hover` | `#1D4ED8` | `#1A5296` (brand-700) |
| `--accent-soft` | `#EFF6FF` | `#EAF2FC` (brand-50) |
| `--success` | `#10B981` | `#16A34A` (chart-green) |
| `--danger` | `#F43F5E` | `#DC2626` (chart-rose) — **most noticeable (rose→red)** |
| `--warning` | `#F59E0B` | `#F59E0B` (single-sourced) |
| `--color-purple` | `#7c3aed` | `#7c3aed` (single-sourced) |

### Centralized domain status colors (`utils/format.js`)
Status→Badge-variant maps + safe helpers, keyed to the **real** enums in code:
`STAGE_VARIANT` + `stageVariant()`, `CONV_STATUS_VARIANT` + `convStatusVariant()`,
`HEALTH_VARIANT` + `healthVariant()`, `ORDER_STATUS_VARIANT` + `orderStatusVariant()`,
`PAYMENT_STATUS_VARIANT` + `paymentStatusVariant()`. Unknown enum → `neutral` (never crashes).

---

## 4. Known risks

| Risk | Assessment | Mitigation / status |
|---|---|---|
| Token reconciliation shifts colors app-wide | Intended, subtle. Danger rose→red (`#F43F5E`→`#DC2626`) is the most visible | Verify visually on legacy pages during Wave 1; values chosen to match CLAUDE.md §10 + color-system doc |
| CSS var chain (`--accent: var(--color-brand-600)`) fails if `@theme` var absent at `:root` | Low | Verified in built CSS — `--color-brand-600` is emitted to `:root`; build passes |
| Reduced-motion regressions from new keyframes | Low | `.ai-shimmer` explicitly disabled under `prefers-reduced-motion`; global reset intact |
| Speculative primitive APIs drift from real needs | Mitigated | Consumer-coupled primitives (`Table`/`Timeline`) deliberately deferred |
| New primitives unused → dead code if waves stall | Low | All 6 are slated for Waves 1–5; documented as future consumers below |

---

## 5. Future consumers (where each foundation gets used)

| Foundation | First consumer (wave) |
|---|---|
| `PageHeader`/`PageBody` *(to build Wave 1)* | Every page; shell standardization |
| `Button` `ai` variant, `.bg-ai-gradient`, `.ai-shimmer` | Topbar ⌘K + "Tanya Sano" (W1), AI Insight card (W2), Inbox AI-draft (W4), CoPilot (W6) |
| `Card` `hero` | Dashboard hero KPI (W2) |
| `Card` `ai-insight`, `Badge` `ai` | Dashboard "Rekomendasi Sano" (W2), Customer 360 AI summary (W3) |
| `ProgressBar` | Dashboard Team Health + target bars (W2), pipeline funnel (W2), Customer score (W3) |
| `Badge` semantic + `format.js` variant helpers | Pipeline/status badges everywhere (W2–W5); kills the "Penawaran" hardcode drift |
| `Input`/`Field` | Customer/order editors (W3), Settings (W6), forms across pages |
| `SearchInput` | Pelanggan table + Inbox list (W4–W5) |
| `Tooltip` | Icon buttons in shell/topbar (W1) and throughout |
| `MOTION`/`fadeRise`/`staggerContainer` | Dashboard band entrance (W2), card reveals across waves |

---

## 6. Verification performed
- ✅ `npm run build` — clean (`built in ~10s`), no errors.
- ✅ Built CSS inspected — canonical `@theme` tokens emitted to `:root`; `--accent` chain
  resolves; AI utility classes present.
- ✅ Static review — all changes additive or default-preserving; no existing page's imports
  changed behavior; the 6 new primitives are not yet imported anywhere.
- ⚠️ Full click-through of every page requires the running app + backend (WAHA/Postgres),
  which isn't spun up in this environment; runtime risk is near-zero given the above.
