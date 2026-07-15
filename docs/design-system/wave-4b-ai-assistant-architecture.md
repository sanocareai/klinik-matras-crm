# Wave 4B — AI Sales Assistant — Architecture Checkpoint

**Date:** 2026-07-15
**Status:** Architecture APPROVED (decisions locked below). Implementing **4B.0 only**
(gateway · contract · validator · audit table · endpoint · verification). **No UI, no LLM
routing, no customer chatbot.**
**Anchor:** activates the Wave 4A readiness layer (`services/intelligence/replyReadiness.js`)
and reuses the existing provider gateway. The 4A Intelligence Engine is the **context source**.

---

## 0. Scope & non-goals (DECISION 1 — locked)

Wave 4B is an **internal Sales AI Assistant** that produces **draft reply suggestions only**.

**In scope (4B):**
- Draft suggestions for a real customer conversation, on explicit sales request.
- Human review REQUIRED — sales edits and sends **manually** through the existing compose box.

**Hard non-goals (must remain true):**
- ❌ No auto-send. The module can never transmit a message.
- ❌ No WAHA / SSE / Socket.IO / inbox send-path access (isolated module, grep-verifiable).
- ❌ No customer-facing chatbot / AI Warming (deferred — separate proposal, Fase F/G).
- ❌ No multi-provider routing yet (single model: Claude Haiku).
- ❌ No LLM in the complaint/handover gate's first pass (rule-based first).

---

## 1. Locked decisions

| # | Decision | Locked value |
|---|---|---|
| 1 | Scope | Internal sales draft-only; human review; no auto-send; no chatbot; no WAHA/send-path |
| 2 | Database | **Additive** `ReplySuggestionLog` table + `status` & `feedback` enums (see §7) |
| 3 | Model | Provider abstraction `LLMProvider` → `ClaudeProvider` (active) + `GeminiProvider` (future stub). **Claude Haiku only.** No routing yet |
| 4 | Context | Lean **intent-based KB slice** · max **10** messages · masked PII · 4A intelligence context. **Never full KB** |
| 5 | Cost | SALES **30**/day · ADMIN **100**/day · global `MAX_AI_COST_USD_MONTH` kill switch → fallback to rule-based template |
| 6 | UI | 4B.1 = **Inbox side-panel first**; Customer360 later (not in 4B.0) |
| 7 | Feedback loop | Per-suggestion `useful` / `not useful` → stored in `feedback` for future optimization |

---

## 2. Reuse map (do NOT rebuild)

| Capability | Existing asset | 4B role |
|---|---|---|
| LLM transport (multi-provider) | `services/providers/index.js` `chatWithModel()` | Wrapped by `ClaudeProvider` |
| Cost estimation | `services/providers/index.js` `logChatUsage()` + `PRICING` | Cost accounting into audit row |
| BYOK key store (AES-256) | `routes/ai.js` model registry (`data/ai-models.json`) | Provider credentials, on-server |
| Central model id | `config/aiModels.js` `AI_MODELS` | + `SANO_REPLY_ASSISTANT` |
| Complaint/handover classifier | `services/handoverDetector.js` | Optional 2nd-pass gate confirmation |
| Knowledge Base | `data/knowledge/*.md` + `buildKbContext()` | Source for the **intent-keyed slice** |
| **Reply contract + invariants** | **4A `replyReadiness.js`** | The spec 4B.0 implements & enforces |
| Customer intelligence context | **4A `intelligence/index.js`** `loadCustomerContext` + `buildCustomerIntelligence` | Context source |

The existing `/api/ai/draft-reply` is a **sandbox** (no gate, no invariants, no intelligence,
no audit, no cost cap). 4B builds its **production-safe successor** and leaves the sandbox
endpoint untouched.

---

## 3. AI Gateway architecture

New thin orchestrator `services/replyAssistant/` — the single choke point for every
reply-suggestion call. Pipeline:

