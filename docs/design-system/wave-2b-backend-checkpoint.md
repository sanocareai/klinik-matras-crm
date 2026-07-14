# Wave 2B — Backend Analytics Checkpoint (REVIEW BEFORE CODE)

> **Status:** Checkpoint document for approval. **No backend code written.**
> **Purpose:** the first backend change of the migration. Adds **3 read-only** analytics
> routes that power Dashboard Band 2. Requires your sign-off before any code.
> **Frozen (do NOT touch):** WAHA, SSE, webhooks, inbox logic, existing order/customer
> APIs, DB schema (writes/migrations). These routes are **additive `GET` handlers only**.

The frontend already consumes these shapes via mock (`features/dashboard/data/contracts.js`).
Wave 2B implements them for real and flips `BAND2_IS_MOCK = false`.

---

## 0. Ground truth: data model & scale

**Scale (CLAUDE.md §1):** ~50–100 messages/day, 7 users, a few thousand customers/orders
total. **This is a small dataset.** Performance is *not* a real constraint; correctness and
clarity matter more than optimization. (Noted explicitly so we don't over-engineer.)

**Relevant tables & fields (from `prisma/schema.prisma`):**
- `Customer` — `pipelineStage`, `assignedSalesId`, `healthStatus`, `createdAt`
  (indexes: `[createdAt]`).
- `Conversation` — `status` (OPEN/PENDING/RESOLVED), `assignedToId`, `customerId`,
  `lastMessageAt`, `channel`, `type` (INDIVIDUAL/GROUP)
  (indexes: `[status, lastMessageAt desc]`, `[assignedToId, status]`, `[channel, status]`).
- `Message` — `conversationId`, `direction` (INBOUND/OUTBOUND), `createdAt`
  (index: `[conversationId]`).
- `Order` — `customerId`, `status`, `value` (Rupiah), `hasComplaint`
  (index: `[customerId]`).
- `SalesTarget` — `userId`, `year`, `month`, `targetValue` (unique `[userId,year,month]`).
- `UnresolvedMessage` — **candidate source for follow-ups** (index `[createdAt]`) — *needs
  semantic confirmation (see Open Questions).*
- Auth: JWT middleware already sets `req.user` (`{ id, role }`) — reused for scoping.

---

## 1. Permission model (applies to all 3 routes)

**Single rule, enforced server-side, never from client params:**
```
const scope = req.user.role === "ADMIN"
  ? {}                                    // ADMIN/OWNER: whole team
  : { mine: req.user.id };                // SALES: only their own + claimable unassigned
```
- **SALES** sees: records assigned to them (`assignedSalesId`/`assignedToId = req.user.id`)
  **plus** unassigned/claimable items (unassigned conversations, unclaimed leads) — matching
  the existing takeover rule (CLAUDE.md §7C). Never other reps' assigned records.
- **ADMIN** sees everything.
- The client `user.role` only changes *presentation* (e.g. TeamHealth personal vs team);
  the **server** is the source of truth for what data is returned. A SALES token must never
  be able to pull team-wide numbers by tampering with params.

---

## 2. Endpoint contracts

### 2.1 `GET /api/analytics/follow-ups`
Conversations awaiting a reply (last message inbound, unanswered).

**Response:** `{ items: FollowUp[] }` (see `contracts.js`) — `{ id, customerName, preview,
waitingMinutes, nextAction, assignedTo, unassigned, sessionLabel }`, sorted by
`waitingMinutes` desc, limit ~15.

**Tables:** `Conversation` (+ `Customer` for name, `Message` for last preview/direction).

**Query strategy (raw SQL recommended for the "last message" part):**
```sql
-- latest message per OPEN individual conversation, keep only those whose
-- newest message is INBOUND (i.e. customer waiting on us)
SELECT DISTINCT ON (c.id)
       c.id, c.assigned_to_id, c."lastMessageAt", cust.name AS customer_name,
       m.direction, m.content AS preview
FROM "Conversation" c
JOIN "Customer" cust ON cust.id = c."customerId"
JOIN "Message"  m    ON m."conversationId" = c.id
WHERE c.status = 'OPEN' AND c.type = 'INDIVIDUAL'
  {{scope: AND (c.assigned_to_id = $me OR c.assigned_to_id IS NULL)}}
ORDER BY c.id, m."createdAt" DESC;
-- then in JS: keep rows where direction='INBOUND',
--   waitingMinutes = now - lastMessageAt, nextAction = unassigned ? 'Ambil & balas' : 'Balas',
--   sort by waitingMinutes desc, take 15
```
- **Alternative (preferred if it fits):** if `UnresolvedMessage` already tracks unanswered
  inbound messages, query it directly (join Conversation/Customer) — simpler and avoids the
  per-conversation scan. **To confirm in review (Open Q1).**
- `sessionLabel` = map `Conversation.sessionId` → "CS-1"/"CS-2".
- Excludes GROUP conversations (`type='GROUP'`) — never a lead.

**Perf:** uses `[status, lastMessageAt desc]`; `DISTINCT ON` scans Message per open convo —
fine at this scale. Threshold (show all waiting, or only >60min?) is a product choice (Open Q2).

---

### 2.2 `GET /api/analytics/hot-leads`
Ranked leads with a buying signal, with an explainable score.

**Response:** `{ items: HotLead[] }` — `{ id, name, phone, stage, score, reason, signals[],
nextAction, valueEstimate, assignedTo, lastMessageAt, sessionLabel }`, sorted by `score`
desc, limit ~10.

**Tables:** `Customer` (stage, assignedSalesId, lastMessageAt via latest conversation),
`Order` (latest/max value → `valueEstimate`), `Conversation`/`Message` (recency, last
inbound signal).

**Strategy (bounded candidate set + score in app):**
1. Candidate query: `Customer` where `pipelineStage IN ('QUALIFIED','QUOTED')`
   (active buying stages), joined to most-recent conversation `lastMessageAt` within last
   ~7 days. `{{scope}}`. Limit ~50 candidates.
2. For each, gather cheap signals: has an outstanding inbound (unanswered), last activity
   recency, order value, stage.
3. **Compute `score` (0–100) in JS** from a documented, explainable formula, e.g.:
   - stage weight (QUOTED > QUALIFIED),
   - recency (more recent = hotter),
   - unanswered-inbound bonus,
   - explicit buying signals (price ask / catalog request — from message text keywords, if
     cheap) → also populate `signals[]` and `reason`.
4. Sort by score desc, take 10. `nextAction` derived from stage + signals.
   > **Score can't be `ORDER BY`-ed in SQL** (it's a JS composite) — hence the bounded
   > candidate-set + in-app scoring. Formula weights need product input (Open Q3).

