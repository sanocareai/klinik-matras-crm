# Sano Design System v1 — Visual Philosophy

> **Status:** Phase 1 foundation (documentation only, no code changes).
> **Product:** Sano CRM — an AI-powered WhatsApp sales command center.
> **Audience:** Klinik Matras / Sano Care team (business owner, sales managers, sales reps, CS).
> **Scope:** This document defines *how Sano should feel*. The other six files
> (`sano-color-system`, `sano-typography`, `sano-spacing` inside components,
> `sano-components`, `sano-dashboard-layout`, `sano-ux-guidelines`,
> `sano-animation-guidelines`) define *how to build it*.

---

## 0. The one-sentence brief

> Sano is not a database you query. It is a **command center that tells you what to
> do next** — calm, fast, and quietly intelligent, so a 7-person mattress business
> feels like it runs on an enterprise sales floor.

Everything below serves that sentence. When a design decision is unclear, choose the
option that makes the *next action* more obvious, not the one that shows more data.

---

## 1. Overall style direction

Sano's language is **"clinical warmth"** — the same phrase the brand uses for its
sales voice (see `CLAUDE.md §16.7`). Translated to UI:

- **Clinical** = precise, structured, trustworthy. Generous white space, a strict
  spacing grid, restrained color, real numbers rendered with authority.
- **Warm** = human, not sterile. Soft rounded corners, friendly Indonesian
  microcopy, a single confident brand blue, avatars and conversation always close by.

We are building a **light-first, content-first** product. White is the canvas; color
is a tool used deliberately, never decoration. The interface should look like it was
*edited down* — every element earns its place.

**Reference DNA (extracted, not copied):**

| Source | What we take | What we leave |
|---|---|---|
| **Attio** | Dense, powerful data tables; inline edit; colored stage dots; keyboard-first feel | Its coldness / spreadsheet austerity |
| **HubSpot** | Familiar CRM mental models (pipeline, records, activity) | Its visual clutter and toolbar overload |
| **Intercom** | The 3-panel conversation shell; "conversation details" side rail; Reply/Note split | Its consumer-support tone |
| **Linear** | Speed, keyboard affordances, restraint, crisp typography, tasteful motion | Its all-dark aesthetic as the default |
| **Vercel** | Black-and-white confidence; high contrast; "less chrome" | Its near-monochrome (we need business color) |
| **Ramp** | Editorial big-number typography; sophisticated tooltips; executive calm | Its muted earth palette (we stay blue) |
| **Raycast** | The AI-command surface: a focused, gradient-accented "ask" panel that feels smart | Its power-user-only density |

The synthesis: **Attio's data power + Intercom's conversation shell + Linear's
restraint + Ramp's number typography + Raycast's AI moment**, all rendered in a
**light, blue, rounded** skin that already exists in the current app's tokens.

---

## 2. How Sano should feel vs competitors

The current product ("Klinik Matras CRM") is functional but reads as a *generic admin
template*: gradient KPI tiles, a table dashboard, inconsistent spacing between legacy
CSS and the newer Tailwind pages. The gap to close is **perceived intelligence and
polish**, not features.

| Attribute | Traditional CRM (incl. today's Sano) | Sano v1 target |
|---|---|---|
| First impression | "A form to fill in" | "A briefing that already did the thinking" |
| Data | Shows everything, equally weighted | Ranks by what needs a decision now |
| AI | A separate chatbot page | A visible layer woven through inbox, customer, dashboard |
| Color | Many accent colors competing | One brand blue + one reserved AI gradient |
| Motion | None, or jumpy | Purposeful, sub-250ms, respects reduced-motion |
| Density | Sparse tiles or overwhelming tables | Calm at rest, dense on demand (Attio-style tables) |
| Emotional read | Tool | Trusted co-pilot |

**The competitive wedge:** we are the only CRM in this business's world (WooBlazz,
Wulan AI — see `CLAUDE.md §17`) that treats **the WhatsApp conversation and the AI
recommendation as the center of gravity**, not the database table. Sano should always
feel one step ahead of the salesperson.

---

## 3. Rules for staying clean while colorful

The failure mode of "premium but colorful" is a rainbow dashboard (see reference #7,
Geex — playful but noisy). We avoid it with five hard rules:

