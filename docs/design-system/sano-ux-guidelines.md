# Sano Design System v1 — UX Guidelines

> Covers: (1) the core UX principles, (2) the Customer 360 experience foundation,
> (3) responsive behavior. These are the rules that make the visual system *behave*
> like a command center rather than a database.

---

## PART 1 — UX PRINCIPLES

### 1.1 The prime directive: answer "what should I do next?"

Every important screen must go beyond displaying data. It should provide, in this order:

1. **Context** — where am I / what's the state? (the number, the status, the period)
2. **Insight** — what does it mean? (the trend, the comparison, the anomaly)
3. **Recommended action** — what should I do about it? (a concrete, one-click next step)

> ❌ "Total percakapan: 47"
> ✅ "47 percakapan · ▲ 12% dari minggu lalu · **9 belum dibalas >1 jam** → [Buka]"

If a screen only shows context, it's unfinished. This is the difference between Sano and
the CRMs it competes with.

### 1.2 Progressive disclosure — calm at rest, dense on demand

Show the 20% that matters; make the other 80% one click away. A customer row shows
name/stage/last-activity; the drawer reveals the full 360. A metric shows the number;
clicking opens the breakdown modal (already done for "Total Leads"). Never overwhelm the
first glance; never hide what a power user needs.

### 1.3 Speed is a feature

- Optimistic UI for cheap actions (assigning a chat, changing a stage) — reflect the
  change instantly, reconcile with the server after.
- Skeletons, not spinners, for page/section loads (matches existing pattern).
- Keyboard-first where it pays off: ⌘K global search/command, Enter to send, arrow-nav
  in lists. Power users (sales floor) live in the keyboard.
- Real-time where it matters: the SSE + polling for new messages already exists — surface
  it (live unread badge, incoming toast). Sano should feel *awake*.

### 1.4 Forgiveness & trust

- Confirm destructive actions (delete customer/order); make them undoable where feasible.
- Never lose typed input (draft replies, note text) on navigation.
- Editable-after-create everywhere (a stated product goal in `CLAUDE.md §8`) — nothing is
  a one-shot form.
- **Honest data:** no fabricated numbers to fill space; label estimates; helpful empty
  states over blank cards.

### 1.5 The AI is a co-pilot, not an autopilot

- AI output is always **labeled** (✨ / "oleh Sano"), **editable**, and **dismissible**.
  A suggested reply is a draft the human sends, never an auto-send.
- AI **suggests the next action**; the human decides. This mirrors the hard product rule
  that AI "opens the door, doesn't close the deal" (`CLAUDE.md §9`).
- **Mandatory human handover** on complaints/anger — the UI makes handover a prominent,
  one-tap action and Sano proactively recommends it (per `CLAUDE.md §16.8`).
- Sano never promises price/delivery/discount — AI copy is hedged by design.

### 1.6 Consistency

- One component per job (one button system, one card system, one table). Variants, not
  forks.
- One source of truth for domain labels/colors (stage labels, status colors, money
  format) in `utils/format.js` — kills the "Penawaran" drift.
- Same interaction everywhere: a stage selector behaves identically in Pipeline, the
  Pelanggan table, and the Inbox drawer.

### 1.7 Microcopy (Bahasa Indonesia, clinical-warm)

- Sentence case, friendly, direct. "Belum ada order" not "NO ORDERS FOUND".
- Actions are verbs: "Ambil", "Buka chat", "Tambah pelanggan", "Buat draf".
- Empty states teach the next step. Errors say what happened + what to do.
- Never expose raw enum values or IDs to users (show "Offers/Negosiasi", not "QUOTED").

---

## PART 2 — CUSTOMER 360 EXPERIENCE FOUNDATION

The Customer 360 is where the WhatsApp CRM proves its worth: one screen that makes a rep
instantly understand *who this person is and what to do for them*. Today it's a 4-tab
drawer (Profil / Orders / Catatan / Riwayat Chat) — the redesign keeps the drawer/full
options but restructures around **a decision, not a database record**.

### 2.1 Layout (drawer on desktop, full-page on mobile)

```
┌──────────────────────────────────────────────────────────┐
│ HEADER: [avatar] Nama · +62… · [stage ▾] · [health chip] │
│         [Pernah Komplain?] [assignee]     [Buka chat] ✕   │
├───────────────────────────┬──────────────────────────────┤
│ LEFT (identity + AI)      │ RIGHT (activity + records)   │
│                           │                              │
│ ✨ Ringkasan Sano          │ [Timeline ▾] [Orders]        │
│  (AI summary + next act)  │  [Catatan] [Chat]            │
│ ───────────────           │                              │
│ Skor Pelanggan  84        │  unified activity timeline    │
│ Profil (kota, sumber,     │  grouped by day, type-colored │
│  tipe, tags, berat badan) │  nodes (msg/order/note/AI)    │
│ Kontak & channel          │                              │
└───────────────────────────┴──────────────────────────────┘
```

### 2.2 The eight elements

