# Wave 2B — Implementation Spec (FINAL REVIEW BEFORE CODE)

> Supersedes the open questions in `wave-2b-backend-checkpoint.md` with your answers +
> verified schema facts. **Still no backend code** — this is the final review gate.
> **Frozen:** WAHA, SSE, webhooks, inbox logic, existing order/customer/analytics routes,
> DB schema (no migration).

## 0. Verified facts (checked against live code)
- **`UnresolvedMessage` is NOT the follow-up source** — it tracks WAHA JID-resolution
  failures (`reason: LID_UNRESOLVABLE | INVALID_JID`), not unanswered chats. → **Use
  `DISTINCT ON` from `Message`** (your answer #1).
- **`OrderStatus`** = `PENDING, PICKUP, PROCESSING, READY, DELIVERED, CANCELLED`
  → "ready to confirm" = **`READY`** (your #6 verified).
- **`ConversationStatus`** = `OPEN, PENDING, RESOLVED`. **`MessageDirection`** = `INBOUND, OUTBOUND`.
- **Permission middleware:** `backend/src/middleware/auth.js` → **`requireAuth`** sets
  `req.user = jwt.verify(token, JWT_SECRET)` = `{ id, role, ... }`; also exports `requireAdmin`.
- **Router:** `backend/src/routes/analytics.js` (`export const analyticsRouter`), mounted
  `app.use("/api/analytics", analyticsRouter)` in `src/index.js`. **Existing analytics
  routes are NOT behind `requireAuth` and are not role-scoped** — so **each new route must
  add `requireAuth`** to obtain `req.user` for scoping. (We do not touch existing routes.)

## 1. Affected files (exhaustive)
**Backend (additive only):**
- `src/routes/analytics.js` — add 3 handlers + `import { requireAuth } from "../middleware/auth.js"` (prisma already imported). No other backend file changes.

**Frontend:**
- `src/api.js` — add `getRecommendations`, `getHotLeads`, `getFollowUps`.
- `src/features/dashboard/hooks/useDashboardData.js` — swap the 3 mock queries for the real api calls; set `staleTime: 45_000`.
- `src/features/dashboard/data/contracts.js` — `BAND2_IS_MOCK = false` (keeps typedefs). This alone removes the "Contoh" badges (they're driven by that flag) — no widget edits needed.

**No new files. No schema. No migration** (your #5 — use existing indexes, monitor later).

## 2. Permission model (server-enforced)
```js
// per new route
analyticsRouter.get("/hot-leads", requireAuth, handler);
// inside handler:
const { id: userId, role } = req.user;
const isAdmin = role === "ADMIN";
// SALES scope = assigned to me + unassigned claimable; ADMIN = all
```
Client `user.role` only affects presentation (TeamHealth view). The server decides the
row set. A SALES token can never widen scope via params (there are none for scope).

## 3. Endpoint 1 — `GET /api/analytics/follow-ups`
Show **all** waiting conversations, tiered by severity (your #2).

**Exact SQL** (`prisma.$queryRaw`, parameterized; role branch built server-side):
```sql
SELECT DISTINCT ON (c.id)
       c.id,
       c."assignedToId",
       c."lastMessageAt",
       c."sessionId",
       cust.name  AS customer_name,
       m.direction,
       m.content  AS preview
FROM   "Conversation" c
JOIN   "Customer" cust ON cust.id = c."customerId"
JOIN   "Message"  m    ON m."conversationId" = c.id
WHERE  c.status = 'OPEN'
  AND  c.type   = 'INDIVIDUAL'
  AND  ( $1 = 'ADMIN' OR c."assignedToId" = $2 OR c."assignedToId" IS NULL )
ORDER  BY c.id, m."createdAt" DESC;   -- newest message per conversation
```
Params: `$1 = role`, `$2 = userId`. **Post-processing in JS:**
```
keep rows where direction = 'INBOUND'             // customer is waiting on us
waitingMinutes = floor((now - lastMessageAt)/60000)
severity = waitingMinutes >= 1440 ? 'critical'    // >24h
         : waitingMinutes >= 180  ? 'high'         // >3h
         : waitingMinutes >= 60   ? 'medium'       // >1h
         : 'low'
nextAction   = assignedToId ? 'Balas' : 'Ambil & balas'
sessionLabel = mapSession(sessionId)  // 'CS-1' | 'CS-2'
sort by waitingMinutes desc ; return all (cap 50)
```
> Contract gains a `severity` field (backward-compatible; the UI already derives overdue
> from `waitingMinutes`, and can adopt `severity` for the tier colors).

**Response example:**
```json
{ "items": [
  { "id":"cv_abc","customerName":"Bapak Andi","preview":"Kalau 160x200 berapa ya?",
    "waitingMinutes":185,"severity":"high","nextAction":"Ambil & balas",
    "assignedTo":null,"unassigned":true,"sessionLabel":"CS-1" }
] }
```

## 4. Endpoint 2 — `GET /api/analytics/hot-leads`
Explainable weighted score, simple & adjustable (your #3). SALES scope = assigned +
unassigned claimable only (your #4).

**Exact SQL** (bounded candidate set; `$queryRaw`):
```sql
SELECT cust.id, cust.name, cust.phone, cust."pipelineStage", cust."assignedSalesId",
       conv."lastMessageAt", conv."sessionId",
       lastmsg.direction  AS last_direction,
       lastmsg.content    AS last_content,
       COALESCE(ord.max_value, 0) AS value_estimate
FROM   "Customer" cust
LEFT JOIN LATERAL (
        SELECT c2."lastMessageAt", c2."sessionId"
        FROM "Conversation" c2
        WHERE c2."customerId" = cust.id AND c2.type = 'INDIVIDUAL'
        ORDER BY c2."lastMessageAt" DESC LIMIT 1 ) conv ON true
LEFT JOIN LATERAL (
        SELECT m2.direction, m2.content
        FROM "Message" m2
        JOIN "Conversation" c3 ON c3.id = m2."conversationId"
        WHERE c3."customerId" = cust.id
        ORDER BY m2."createdAt" DESC LIMIT 1 ) lastmsg ON true
LEFT JOIN LATERAL (
        SELECT MAX(o2.value) AS max_value
        FROM "Order" o2 WHERE o2."customerId" = cust.id ) ord ON true
WHERE  cust."pipelineStage" IN ('QUALIFIED','QUOTED')
  AND  conv."lastMessageAt" > now() - interval '7 days'
  AND  ( $1 = 'ADMIN' OR cust."assignedSalesId" = $2 OR cust."assignedSalesId" IS NULL )
ORDER  BY conv."lastMessageAt" DESC
LIMIT  50;
```
**Scoring (JS, weights in one adjustable const — 0–100 clamp):**
```js
const W = {
  stage:   { QUOTED: 35, QUALIFIED: 20 },
  recency: [ [30,25], [120,18], [360,10], [1440,5] ],   // [maxMinutes, points]
  intent:  { price: 15, catalog: 10, order: 12 },        // keyword hits (cap 25)
  unansweredBonus: 10,                                    // last msg INBOUND & waiting > 120m
};
// intent keywords (lowercased last_content):
//   price   → harga|berapa|price
//   catalog → katalog|foto|gambar|brosur
//   order   → order|beli|pesan|dp|bayar
// reason + signals[] built from which rules fired (explainable).
// nextAction derived from stage/signals. sort desc, take 10.
```
This is deliberately simple and centralized so weights are one-line adjustable.

**Response example:**
```json
{ "items": [
  { "id":"cust_1","name":"Bapak Andi","phone":"6281234567890","stage":"QUOTED",
    "score":92,"reason":"Sinyal beli kuat, belum di-follow up 3 jam",
    "signals":["Tanya harga","Sudah dikirim penawaran","Belum dibalas 3j"],
    "nextAction":"Follow up sekarang — kirim rincian harga",
    "valueEstimate":8500000,"assignedTo":null,"lastMessageAt":"2026-07-15T…","sessionLabel":"CS-1" }
] }
```

## 5. Endpoint 3 — `GET /api/analytics/recommendations`
Rule-based synthesis (not LLM). A few COUNT/aggregate queries → ranked items.

**Exact queries** (Prisma, all `requireAuth`, scoped):
```sql
-- a) unanswered >2h  (reuse follow-ups logic, count where waitingMinutes>120)
-- b) unassigned open
SELECT COUNT(*) FROM "Conversation"
WHERE status='OPEN' AND type='INDIVIDUAL' AND "assignedToId" IS NULL;
-- c) orders ready to confirm
SELECT COUNT(*) FROM "Order" WHERE status = 'READY'
  {{SALES: AND "customerId" IN (SELECT id FROM "Customer" WHERE "assignedSalesId" = $me)}};
-- d) open complaints
SELECT COUNT(*) FROM "Order" WHERE "hasComplaint" = true {{SALES scope as (c)}};
-- e) target attainment (per SalesTarget vs SUM(Order.value) this month) — reuse
--    existing sales-performance logic; flag reps < 50% with < N days left.
```
JS builds ranked `Recommendation[]`: complaint/unanswered → `severity:high`; orders/target →
`med`. `impact` = at-risk order value sum (from the same rows). `href` deep-links.

**Response example:**
```json
{ "items": [
  { "id":"followup","type":"followup","severity":"high","count":5,
    "title":"5 lead panas belum di-follow up",
    "detail":"Pesan terakhir dari customer >2 jam lalu, belum dibalas.",
    "impact":"Rp32jt potensi berisiko","actionLabel":"Buka lead","href":"/inbox" }
] }
```

## 6. Performance & caching
- Small dataset → every query < ~50ms; fixed small `LIMIT`s; no pagination. Existing indexes
  (`Conversation[status,lastMessageAt]`, `[assignedToId,status]`, `Order[customerId]`) cover
  the access paths. **No index migration** (your #5); monitor in production.
- **Caching:** none server-side initially. Client `staleTime: 45s`. Optional (later,
  client-only): invalidate `follow-ups`/`hot-leads` on the existing `new_message` SSE event
  — does not touch SSE/WAHA server code.

## 7. Rollback plan (two independent layers)
1. **Frontend instant revert:** set `BAND2_IS_MOCK = true` in `contracts.js` → Band 2 falls
   back to mock + "Contoh" badges, no backend needed. (Also point `useDashboardData` back to
   mock queries if the api methods were wired.)
2. **Backend revert:** the 3 handlers are additive — `git revert` the analytics.js commit (or
   comment out the 3 `analyticsRouter.get(...)` lines). Existing routes untouched, so revert
   is clean. **No schema/data migration to undo.**
- Deploy per CLAUDE.md §12 (backend rebuild + frontend build), verify each endpoint returns
  the contract shape, then flip the flag.

## 8. Test plan
- **Contract tests:** each endpoint's JSON matches `contracts.js` typedefs (keys/types).
- **Permission tests:** SALES token → only own + unassigned rows; ADMIN → all; SALES cannot
  see another rep's assigned leads.
- **Edge:** empty states (no waiting chats / no hot leads) return `{ items: [] }`.

---
**No backend code until this spec is approved.**
