# Wave 2B — Completion Record (Dashboard Band 2 backend)

**Milestone:** Dashboard "Sano Intelligence" (Band 2) is backed by real, role-scoped,
read-only analytics endpoints. Additive only — no WAHA/SSE/webhook/inbox/existing-API/
schema changes.

**Status:** ✅ **COMPLETE.** Runtime verification **PASSED** on 2026-07-15 via
`verify-wave2b.mjs` (DB-reachable environment):
1. ✅ ADMIN analytics — PASS (team-wide access, contract shapes)
2. ✅ SALES security isolation — PASS (scoped: own + unassigned claimable only; no other
   rep's data)
3. ✅ Field-leak guard — PASS (no out-of-contract fields returned)
4. ✅ Empty-state handling — PASS (`{ items: [] }` graceful)

All commits pushed after this pass. Wave 3 unblocked (pending its own architecture approval).

---

## 1. Endpoints created
All under `backend/src/routes/analytics.js`, mounted at `/api/analytics`, behind the
router-level `requireAuth` (`analyticsRouter.use(requireAuth)`). All **read-only `GET`**.

| Endpoint | Purpose | Ordering / limit |
|---|---|---|
| `GET /api/analytics/follow-ups` | Open conversations whose **last message is INBOUND** (customer waiting on us). Deduped per customer (longest-waiting). | sort by `waitingMinutes` desc, cap 20 |
| `GET /api/analytics/hot-leads` | Leads in `QUALIFIED`/`QUOTED` active in last 7 days, ranked by a transparent weighted **signal score**. | sort by `score` desc, cap 10 |
| `GET /api/analytics/recommendations` | Rule-based "what to do now" synthesis (not LLM): unanswered >2h, complaints, unassigned (admin), orders `READY`, targets <50% with ≤12 days left. | severity-sorted, cap 6 |

**Follow-up logic (verified):** a conversation is flagged **only** when its newest message
is `INBOUND`. If a salesperson already replied, the newest message is `OUTBOUND` → not
flagged. "Sales replied, customer silent" never appears.

**Hot-lead scoring (transparent, adjustable):** weights in a single `HOT_WEIGHTS` const —
stage (QUOTED 35 / QUALIFIED 20), recency tiers, intent keywords (price/catalog/order,
capped 25), unanswered bonus. Returns `signalScore` + reserved `aiConfidence: null` (future
Phase-4 AI, kept separate from the rule-based score).

---

## 2. Security rules
- **Auth:** every endpoint requires a valid JWT (`requireAuth`, `backend/src/middleware/auth.js`
  → `req.user = { id, role }`). No anonymous access.
- **Role scoping (server-enforced; client can't widen it):**
  - **ADMIN / OWNER** → team-wide data.
  - **SALES** → **only** their own assigned records **plus** unassigned/claimable ones
    (`OR: [{ assignedSalesId|assignedToId: req.user.id }, { …: null }]`). **Never another
    salesperson's assigned customer data.**
  - The `unassigned` **recommendation** is **admin-only**.
- **Field surface locked to the contract** — handlers return only the approved fields
  (no `email`, `city`, `tags`, `healthStatus`, internal relations, etc.). Enforced by the
  field-leak guard in the verification script.
- **No writes, no schema access** — pure reads over existing tables.

---

## 3. Contract fields (exact response surface)
Each endpoint returns `{ items: [...] }`. Source of truth:
`frontend/src/features/dashboard/data/contracts.js`.

**follow-ups item:**
`id, customerName, preview, waitingMinutes, severity ("critical"|"high"|"medium"|"low"),
nextAction, assignedTo (name|null), unassigned (bool), sessionLabel ("CS-1"|"CS-2")`

**hot-leads item:**
`id, name, phone, stage, score (0–100), signalScore, aiConfidence (null), reason,
signals (string[]), nextAction, valueEstimate (Rp), assignedTo (name|null),
lastMessageAt (ISO), sessionLabel`

**recommendations item:**
`id, type ("followup"|"unassigned"|"order"|"target"|"complaint"), severity ("high"|"med"|
"low"), count? , title, detail, impact?, actionLabel, href`

---

## 4. Rollback method (two independent layers)
1. **Instant, frontend-only:** set `BAND2_IS_MOCK = true` in
   `frontend/src/features/dashboard/data/contracts.js`. `useDashboardData` auto-falls back
   to the mock contracts and the "Contoh" badges reappear — no backend change needed.
2. **Backend:** `git revert` the implementation commit (`bd846a3`) — the 3 handlers are
   additive, existing routes untouched, and there is **no schema/data migration to undo**.

---

## 5. Verification command
Script (kept permanently in the repo): `backend/scripts/verify-wave2b.mjs`.

```bash
cd backend
# FULL run (mandatory security check needs a real SALES account):
SALES_EMAIL=<sales-email> SALES_PASS=<sales-pass> node scripts/verify-wave2b.mjs
# env overrides: BASE_URL (default http://localhost:4000), ADMIN_EMAIL, ADMIN_PASS
```
Asserts, exiting non-zero on any failure:
- **ADMIN:** HTTP 200 + `{ items: [...] }` + required contract fields (team-wide).
- **SALES:** scoped access; **every `assignedTo` is `null` or the SALES user's own name**
  (fails if another rep's data appears); no admin-only `unassigned` recommendation.
- **Field-leak guard:** each item's keys ⊆ approved contract fields (fails on any extra key).
- **Empty-data:** endpoints return `{ items: [] }` gracefully when there's nothing to show.

---

## 6. Wave 2B commit trail
| Commit | What |
|---|---|
| `468e84b` | Band-2 UI refinement + 2B checkpoint doc |
| `cc92703` | Geist typography migration |
| `7bccd58` | 2B implementation spec (final review) |
| `bd846a3` | **2B backend routes (Band 2 live)** |
| `b188666` | 2B verification refinements (dedup, confidence prep, scalability, defensive UI) + verify script |
| `cd7e9f5` | Security assertions in verify script |
| `631eb17` | Wave 2B completion record |
| _(this)_  | Mark runtime verification PASSED (2026-07-15) |

**Runtime verification: PASSED 2026-07-15.** All commits pushed. Next: Wave 3 (Customer 360)
— architecture approval required before coding.
