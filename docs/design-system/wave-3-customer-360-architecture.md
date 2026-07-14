# Wave 3 — Customer 360 Architecture Proposal

> **Status:** Proposal for approval — *no code.*
> **Goal:** one premium **Customer 360** that makes a rep understand, in ~3 seconds, *who
> this person is, what's wrong, what we offered, and what to do next* — and **unify the two
> customer-detail UIs that exist today** into a single source of truth.
> **Guardrails:** WAHA, SSE, webhooks, inbox realtime/stores, and existing customer/order
> APIs stay frozen. Any backend work is additive & read-only, behind its own checkpoint.

---

## 0. The core problem: two drifting implementations

There are **two** customer-detail UIs today, and they've drifted (flagged back in the Phase-2
plan):
1. **`components/CustomerDrawer.jsx`** (415 lines) — opened from the **Pelanggan** table.
   Tabs: `Profil · Order · Catatan · Riwayat Chat`. Standalone (no inbox coupling).
2. **`features/inbox/components/CustomerPanel/*`** — the **Inbox** right rail. Sections:
   `ProfileSection, PipelineSection, OrdersSection, NotesSection, InfoSection, MediaGallery,
   GroupPanel`. Lives *inside the production inbox* (realtime, zustand stores, sockets).

Editing the same customer field behaves differently in each; fixes have to be made twice.
**Wave 3's central move is to unify them into one shared `Customer360` component** consumed by
both surfaces — exactly the "one shared Customer 360" goal from `sano-ux-guidelines.md §2`.

---

## 1. Architecture

**One presentational component tree + one data hook, two mount points.**

```
components/customer360/
  Customer360.jsx           orchestrator (header + left rail + right rail)
  Customer360Header.jsx     identity + stage + health + complaint + assignee + actions
  panels/
    AiSummaryCard.jsx       ✨ rule-based synthesis (Phase-4 LLM later) — labeled
    CustomerScoreCard.jsx   explainable 0–100 (reuse Wave-2B scoring pattern)
    NextActionCard.jsx      one recommended step + CTA
    ProfileSection.jsx      identity, city, source, type, tags, berat badan, health
    OrdersSection.jsx       orders + status + items + complaint (reuse existing logic)
    NotesSection.jsx        editable internal notes
    ActivityTimeline.jsx    unified: messages + orders + notes + stage changes + AI
    ConversationHistory.jsx inline WA thread (read), "Buka chat" deep-link
    GroupInfoPanel.jsx      for @g.us group conversations (NOT a customer)
  hooks/useCustomer360.js   assembles data from EXISTING endpoints (React Query)
```

- **Presentational + data-hook split** (same pattern as Wave 2A). The component reads a
  `customer` object + sub-collections; the hook fetches them. This lets **both** the drawer
  and the inbox rail render the same component without either owning the data-fetching.
- **Reuse, don't rewrite:** the existing `components/customer/{StageSelect, OrderSection,
  NotesSection}` and the order/notes edit flows are wrapped, not replaced — their API calls
  (`updateCustomer`, notes/orders CRUD) are already correct and stay.
- **Two mount points:**
  - **Pelanggan** → `CustomerDrawer` becomes a thin shell that renders `<Customer360 />`.
  - **Inbox** → the right rail renders the same `<Customer360 variant="inbox" />`, but
    **fed by the inbox's existing data/stores** (see §5) — the component never reaches into
    inbox state itself.

### Suggested sequencing (de-risk, like 2A/2B)
- **3A — Pelanggan drawer first** (zero inbox coupling): build `Customer360` + hook, mount in
  the drawer, delete the drawer's bespoke markup. Fully shippable, low risk.
- **3B — Inbox adoption** (higher risk): swap the inbox `CustomerPanel` to render the shared
  `Customer360`, fed by inbox props/stores. Gated by its own review (WAHA/inbox risks in §5).

---

## 2. Data sources involved (all EXISTING)

| Need | Source (already in `api.js` / backend) |
|---|---|
| Customer profile + relations | `GET /customers/:id` (`getCustomer`) — name, phone, email, city, tags, pipelineStage, leadSource, assignedSales, customerType, healthStatus, profilePictureUrl |
| Orders (+ items, complaint, weight) | included in customer, or existing order endpoints (`updateOrder`, `/orders/:id/items`, `/complaint`, `/weight-entries`) |
| Notes (CRUD) | `getCustomer` (notes) + `addNote`/`updateNote`/`deleteNote` |
| Conversations / chat history | `getCustomerConversations(:id)` + existing message reads |
| Stage / health / type edits | `updateCustomer` (PATCH) — unchanged |
| **Customer score** (new signal) | *computed* from the above (recency, stage, order value, complaints, response gaps) — **no new data**, same explainable approach as Wave-2B hot-leads |
| **AI summary** | Phase-4 LLM (not now). Wave 3 uses a **rule-based synthesis** or a labeled placeholder (like Band-2 "Contoh") until Phase-4 infra is live |

**Net: the core Customer 360 needs no new data** — it re-composes what the customer/order/
notes/conversation endpoints already return.

---

## 3. UI hierarchy

Answering *who / what's wrong / what we offered / what next* top-first
(`sano-ux-guidelines.md §2`):

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER  [avatar] Nama · +62…  [stage ▾] [health chip]           │
│         [Pernah Komplain?]  [assignee]        [Buka chat]  ✕     │
├───────────────────────────────┬────────────────────────────────┤
│ LEFT (identity + intelligence)│ RIGHT (activity + records)     │
│  ✨ Ringkasan Sano (AI/rule)   │  [Timeline ▾ | Order | Catatan │
│  Skor Pelanggan  84  (why…)   │   | Chat]                       │
│  ▶ Langkah berikutnya + CTA   │  unified activity timeline,     │
│  ── Profil (kota, sumber,     │  grouped by day, type-colored   │
│     tipe, tags, berat badan)  │  nodes (msg/order/note/stage/AI)│
│  Kontak & channel (CS-1/CS-2) │                                 │
└───────────────────────────────┴────────────────────────────────┘
```
- **Header** carries the at-a-glance decision surface (stage, health, complaint badge,
  assignee, "Buka chat").
