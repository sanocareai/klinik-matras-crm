# Sano Design System v1 — Animation Guidelines

> Motion should be **felt, not seen**. The product must read as *premium and fast*, not
> as a game. The app already has the right tools: `framer-motion`, `tw-animate-css`, a
> `fade-rise` keyframe and `useCountUp` hook, and a `prefers-reduced-motion` reset in
> `tailwind.css`. This doc sets the discipline for using them.

---

## 1. Philosophy

1. **Purpose over polish.** Every animation must do a job: orient (where did this come
   from?), give feedback (it worked), show relationship (this became that), or convey
   liveness (Sano is thinking). If it has no job, remove it.
2. **Fast.** Most UI transitions are **120–250ms**. Anything a user waits on repeatedly
   must feel instant. Only large one-time reveals (chart draw-in) may reach ~600ms.
3. **Natural easing.** Default to `cubic-bezier(0.16, 1, 0.3, 1)` (the existing
   `fade-rise` ease — a soft "ease-out-expo") for entrances, standard `ease-out` for
   most transitions, gentle spring only for drag/drop settle. Never linear (except
   continuous shimmer). Never bounce/overshoot on business UI.
4. **Calm at rest.** No looping, pulsing, or moving elements when idle — *except* the AI
   "thinking" shimmer, which is the one sanctioned ambient motion (and only while active).
5. **Accessibility is non-negotiable.** `prefers-reduced-motion: reduce` collapses all
   durations to ~0 (already implemented globally). Motion never carries information that
   isn't also conveyed statically.

---

## 2. The motion tokens

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 90–120ms | ease-out | Hover, dropdown open, tab switch, focus ring |
| `motion-base` | 150–200ms | ease-out | Toasts, chips, most state changes |
| `motion-entrance` | 250–350ms | `cubic-bezier(0.16,1,0.3,1)` | Card/section reveal (`fade-rise`) |
| `motion-count` | 600–900ms | ease-out | Number count-up (`useCountUp`) |
| `motion-draw` | 500–700ms | ease-out | Chart line/area draw-in, progress fill |
| `motion-spring` | ~250ms | spring(stiffness ~300, damping ~30) | Drag-drop settle |
| `motion-shimmer` | 1.4s loop | linear | AI "thinking" only |

Distances are small: entrance translate ≤ 10px (the existing `fade-rise` uses 10px),
hover scale ≤ 1.02. Big movement = cheap; small movement = expensive-feeling.

---

## 3. Where motion is used (and where it isn't)

### 3.1 Page transitions
- **Keep it minimal.** Route changes: a 150–200ms content fade (opacity only, no slide)
  so navigation feels crisp, not theatrical. The sidebar/shell never re-animates on
  navigation — only the content region.
- No full-page slide/zoom between routes (reads as mobile-app-demo, not SaaS).

### 3.2 Card & section appearance
- On first load, cards in a group **fade-rise** with a small **stagger** (~40–60ms
  between siblings) so a KPI row or dashboard band assembles gracefully. Use the existing
  `--animate-fade-rise`.
- Stagger applies **once per mount**, not on every re-render/data refresh (re-animating
  on every poll is nauseating). Guard with a mount flag.

### 3.3 Number counters
- KPIs and key figures **count up** from a lower value to the target on first appearance
  and on data change (`useCountUp` already does this). Always `tabular-nums` so digits
  don't shift width mid-count.
- Cap the effect: don't count-up tiny numbers (e.g. a badge "3") or values in dense
  tables — it's for headline metrics only.

### 3.4 Chart animation
- Line/area charts **draw in** left-to-right on mount (`motion-draw`); bars grow from
  baseline; donuts sweep. Recharts supports this natively — enable it, tuned to ~600ms.
- **Only on mount / range change**, never on hover or every refresh. Tooltips fade in
  ~100ms and track the cursor without lag.

### 3.5 Progress bars
- Fill animates from 0 → value on first paint (`motion-draw`). Target bars that cross a
  threshold (behind → met) may briefly flash the new color via a 200ms cross-fade.

### 3.6 Drag & drop (Pipeline Kanban)
- **Lift:** on grab, card raises to `shadow-md` + scale ~1.02, 150ms.
- **During drag:** origin slot shows a muted placeholder; target column highlights softly.
- **Drop:** card settles with `motion-spring`; the column value total **counts up/down**
  to its new sum. This makes the money impact of moving a deal legible.
- Keep it snappy — no long ghost trails.

### 3.7 AI loading / "thinking" states (the signature motion)
- When Sano generates (reply draft, summary, recommendation, ⌘K answer), show a **calm
  gradient shimmer** sweeping across a placeholder in the AI colors (`--ai-glow` over
  `ai-violet-soft`) — **never a spinner**. Intelligence should look effortless.
- Optionally a soft "breathing" glow on the ✨ glyph while active. Stops the instant
  content arrives; content then **fades in** (`motion-base`), it does not pop.
- This is the *only* place ambient/looping motion is allowed, and only while a request
  is in flight.

### 3.8 Feedback micro-motion
- Buttons: hover = color shift only (no move); press = optional 40ms scale 0.98; loading
  = spinner swaps in for the icon, label + width stay fixed (no layout jump).
- Toasts: slide-in + fade (`motion-base`) from the edge; auto-dismiss after 4–6s; hover
  pauses the timer; dismiss slides out.
- Dropdowns/popovers/modals: scale-fade from origin (`motion-instant` open, faster close).
- Selection/checkmarks: instant or ≤100ms; never delay a confirmation.

---

## 4. Hard "don'ts"

- ❌ No looping/pulsing/bouncing on idle UI (spinners-as-decoration, throbbing CTAs,
  animated backgrounds). The AI shimmer is the sole exception.
- ❌ No parallax, no scroll-jacking, no reveal-on-scroll for core app screens (this is a
  tool used all day, not a landing page).
- ❌ No animation longer than ~700ms on anything interactive.
- ❌ No motion that blocks input — the user can always click through/skip an entrance.
- ❌ No re-animating content on every data refresh (poll/SSE updates change values via
  count-up at most, not full re-entrance).
- ❌ No gradient/neon glow motion outside AI surfaces (protects the AI signal; avoids the
  "gaming interface" trap seen in some dark references).

---

## 5. Implementation notes

- **Reuse first:** `--animate-fade-rise` (entrances), `useCountUp` (numbers), Recharts
  built-in animation (charts), `tw-animate-css` (utility transitions), `framer-motion`
  (stagger, drag, layout). No new animation library needed.
- **Centralize tokens:** define the durations/easings above as CSS variables /
  framer-motion `transition` presets in one place so timing stays consistent (mirrors the
  color/spacing token approach).
- **Respect the global reduced-motion reset** already in `tailwind.css` — do not
  reintroduce hard-coded durations that bypass it. For framer-motion, gate variants on
  `useReducedMotion()`.
- **Test on a mid-range Android** (the real deployment target is PWA on Android) — if a
  transition stutters there, shorten or drop it. Performance is part of "premium."