```
POST /api/ai/reply-suggestions { conversationId }
        │
        ▼
 replyAssistant.generateSuggestions({ conversationId, user })
   1. QUOTA   ── check per-user daily cap + global monthly budget kill switch
   2. LOAD    ── 4A loadCustomerContext → buildCustomerIntelligence   (only prisma read)
                 └─ role-scope check → 403 if SALES not permitted
   3. GATE    ── 4A detectIntents (rule-based) [+ optional handoverDetector confirm]
                 └─ COMPLAINT / HANDOVER_REQUEST → { blocked:{reason} }, suggestions:[]  (NO LLM)
   4. CONTEXT ── 4A buildConversationContext (mask phone, cap 10 msgs, intelligence)
                 + intent-keyed KB slice (NOT full KB)
   5. GENERATE── LLMProvider.generate(...)  → existing chatWithModel() (Haiku, cached system)
                 └─ on provider failure / budget exceeded → rule-based TEMPLATE fallback
   6. VALIDATE── assertContractInvariants + promiseScrubber (price/delivery/discount)
   7. AUDIT   ── write ReplySuggestionLog row (status=GENERATED|BLOCKED, tokens, cost)
        │
        ▼
 FUTURE_SUGGESTION_CONTRACT payload (requiresHumanReview:true, trace)
```

**Isolation invariant:** `services/replyAssistant/**` MUST NOT import `wahaClient`, socket,
SSE, or any send path. Enforced by a grep assertion in the verify script.

---

## 4. Provider abstraction (DECISION 3)

```
services/replyAssistant/providers/
  LLMProvider.js      // interface: generate({ systemPrompt, context, maxTokens }) → { text, usage }
  ClaudeProvider.js   // ACTIVE — wraps existing providers/index.js chatWithModel (anthropic, Haiku)
  GeminiProvider.js   // FUTURE STUB — throws "not enabled in 4B"; wiring reserved
  index.js            // returns the active provider (Claude); NO routing logic yet
```

- `LLMProvider` is a minimal interface so a future wave can add routing without touching the
  orchestrator.
- 4B.0 ships **ClaudeProvider only** (Haiku via BYOK). `GeminiProvider` exists as an inert stub
  to prove the seam — not selectable.
- New central id: `AI_MODELS.SANO_REPLY_ASSISTANT = "claude-haiku-4-5-20251001"`.
- **Fallback order (4B.0):** Claude Haiku → (provider error OR monthly budget exceeded) →
  **rule-based template** suggestions from `INTENT_TAXONOMY`. (Gemini is NOT in the 4B.0 chain.)

---

## 5. Context design (DECISION 4)

- **Reuse `buildConversationContext` (4A) verbatim** — masks phone (`1234****789`), caps to the
  last **10** messages, embeds intelligence (health/priority/opportunity/nextAction),
  `detectedIntents`, `handoverRequired`, and an audit `trace`. Ephemeral — never persisted.
- **Intent-keyed KB slice**, never the full KB: a selector maps detected intents → a small
  curated snippet (e.g. `PRICE_INQUIRY`/`PROMO_INQUIRY` → pricing + garansi tiers;
  `SIZE_INQUIRY` → sizing). Keeps input tokens low and grounds replies in real facts.
- Customer message text is **untrusted** (prompt-injection): wrapped in explicit delimiters and
  labelled as data, not instructions. The **validator (§6) is the real backstop**, not the prompt.

## 6. Reply suggestion contract + validator

- **Reuse 4A `FUTURE_SUGGESTION_CONTRACT` + `assertContractInvariants`.** Response shape:

```jsonc
{
  "intent": "PRICE_INQUIRY",
  "handoverRecommended": false,
  "blocked": null,                       // or { "reason": "COMPLAINT" }
  "suggestions": [
    { "id": "s1", "text": "...", "tone": "hangat", "intent": "PRICE_INQUIRY",
      "source": "llm",                   // "llm" | "template"
      "confidence": null,                // no false precision
      "requiresHumanReview": true,       // ALWAYS true
      "disclaimers": ["Harga final dikonfirmasi tim"] }
  ],
  "quota": { "remaining": 29, "limit": 30 },
  "generatedAt": "ISO",
  "trace": { "engineVersion": "...", "contractVersion": "...", "requestId": "...", "model": "..." }
}
```

- **Enforced invariants (hard-fail before response):**
  1. `requiresHumanReview === true` on every suggestion.
  2. COMPLAINT / HANDOVER_REQUEST → `suggestions: []` + `blocked` set (no generation at all).
  3. No automatic sending (module has no send path).
  4. **No price/delivery/discount promises** — `promiseScrubber` regex-rejects any suggestion
     asserting a specific price, delivery date, or discount; a scrubbed suggestion is dropped
     (if all dropped → template fallback).
  5. Audit trace present.

## 7. Database impact (DECISION 2) — ⚠️ first migration in the redesign track