- **Left** = identity + the three intelligence pieces (AI summary, score, next action) —
  the Sano differentiator, reusing the Band-2 visual language (`ai-insight` card, score ring,
  CTA).
- **Right** = the **unified activity timeline** as the default (messages, orders, notes,
  stage changes, AI actions, grouped by day), with tabs to filter to Orders / Notes / Chat.
  This replaces the current siloed tabs as the primary view.
- **Responsive:** drawer/side-panel on desktop; **full-page** on mobile with summary + next
  action first (Inbox already uses a bottom-sheet pattern to preserve).
- **Group conversations** (`@g.us`) render `GroupInfoPanel`, never a customer profile.

---

## 4. API / backend impact

- **3A (Pelanggan drawer): frontend-only.** Reuses existing endpoints; **no backend change.**
- **Customer score:** compute **client-side** in 3A (explainable, from data already fetched)
  — no backend needed. *Optional later:* a read-only `GET /customers/:id/score` if we want it
  server-authoritative (additive, behind a checkpoint).
- **Activity timeline:** ideally one **additive read-only** endpoint
  `GET /customers/:id/activity` that merges messages/orders/notes/stage-events in one
  ordered list (cleaner than N client joins). **Optional** — 3A can assemble client-side
  from existing endpoints; the endpoint is a nice-to-have gated by its own 2B-style checkpoint
  (contracts, SQL, permissions, perf) before any backend code.
- **AI summary:** Phase-4 LLM; **no backend now** (rule-based/placeholder).
- **No writes, no schema changes, no changes to existing customer/order routes.**

> Decision point: whether Wave 3 stays **100% frontend** (compute score + timeline client-side)
> or adds the one optional read-only `activity` endpoint. Recommendation: **start frontend-only
> (3A)**, add the endpoint only if client-side assembly proves clumsy — same discipline as 2A→2B.

---

## 5. WAHA / inbox interaction risks (the critical section)

The Inbox `CustomerPanel` lives inside the **production realtime inbox**. 3B (inbox adoption)
is where risk concentrates.

| # | Risk | Level | Mitigation |
|---|---|---|---|
| R1 | Unifying the panel couples Customer 360 to **inbox zustand stores / socket / SSE** | High | `Customer360` is **presentational + own data hook**; in the inbox it receives data via **props** from the existing inbox layer. It must **never** import inbox stores or touch `useSocketEvents`/message stores. |
| R2 | **Activity timeline pulling message history** overlaps the inbox's own message loading (perf, double-fetch, or coupling to `useMessages`) | High | Timeline uses a **summarized** activity feed (last N events), not the full live thread; "Buka chat" deep-links to the inbox for the real conversation. Don't re-implement message streaming. |
| R3 | Editing stage/health/notes/orders inside the inbox panel must still reflect in inbox state | Med | Keep using the **existing** `updateCustomer`/notes/orders calls; let the inbox's current refresh/invalidation handle propagation (don't add a competing update path). |
| R4 | **Group conversations** (`@g.us`) accidentally rendered as a customer | Med | Preserve the `type==='GROUP'` branch → `GroupInfoPanel`; never build a Customer record for groups (existing rule). |
| R5 | Realtime updates (new message → panel) regressing during the swap | Med | 3B swaps **markup only**; the inbox's SSE/store→props flow that currently feeds `CustomerPanel` feeds `Customer360` identically. Verify unread/typing/new-message still update. |
| R6 | Mobile bottom-sheet / navigation regressions in the inbox | Med | Reuse the inbox's existing mobile panel mechanics; `Customer360` renders inside them, doesn't replace them. |
| R7 | Doing 3A + 3B together enlarges blast radius | Med | **Phase it:** ship 3A (drawer, no inbox) first; adopt in inbox (3B) as a separate, separately-verified step. |

**Frozen throughout:** WAHA integration, webhook handlers, SSE server logic, inbox message
stores/hooks (`useMessages`, `useConversations`, `useSocketEvents`, zustand stores), and the
existing customer/order APIs. Wave 3 is UI unification + (optionally) one additive read-only
endpoint.

---

## 6. Open questions for approval
1. **Scope of Wave 3:** 3A (Pelanggan drawer) only first, or 3A+3B (incl. inbox) together?
   (Recommendation: **3A first**, 3B as a gated follow-up.)
2. **Backend:** stay 100% frontend (compute score + timeline client-side), or add the one
   optional read-only `GET /customers/:id/activity` (own checkpoint)?
3. **AI summary in Customer 360:** rule-based synthesis now, or a labeled placeholder until
   Phase-4 LLM?
4. **Customer score formula:** reuse/extend the Wave-2B weighting (stage/recency/value/
   complaints/response-gap) — confirm the signals that matter for a *customer* (vs a lead).
