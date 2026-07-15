# Wave 4A — Completion Record (Sano Intelligence Engine)

**Milestone:** Canonical rule-based Intelligence Engine + read-only API. No LLM, zero token
cost. **Frozen (unchanged):** WAHA, SSE, Inbox, WebSocket, auth, existing customer/order
contracts, schema. Commit: `3b93276` (+ tests/docs in the follow-up commit).

---

## 1. Verification status
| Check | Status |
|---|---|
| Backend syntax (`node --check` all files) | ✅ pass |
| **Engine regression tests** (`node --test`) — 5/5 | ✅ pass |
| Pure-engine runtime sanity (scores 0–100, deterministic, intent detection) | ✅ pass |
| No scoring duplication introduced outside `services/intelligence/` | ✅ confirmed |
| **Live API verification** (`verify-wave4a.mjs`, ADMIN+SALES, needs DB) | ⏳ **run on VPS/dev** |

## 2. Engine regression tests
`backend/src/services/intelligence/intelligence.test.mjs` (pure, no DB) — run with
`node --test src/services/intelligence/intelligence.test.mjs`:
- ✅ **Complaint escalation** — open complaint + last contact >24h → `nextAction` = resolve
  complaint (`urgency: urgent`), priority reasons cite complaint, health trend down.
- ✅ **Hot buying intent** — QUOTED + "harga / katalog / foto" recent inbound → opportunity
  ≥40, `detectedIntents` include `PRICE_INQUIRY` + `CATALOG_REQUEST`.
- ✅ **Cold customer** — no orders, 90 days silent → health `Berisiko` (<50), `nextAction` =
  reaktivasi, priority `low`.
- ✅ **Unanswered customer** — last inbound 4h unanswered → `nextAction` = "Balas follow-up"
  (`high`), priority reasons cite "belum dibalas".
- ✅ **Determinism** — same input → identical scores.

## 3. No-duplication confirmation
- Files 4A modified (`routes/customers.js`, `routes/intelligence.js`, `index.js`) contain
  **no scoring logic** — they only call the engine.
- The **only** backend scoring outside `services/intelligence/` is `analytics.js`'s
  pre-existing `HOT_WEIGHTS` (Wave 2B hot-leads) — **not introduced by 4A**; scheduled for
  gradual, contract-preserving migration onto the engine.
- Frontend `customer360/lib/healthScore.js` (3A) also pre-existing; migrates later. The
  engine's `healthScore.js` is an **exact port**, so that migration is behavior-preserving.

## 4. Live verification command (yours to run)
```bash
cd backend
SALES_EMAIL=<sales-email> SALES_PASS=<pass> node scripts/verify-wave4a.mjs
```
Asserts: API contracts · score range 0–100 · reasons/signals present · no field leak ·
ADMIN/SALES scoping · inaccessible customer → 403 · deterministic consistency. Exit 0 = pass.

## 5. Deploy note
New backend routes require a backend rebuild on the VPS (CLAUDE.md §12):
`git pull` → `docker compose up -d --build backend`. **No frontend change this wave**, so no
`npm run build` needed for these endpoints (frontend consumes them in a later UI wave).

## 6. Next
- Fill in ✅ for live verification here after running the script.
- **Wave 4B (selective LLM enhancement) requires a separate architecture proposal** — not started.