**Zero changes to existing tables.** One **additive, append-only** model + two enums:

```prisma
enum ReplySuggestionStatus {
  GENERATED   // created by backend
  COPIED      // sales copied a suggestion         (client-reported, 4B.1)
  EDITED      // sales edited before using          (client-reported, 4B.1)
  SENT        // sales manually sent it             (client-reported — NOT proof of WAHA send)
  DISMISSED   // sales dismissed the panel          (client-reported, 4B.1)
  BLOCKED     // gate blocked (complaint/handover)  — backend
}

enum ReplySuggestionFeedback {
  POSITIVE    // "useful"
  NEGATIVE    // "not useful"
  // NULL = no feedback yet (column nullable)
}

model ReplySuggestionLog {
  id              String   @id @default(cuid())
  conversationId  String?
  customerId      String?
  userId          String                       // requester (req.user.id)
  intent          String?                      // primary detected intent
  status          ReplySuggestionStatus @default(GENERATED)
  blocked         Boolean  @default(false)
  blockedReason   String?
  source          String?                      // "llm" | "template"
  model           String?
  inputTokens     Int      @default(0)
  outputTokens    Int      @default(0)
  costUsd         Float    @default(0)
  suggestionCount Int      @default(0)
  feedback        ReplySuggestionFeedback?     // NULL until given
  createdAt       DateTime @default(now())

  @@index([userId, createdAt])                 // daily per-user quota counter
  @@index([createdAt])                          // monthly budget rollup
}
```

- **Purpose (per decision):** audit · cost tracking · usage analytics · future AI improvement.
- **`status` lifecycle:** `GENERATED`/`BLOCKED` are set by the backend in 4B.0. `COPIED`/`EDITED`/
  `SENT`/`DISMISSED` are **client-reported** transitions wired in **4B.1** via a
  `PATCH /reply-suggestions/:id` endpoint (defined but unused until 4B.1). **`SENT` records the
  sales' own action in the normal compose box — it is NOT evidence the module sent anything
  (it cannot).**
- **Rate limiting & budget** derive from this table (count today's rows per user; sum
  `costUsd` for the current month) — no separate counter table.
- **Deploy note:** this is the **first schema migration** in the redesign track — deploy
  requires `docker compose exec backend npx prisma migrate deploy` (CLAUDE.md §12 step 5).
  Additive only; existing tables/columns untouched; migration is reversible.

## 8. Cost control (DECISION 5)

- **Per-user daily cap:** SALES = 30/day, ADMIN = 100/day (count of `ReplySuggestionLog` rows
  where `status != BLOCKED` for today). Exceeded → `429`-style graceful payload
  ("batas harian tercapai"), no LLM call.
- **Global monthly budget kill switch:** env `MAX_AI_COST_USD_MONTH`. Before each generate,
  sum `costUsd` for the current month; if ≥ limit → **skip LLM, serve rule-based template**
  suggestions (feature degrades, never hard-fails).
- **Master flag:** `REPLY_ASSISTANT_ENABLED` (env) — instant disable of the endpoint.
- **Token discipline:** on-demand only (never per-message); intent-keyed KB slice; last-10
  window; cached static system prompt; output cap ~350 tokens.
- **Cost estimate:** ~1.5K in + 350 out on Haiku ≈ **$0.002/suggestion**; SALES cap 30/day ≈
  **$0.06/user/day**. Team-wide well under the <Rp300k/mo target; `MAX_AI_COST_USD_MONTH` is the
  hard ceiling regardless.

## 9. Backend API design (4B.0)

Under existing `aiRouter` (`requireAuth`), role-scoped, read-only except audit rows:

- `POST /api/ai/reply-suggestions` `{ conversationId }` → contract payload (§6).
  - 403 if SALES not permitted for that conversation's customer (same rule as
    `/customers/:id/intelligence`).
  - 404 if conversation/customer not found.
  - Graceful payloads for: quota exceeded, budget exceeded (template), gate-blocked, disabled.
- `GET  /api/ai/reply-suggestions/quota` → `{ remaining, limit, resetsAt }`.
- `PATCH /api/ai/reply-suggestions/:id` `{ status?, feedback? }` — **defined but exercised in
  4B.1** (records COPIED/EDITED/SENT/DISMISSED + useful/not-useful). Owner/ADMIN only.
- Sandbox `/draft-reply`, `/handover-check`, `/chat`, `/copilot-chat` — **untouched**.