**Perf:** candidate set capped (stage filter + recency + limit 50). At current volume this is
a handful of rows. An index on `Customer(assignedSalesId)` or `(pipelineStage)` would help at
scale but is **not needed now** (would be a migration — Open Q5).

**Scope nuance:** SALES → their assigned leads + unassigned claimable (Open Q4).

---

### 2.3 `GET /api/analytics/recommendations`
Rule-based ranked "what to do now" — a synthesis of the other signals + orders + targets.
**Not an LLM** (v1). Explainable, cheap, zero token cost.

**Response:** `{ items: Recommendation[] }` — `{ id, type, severity, title, detail, impact?,
count?, actionLabel, href }`, ranked by severity/value, ~2–5 items.

**Tables:** reuses the follow-up + hot-lead signals, plus `Conversation` (unassigned count),
`Order` (status ready-to-confirm, `hasComplaint`), `SalesTarget` + `Order.value` (attainment
vs days-left).

**Strategy:** a handful of `COUNT`/aggregate queries, then build ranked items in JS:
| Rule | Query |
|---|---|
| N leads unanswered >2h | reuse follow-ups count (waiting>120, inbound) |
| M conversations unassigned | `COUNT Conversation WHERE status='OPEN' AND assignedToId IS NULL AND type='INDIVIDUAL'` |
| K orders ready to confirm | `COUNT Order WHERE status IN ('READY','PENGAMBILAN')` (verify enum) |
| Rep below target, few days left | `SalesTarget` vs `SUM(Order.value)` this month, `{{scope}}` |
| Open complaint | `COUNT Order WHERE hasComplaint=true` (recent/open) — handover priority |

