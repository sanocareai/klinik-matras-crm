# Wave 4B.0 — AI Sales Assistant Foundation (Completion Record)

**Date:** 2026-07-15
**Scope:** Backend gateway/contract/validator/audit/endpoint for internal **draft-only**
reply suggestions. **No UI, no auto-send, no WAHA/SSE/socket access, no customer chatbot.**
Activates the Wave 4A readiness layer (`services/intelligence/replyReadiness.js`) and reuses
the existing provider gateway. Architecture: `docs/design-system/wave-4b-ai-assistant-architecture.md`.

---

## 1. What shipped
- **Orchestrator** `services/replyAssistant/index.js` — single choke point, dependency-injected
  (context/provider/quota/audit injected → fully testable without DB/LLM).
  Order: kill switch → complaint/handover gate → quota+budget → LLM → validator → template fallback → audit.
- **Provider abstraction** `providers/{LLMProvider,ClaudeProvider,GeminiProvider}` — Claude Haiku
  active; Gemini is an inert placeholder; **no multi-provider routing**.
- **Contract** = Wave 4A `FUTURE_SUGGESTION_CONTRACT`; every suggestion `requiresHumanReview=true`.
- **Validator** — invariants + `promiseScrubber` (drops price/delivery/discount promises).
- **Gate** — rule-based; `COMPLAINT`/`HANDOVER_REQUEST` → blocked, no LLM.
- **Cost guard** — `REPLY_ASSISTANT_ENABLED`, `MAX_AI_COST_USD_MONTH`, daily caps SALES 30 / ADMIN 100.
  Any limit → template fallback (LLM never called beyond limits).
- **Endpoints** (under `/api/ai`, additive): `POST /reply-suggestions`, `GET /reply-suggestions/quota`,
  `PATCH /reply-suggestions/:id` (status/feedback; exercised by 4B.1 UI).
- **Audit** — additive `ReplySuggestionLog` table (+ `ReplySuggestionStatus`, `ReplySuggestionFeedback`).

## 2. Database migration
`prisma/migrations/20260715120000_add_reply_suggestion_log/` — additive table + 2 enums, **no FKs**,
no change to existing tables. `npx prisma validate` = valid.
**Reversible:** `DROP TABLE "ReplySuggestionLog"; DROP TYPE "ReplySuggestionFeedback"; DROP TYPE "ReplySuggestionStatus";`

**Status semantics (locked):** GENERATED/BLOCKED = backend; COPIED/EDITED/SENT/DISMISSED = client-reported (4B.1).
**SENT = sales sent MANUALLY via the existing WhatsApp compose flow — NEVER implies the assistant sent anything** (it has no send path).

## 3. Environment variables
| Var | Default | Effect |
|---|---|---|
| `REPLY_ASSISTANT_ENABLED` | `true` | `false` → `blocked: ASSISTANT_DISABLED`, no LLM |
| `MAX_AI_COST_USD_MONTH` | `20` | month spend ≥ limit → template fallback |

LLM path also requires an active Anthropic BYOK key (AI Playground). Absent → template fallback.

## 4. Verification
- `scripts/verify-wave4b.mjs` — **27/27 LULUS** (import isolation grep · complaint/handover blocked ·
  promise scrubber · role isolation · daily+monthly cost caps · kill switch · PII masking · no field leaks · contract shape).
- `node --test replyAssistant.test.mjs` — **14/14 pass** (intent gating · validator · cost · template
  determinism · orchestrator paths).
- `node --check` all files pass · `npx prisma validate` valid.

## 5. Frozen / not touched
WAHA · SSE · Socket.IO · webhooks · inbox · auth · existing customer/order/analytics/AI-sandbox
contracts. Only DB change is the additive audit table.

## 6. Deploy (⚠️ first migration in the redesign track)
```bash
git pull
docker compose up -d --build backend
docker compose exec backend npx prisma migrate deploy    # NEW: applies ReplySuggestionLog
docker compose restart backend
docker compose exec backend node scripts/verify-wave4b.mjs   # expect SEMUA LULUS
```
Rollback: `REPLY_ASSISTANT_ENABLED=false` (instant) or revert commit + the reversible SQL above.

## 7. Next (NOT started — needs approval)
- **4B.1** — Inbox side-panel draft UI (click-to-copy into existing compose; status/feedback via PATCH).
- **4B.2** — Red-team / Fase E gate.
- Customer-facing AI Warming (Fase F/G) — deferred, separate proposal.
