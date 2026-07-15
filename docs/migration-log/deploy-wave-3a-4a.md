# Deployment Instructions — Wave 3A (Customer 360) + Wave 4A (Intelligence Engine)

**Target:** VPS Sumopod Jakarta (`ubuntu@43.133.152.6`), `~/klinik-matras`.
**What's shipping:** Wave 3A = **frontend** (Customer 360 drawer). Wave 4A = **backend**
(intelligence engine + read-only routes). **No database migration** (nothing in the redesign
changed the schema). Follow CLAUDE.md §12 — the frontend will NOT update without `npm run build`.

---

## 0. Pre-flight
```bash
ssh ubuntu@43.133.152.6
cd ~/klinik-matras
node -v            # MUST be v20.x  (old Node silently breaks the frontend build — CLAUDE.md §12)
git status         # clean working tree before pulling
```

## 1. Pull
```bash
git pull                       # up to commit e42f57f
```

## 2. Frontend — Wave 3A (Customer 360)  ⚠️ REQUIRED
`frontend/dist` is bind-mounted into the backend container; changes appear ONLY after a real
build. `npm install` also picks up any fonts/deps from earlier waves not yet on this host
(Geist `@fontsource-variable/*`, Radix dialog/dropdown-menu).
```bash
cd ~/klinik-matras/frontend
npm install
npm run build                  # WAJIB — jangan skip
cd ~/klinik-matras
```

## 3. Backend — Wave 4A (intelligence routes)
```bash
docker compose up -d --build backend
```
No `prisma migrate deploy` needed (no schema change). Wave 4A adds only additive read-only
routes; existing routes/contracts unchanged.

## 4. Verify the deploy is really new
```bash
# frontend bundle hash changed (compare to before):
curl -s https://app.sanomatrassehat.com/ | grep -o 'index-[a-zA-Z0-9]*\.js'

# backend intelligence endpoints live (role-scoped, read-only):
cd ~/klinik-matras/backend
SALES_EMAIL=<sales-email> SALES_PASS=<pass> node scripts/verify-wave4a.mjs
# (optionally also: node scripts/verify-wave2b.mjs — should still pass, unchanged)
```
Then in the browser:
- **Pelanggan → click a customer → the new Customer 360 drawer opens** (Sano Insight,
  Customer Score, Next Action, flowing Activity Timeline). This is the visible Wave 3A change.
- Wave 4A endpoints exist but **no UI consumes them yet** (a later wave wires the Sano
  Intelligence dashboard + Customer360 → server intelligence).

## 5. Smoke test the frozen zones (should be unaffected)
- Inbox: send/receive a WhatsApp message (WAHA/SSE unchanged).
- Login/logout (auth unchanged).
- Existing customer/order edits in the drawer (order/notes/stage) save as before.

## 6. Rollback
- **Frontend:** `git checkout <prev-commit> -- frontend/src && cd frontend && npm run build`.
- **Backend:** `git revert 3b93276` (or `e42f57f..3b93276`) → `docker compose up -d --build backend`.
  Additive routes only; existing routes/contracts/schema untouched, so revert is clean.
- Full: `git reset --hard bcecf4a` (pre-3A/4A) then rebuild frontend + backend. (Destructive —
  only if needed.)

---

## Notes
- **Data safety:** no migration, no writes added — customer/order data untouched.
- **Cost:** Wave 4A is rule-based; zero AI/token cost.
- **Wave 4B (LLM):** not deployed, not present in runtime — deferred to a separate proposal.