1. **60 / 30 / 10.** ~60% neutral surface (white / slate-50), ~30% structural neutral
   (borders, secondary text, muted fills), ~10% color. If color exceeds ~10% of any
   screen, remove some.

2. **Color must mean something.** Every non-neutral color encodes state or identity:
   brand = primary action / brand identity; green = success / positive trend / WON;
   amber = warning / pending; rose = danger / LOST; violet-blue gradient = **AI only**.
   Never use color for pure decoration. If it doesn't carry meaning, it's neutral.

3. **One hero per view.** At most one saturated/gradient element per screen region
   draws the eye first — usually the single most important metric (see SalesMonk's one
   blue "Total Profit" card, or Ultraleads' one navy "Total Sales" card). Everything
   else is white with a colored *detail* (icon tint, trend chip, sparkline).

4. **Color lives in small, high-signal spots.** Charts, status badges, trend arrows,
   pipeline dots, the AI gradient. Large surfaces (page bg, card bg, headers) stay
   neutral. Big blocks of saturated color = template energy; small precise color =
   premium energy.

5. **Borders and shadow over fills.** Prefer a hairline border (`slate-200`) + a very
   soft shadow to separate surfaces, rather than gray fills. This is what makes Attio,
   Linear, and Vercel read as "expensive." Fills are reserved for hover/selected states.

---

## 4. The AI layer as a design primitive

Sano's differentiator is intelligence, so "AI-ness" gets its own reserved visual
signature — used sparingly enough that it always feels special:

- **The AI gradient** (violet → brand-blue, see color doc) appears *only* on AI
  surfaces: the "Tanya Sano" co-pilot, AI insight cards, AI-generated customer
  summaries, buying-signal / handover suggestions, and the ✨ Sparkles glyph.
- When Sano is thinking, it uses a **calm shimmer**, never a spinner (see animation
  doc). Intelligence should feel effortless, not busy.
- AI output is always **visually labeled and dismissible** — it's a suggestion, never
  an unremovable fact. This matches the product rule that AI "opens the door, it does
  not close the deal" (`CLAUDE.md §9, Phase 4`).

Because the gradient is *only* AI, users learn the association instantly: purple-blue =
Sano is helping. This is the Raycast lesson applied to a CRM.

---

## 5. Trust & restraint (this is a business's data)

This system runs a real business's customer relationships on self-hosted infrastructure
(`CLAUDE.md §2`). Two principles protect trust:

- **No dark patterns, no fake precision.** Never invent data to fill a widget. If a
  number is a placeholder or estimate, label it (the current dashboard's dummy "intent
  distribution" is exactly what we remove). Empty states are honest and helpful.
- **The AI never overstates.** No promised prices, delivery dates, or discounts in any
  AI surface (a hard brand rule). Design reinforces this: AI copy uses hedged,
  suggestion-style phrasing and always offers a human handover.

---

## 6. Practical constraints that shape the system

This is not a greenfield design. The system is deliberately buildable by **one
developer with moderate skills, in plain JavaScript, on a tight budget**
(`CLAUDE.md §2`). Therefore:

- **Light theme is the primary and only required theme.** A dark theme (the Aether /
  Synaptix references) is *inspiration for the AI accent language*, not a v1
  deliverable. Do not block Phase 2 on dark mode.
- **Tailwind v4 tokens are the source of truth**, layered on top of the existing
  `index.css` (which ships without preflight, so nothing breaks). The `Laporan` page is
  the proven migration pattern; every other page follows it incrementally.
- **All UI copy stays in Bahasa Indonesia.** Design examples in these docs may be in
  English, but shipped strings are Indonesian.
- **Reuse before invent.** New tokens must alias existing ones wherever possible
  (as `tailwind.css` already does), so a token change cascades instead of requiring
  hundreds of edits.

---

## 7. Design tenets (the short list to tape to the wall)

1. **Answer "what next?", not just "what is."**
2. **One hero, one action, per view.**
3. **Color earns its place or becomes neutral.**
4. **The AI gradient is sacred — AI only.**
5. **Calm at rest, dense on demand.**
6. **Numbers are the hero typographically.**
7. **Motion is felt, not seen (<250ms, reduced-motion safe).**
8. **Never fake data. Never overpromise.**
9. **Ship it incrementally; the Laporan page is the template.**
