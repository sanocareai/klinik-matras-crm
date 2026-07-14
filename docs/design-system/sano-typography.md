# Sano Design System v1 — Typography

> The app already ships **Inter** (`index.css` body font stack). We keep it and add a
> disciplined scale + a dedicated treatment for numbers, which are the emotional core of
> a sales command center (the Ramp lesson: numbers are the hero).

---

## 1. Font recommendation

- **Primary UI font: Inter** (already loaded). Rationale: it's the de-facto SaaS
  standard (Linear, Vercel, Attio-adjacent), free, self-hostable (matches the
  cost/privacy constraints in `CLAUDE.md §2`), and excellent at small sizes and for
  tabular numbers. No change required.
  Stack: `'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif`.
- **Numbers / statistics:** Inter with `font-feature-settings: "tnum" 1, "cv01" 1;`
  (tabular figures) so digits align in columns and don't jitter during count-up
  animations. Apply via a `.num` / `tabular-nums` utility class on every metric,
  table figure, and currency value.
- **Optional display alternative (not required for v1):** if the brand later wants more
  personality on the biggest hero numbers, a geometric like *Söhne*/*Geist* could be
  introduced — but only self-hosted, and only for display. **Do not add a second
  webfont in Phase 2** unless there's a clear need; it costs load time for little gain.
- **Never** use a decorative/serif/handwritten font anywhere. Clinical warmth = clean sans.

---

## 2. Type scale

A restrained modular scale. Sizes in px (the app thinks in px; body is 14px today).
Weights: 400 regular, 500 medium, 600 semibold, 700 bold. Letter-spacing tightens as
size grows (large text gets `-0.01em` to `-0.02em`).

| Role | Size / Line / Weight | Tracking | Color | Usage |
|---|---|---|---|---|
| **Display** | 32 / 40 / 700 | −0.02em | slate-900 | Hero metric numbers only (rare, e.g. big revenue) |
| **H1** | 22 / 30 / 700 | −0.01em | slate-900 | Page title ("Halo, Gilang 👋", "Laporan Analitik") |
| **H2** | 18 / 26 / 600 | −0.01em | slate-900 | Section / widget group title |
| **H3 / Card title** | 14 / 20 / 600 | 0 | slate-700 | Card & widget titles (matches current `CardTitle`) |
| **Body** | 14 / 21 / 400 | 0 | slate-900 | Default text, messages, form values |
| **Body-sm** | 13 / 20 / 400 | 0 | slate-600 | Secondary text, list subtitles, table cells |
| **Label** | 12 / 16 / 500 | 0 | slate-500 | Field labels, chip text, meta |
| **Caption / Overline** | 10–11 / 14 / 600 | +0.06em, UPPERCASE | slate-400 | Section overlines ("OPERASIONAL"), timestamps, axis |
| **Metric (KPI)** | 26 / 32 / 700 | −0.01em | slate-900 | The number in a metric card |
| **Metric-lg (hero)** | 30–36 / 38 / 700 | −0.02em | white/brand | The one hero KPI per view |

> These map cleanly onto existing usage: current page titles are `fontSize:22, weight:700`
> (= H1 ✓), card titles are `text-sm font-semibold text-slate-700` (= H3 ✓), captions/
> overlines are the `10px 600 uppercase 0.8px` sidebar labels (= Caption ✓). The scale
> mostly *documents* what's there and fills the gaps (Display, H2, Metric variants).

**Tailwind mapping (for Phase 2):**
`text-[32px] font-bold` (Display) · `text-[22px] font-bold` (H1) · `text-lg font-semibold`
(H2) · `text-sm font-semibold` (H3) · `text-sm` (Body) · `text-[13px]` (Body-sm) ·
`text-xs font-medium` (Label) · `text-[10px] font-semibold uppercase tracking-wider`
(Overline) · `text-[26px] font-bold tabular-nums` (Metric).

---

## 3. Worked examples

**Dashboard header**
```
H1     Halo, Gilang 👋
Body-sm  Senin, 14 Juli 2026            ← slate-500
```

**Metric card**
```
Label    TOTAL REVENUE                  ← 12/500, could be overline style
Metric   Rp84,2jt                       ← 26/700 tabular-nums, slate-900
Trend    ▲ +12,5% dari periode lalu     ← 12/500 success-green
```

**AI insight card**
```
Overline ✨ REKOMENDASI SANO            ← ai-ink, 11/600 uppercase
H3       3 lead panas belum di-follow up ← 14/600 slate-900
Body-sm  Terakhir dibalas >2 jam lalu.  ← 13/400 slate-600
[Action] Lihat lead →                   ← 13/600 brand-600
```

**Table (Attio-style, Pelanggan)**
```
Header cells   Label 12/600 uppercase-ish, slate-500
Body cells     Body-sm 13/400 slate-700; name column 13/600 slate-900
Numbers        tabular-nums, right-aligned
```

---

## 4. Rules

1. **Numbers are the hero.** Any figure a user scans (KPIs, currency, counts, %) uses
   `tabular-nums`, bold-ish weight, slate-900, and is visually larger than its label.
   Labels are quiet (slate-500, small); numbers are loud.
2. **Currency formatting is fixed** by `formatRupiah` / `formatRupiahShort`
   (`CLAUDE.md §11`) — never hand-format. Short form (`Rp1,5jt`) in tight/mobile/chart
   contexts, full form (`Rp1.500.000`) in detail views.
3. **Max two weights per component.** Usually 600 (title/number) + 400 (body). Reserve
   700 for page titles and hero numbers.
4. **Hierarchy by size + weight + color, not by many colors.** Three text colors max in
   one card: primary (slate-900), secondary (slate-500/600), and one accent if needed.
5. **Line length** for reading text (notes, AI summaries) caps at ~65–75ch.
6. **Left-align text; right-align numbers** in tables. Never center body text.
7. **Indonesian first.** All shipped strings in Bahasa Indonesia; sentence case for
   body and titles ("Tambah pelanggan", not "Tambah Pelanggan"), UPPERCASE only for
   overlines/section labels.
8. **Respect the 14px base.** Don't go below 12px for anything a user must read; 10–11px
   is for overlines and non-critical meta only.