## 10. Migration phases

- **4B.0 (this step) — backend only, NO UI:** orchestrator + `LLMProvider`/`ClaudeProvider` +
  intent-KB slice + gate + validator/scrubber + `ReplySuggestionLog` migration + endpoints +
  `verify-wave4b.mjs`. Testable by curl.
- **4B.1 — Inbox side-panel (internal SALES):** "Draft dengan Sano" button → shows suggestions
  → click-to-copy into the normal compose box (existing send path untouched); `PATCH` reports
  status/feedback. Customer360 integration deferred within 4B.1+.
- **4B.2 — Red-team (Fase E gate):** prompt-injection, promise-elicitation, complaint-bypass —
  prove the validator holds before wider rollout.
- **Deferred (separate approval):** customer-facing AI Warming (Fase F/G) — out of Wave 4B.

---

## 11. 4B.0 file manifest (additive)

**New**
- `backend/src/services/replyAssistant/index.js` — orchestrator (`generateSuggestions`).
- `backend/src/services/replyAssistant/gate.js` — complaint/handover gate (4A intents first).
- `backend/src/services/replyAssistant/kbSlice.js` — intent → curated KB snippet.
- `backend/src/services/replyAssistant/validator.js` — invariants + `promiseScrubber`.
- `backend/src/services/replyAssistant/templates.js` — rule-based fallback suggestions.
- `backend/src/services/replyAssistant/quota.js` — daily cap + monthly budget checks.
- `backend/src/services/replyAssistant/providers/{LLMProvider,ClaudeProvider,GeminiProvider,index}.js`
- `backend/src/routes/replyAssistant.js` — the 3 endpoints (mounted under `/api/ai`).
- `backend/prisma/migrations/<ts>_reply_suggestion_log/` — additive table + enums.
- `backend/scripts/verify-wave4b.mjs` — verification (see §12).
- `backend/src/services/replyAssistant/replyAssistant.test.mjs` — pure regression tests.

**Modified (additive only)**
- `backend/src/config/aiModels.js` — `+ SANO_REPLY_ASSISTANT`.
- `backend/src/routes/ai.js` **or** `index.js` — mount the new router (no existing route changed).
- `backend/prisma/schema.prisma` — `+ model ReplySuggestionLog` + 2 enums (nothing else touched).

**Reused unchanged:** 4A `intelligence/*` (incl. `replyReadiness.js`), `providers/*`,
`handoverDetector.js`, `buildKbContext`, BYOK store.

## 12. Verification (`verify-wave4b.mjs`) — must all pass

- **Isolation:** grep `services/replyAssistant/**` imports no `wahaClient`/socket/SSE/send path.
- **Complaint blocked:** complaint text → `blocked` set, `suggestions: []`, no LLM call, row
  `status=BLOCKED`.
- **Handover blocked:** "minta ditelepon" → blocked.
- **Invariants:** every suggestion `requiresHumanReview === true`.
- **Promise scrubber:** a suggestion asserting a specific price/discount/delivery date is dropped.
- **Contract shape:** matches §6; `trace` + `quota` present.
- **Role scoping:** SALES requesting a conversation they don't own → 403.
- **Quota:** SALES capped at 30/day; ADMIN 100/day (simulated).
- **Budget kill switch:** `MAX_AI_COST_USD_MONTH` reached → `source: "template"`, no LLM call.
- **Determinism (template path):** rule-based fallback is deterministic.
- `node --check` all new files; pure `replyAssistant.test.mjs` green.

## 13. Frozen (unchanged, grep-verified before commit)

WAHA · SSE · Socket.IO · webhooks · inbox logic/stores/hooks · auth/session · existing
customer/order/analytics **contracts** · existing AI sandbox endpoints. Only DB change is the
**additive** `ReplySuggestionLog` (+2 enums). All suggestion logic deterministic outside the
single LLM generate call. UI copy Bahasa Indonesia.

## 14. Rollback

- `REPLY_ASSISTANT_ENABLED=false` → instant feature disable.
- Endpoints additive → revert the 4B.0 commit cleanly.
- Migration is additive (new table/enums) → reversible; no existing data touched.

---

## 15. Awaiting approval

This document is the checkpoint. **No code will be written until approved.** On approval I
implement **4B.0 only** per §11, run `verify-wave4b.mjs` (live run needs DB + one BYOK Claude
key), add the regression tests, and report before proposing 4B.1 (Inbox UI).