Each rule that fires → one `Recommendation` with `count`, `impact` (e.g. sum of at-risk order
value), and an `href` deep-link. `severity`: complaints/unanswered = high; target/orders = med.

**Perf:** all `COUNT`s on indexed columns; ≤ ~5 tiny queries; run in parallel. `impact` sums
are bounded. Trivial at this scale.

---

## 3. Performance considerations (summary)
- **Dataset is small** — every query above returns/counts at most a few thousand rows;
  expected latency < 50ms each. No pagination needed (fixed small limits).
- Each route runs a **bounded, fixed** set of queries (no unbounded loops, no N+1 — the
  per-conversation "last message" is handled via `DISTINCT ON` in one query, or via
  `UnresolvedMessage`).
- Client already fetches the three in **parallel** (React Query), independent of Bands 1/3.
- **Future (only if volume grows):** add `Customer(pipelineStage, assignedSalesId)` and
  `Message(conversationId, createdAt desc)` indexes (migration — separate approval), or a
  single combined `GET /analytics/dashboard` to cut round-trips. Not now.

## 4. Caching strategy
- **Server:** **none initially.** Data should feel live and queries are cheap. (Optional
  later: 30–60s in-memory memoization keyed by `(role,userId)` for `recommendations` only.)
- **Client:** rely on the existing React Query `staleTime` (currently `Infinity` for the
  mock; set to **30–60s** for the real endpoints so the date-range/nav doesn't hammer them).
- **Live refresh (optional, client-only):** invalidate the `follow-ups`/`hot-leads` queries
  on the existing `new_message` SSE event so the worklist updates without polling. This is a
  **client** change (React Query `invalidateQueries`) — it does **not** modify SSE/WAHA
  server logic. Flagged as optional; off by default.

## 5. Testing & rollout
- **Contract tests:** assert each response matches the `contracts.js` shapes (keys/types).
- **Permission tests:** a SALES token gets only its own + unassigned; an ADMIN token gets
  team-wide; SALES cannot widen scope via params.
- **Rollout:** add handlers to `backend/src/routes/analytics.js` (additive), register route,
  deploy per CLAUDE.md §12 runbook (`git pull` → `npm install`/`build` frontend →
  `docker compose up -d --build backend` → verify), then flip `BAND2_IS_MOCK=false` and
  remove the "Contoh" badges. Roll back = revert the route commit (routes are additive, so
  reverting is clean; Bands 1/3 unaffected).

## 6. Open questions to confirm before coding
1. **`UnresolvedMessage`** — does it already track unanswered inbound messages (our
   follow-up source)? If yes, we use it; if not, we use the `DISTINCT ON` query.
2. **Follow-up threshold** — show all waiting, or only > 60 min (align with takeover rule)?
3. **Hot-lead score formula** — confirm the signals & weights (stage, recency, unanswered,
   price/catalog keywords). Product input needed so the score is meaningful.
4. **SALES scope for hot-leads** — their assigned leads only, or also unassigned claimable?
5. **Indexes/migrations** — OK to *not* add indexes now (fine at current scale), or add the
   two recommended ones as a small non-destructive migration (separate approval)?
6. **Order status enum** — confirm the "ready to confirm" values
   (`READY`/`PENGAMBILAN`/`FINISH`?) against the live `schema.prisma` before the
   recommendations rule uses them.

---

**No backend code will be written until this checkpoint is approved and the Open Questions
are resolved.**