1. **Customer profile** — name, phone(s), city (dropdown), email, tags, customer type
   (END_USER/CORPORATE), lead source (+ confirmed flag), assigned sales, and the
   mattress-domain fields that make Sano special: **berat badan per orang**
   (multi-entry — suami/istri/etc, per `CLAUDE.md §7D`), keluhan history, health status.
2. **AI summary (✨ Ringkasan Sano)** — the flagship. A 2–3 line synthesis: who they are,
   their sleep complaint, weight/size context, recommendation direction already discussed,
   and **the recommended next action**. This is exactly the handover summary the product
   requires so sales "don't ask from zero" (`CLAUDE.md §9`). Gradient-tinted AI card.
3. **Customer score** — a single 0–100 health/priority signal computed from real signals
   (recency, order value, pipeline stage, response gaps, complaints). Shown with a ring/
   bar + a plain-language reason ("Panas: baru chat, belum di-follow up"). No fake math —
   the formula is documented and explainable.
4. **Next action** — an explicit, one-tap recommended step surfaced in the header/summary
   ("Follow up sekarang", "Konfirmasi pengambilan order", "Handover ke sales").
5. **Conversation history** — inline WhatsApp thread (CS-1/CS-2 labeled), searchable,
   with media gallery. Opening full chat is one click ("Buka chat").
6. **Activity timeline** — unified, chronological: messages, stage changes, orders,
   notes, complaints, AI actions. Grouped by day, type-colored nodes. This replaces the
   siloed tabs as the *default* right-panel view (tabs remain as filters).
7. **Orders** — list with status progress (WAITING_LIST→PENGERJAAN→PENGAMBILAN→FINISH),
   order ID, value (computed from OrderItem sum — fixes the Rp0 breakdown bug), add-ons,
   merk/ukuran, keluhan, and complaint tracking per order.
8. **Notes** — internal, editable/deletable, attributed + timestamped.

### 2.3 Behavior rules

- **Everything editable inline** and consistent with the Inbox editor (one shared
  component, not two drifting implementations — a known issue in `CLAUDE.md §8`).
- The **complaint badge** ("Pernah Komplain") appears if any order has a complaint, with
  full history in the profile.
- **Group conversations** (Grup Sales/Driver/Produksi, `@g.us`) render an *Info Grup*
  panel instead of a customer profile — never treated as a lead.
- Opening a customer from anywhere (table, kanban, inbox, search) lands on the same 360.

### 2.4 What "360" must feel like

A rep opens it and within 3 seconds knows: **who, what's wrong, what we offered, and
what to do next** — without reading the whole thread. If the summary + score + next
action don't deliver that, the screen has failed regardless of how complete the data is.

---

## PART 3 — RESPONSIVE DESIGN FOUNDATION

Breakpoint: the app already standardizes on `@media (max-width: 768px)`. We formalize
three tiers.

### 3.1 Desktop (≥1024px) — the primary experience

Full power. Multi-panel layouts (3-panel Inbox, side-drawer 360, multi-column dashboard),
dense Attio-style tables, hover affordances, keyboard shortcuts, ⌘K palette. This is
where owners and managers do analysis and where reps run high-volume conversations.

### 3.2 Tablet (768–1023px) — adaptation

- Dashboard: 4-up KPIs → 2×2; two-column analytics → single column; AI/Hot-Leads full
  width.
- Inbox: two panels at a time (list+chat, or chat+details) with a toggle for the third.
- Tables stay, with horizontal scroll inside their own container (never the page body).
- Sidebar defaults to the collapsed icon rail to reclaim width.

### 3.3 Mobile (<768px) — critical workflows only

Mobile is not a shrunk desktop; it's the **on-the-floor rep tool**. Prioritize doing,
not analyzing. Support these workflows first-class; let deep analytics degrade gracefully.

**First-class on mobile:**
- **Inbox** — the hero mobile flow. Stacked navigation: conversation list → chat →
  customer panel as a bottom sheet (already the pattern). Reply, send media, quick
  replies, product gallery, take-over.
- **Hot Leads + AI recommendations** — the worklist, surfaced near the top of a mobile
  dashboard.
- **Customer 360** — full-page (not drawer), summary + next action first, tabs below.
- **Pipeline** — tab-per-stage (already the pattern) rather than side-by-side columns.
- **Pelanggan** — card list, not table (already the pattern).

**Degrade gracefully on mobile:** heavy analytics (Laporan multi-chart tabs, big funnels)
remain accessible but are not optimized for one-handed use — they're an owner-at-desk task.

**Mobile rules:**
- Touch targets ≥ 44×44px (already a rule — keep).
- Use `100dvh` for full-height shells (the fix already in `index.css` — keep).
- Bottom-anchored primary actions (send, save) within thumb reach.
- Hide/relocate the floating "Tanya Sano" button on Inbox (it collides with send — a
  known bug in `CLAUDE.md §7D`); the co-pilot is reachable from the sidebar instead.
- Fix the pages currently reported as clipped on mobile (Pengaturan, Laporan, Pengguna) —
  every page must respect the standard page-container padding and safe areas.
- No hover-only affordances on mobile — anything revealed on hover needs a tap equivalent.
