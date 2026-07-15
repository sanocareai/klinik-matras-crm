# Wave 4B.0.4 — Multi-LLM Provider Preparation (Checkpoint)

**Status:** IMPLEMENTED. Additive, inert-by-default. **Production behavior identical**
(default provider = Claude Haiku). No schema/WAHA/SSE/inbox/frontend/contract change.
**Goal:** *"One AI assistant architecture, multiple interchangeable models."*

---

## Decisions (locked)
1. **No `ReplySuggestionLog` migration.** `provider` is **derived from the `model` string** via
   `providerFromModel(model)` — reporting/calibration only, not persisted.
2. **Env hierarchy.** `AI_REPLY_PROVIDER` selects provider (`claude` default | `openai` | `gemini`);
   `OPENAI_REPLY_MODEL` overrides the OpenAI model default; `aiModels.js` config stays source of truth.
3. **OpenAI without key** → provider unavailable → existing **template fallback**, never a 500.
4. **Isolation:** production (`AI_REPLY_PROVIDER`) and calibration (`AI_REPLY_CALIBRATION_PROVIDER`)
   are separate; calibration never affects the production path. **No automatic routing.**

## Architecture
```
LLMProvider (interface)
 ├── ClaudeProvider   (anthropic — default/active)
 ├── OpenAIProvider   (openai — new; wraps existing services/providers/openaiProvider.js SDK)
 └── GeminiProvider   (inert stub → template fallback)
providers/index.js: getActiveProvider() → buildProvider(AI_REPLY_PROVIDER) ; providerFromModel()
```
The **orchestrator is unchanged** — it only calls `deps.getProvider()`; it never knows which
provider is active. Gate (complaint/handover) runs **before** generation; validator +
`assertPayload` + `requiresHumanReview=true` run **after**, for every provider unconditionally.

## Env vars (all optional; unset = today's behavior)
| Var | Default | Effect |
|---|---|---|
| `AI_REPLY_PROVIDER` | `claude` | production provider select |
| `OPENAI_API_KEY` | — | OpenAI credential (env, not BYOK store); absent → template |
| `OPENAI_REPLY_MODEL` | `gpt-4.1-mini` | override OpenAI model, no code change |
| `AI_REPLY_CALIBRATION_PROVIDER` | — | harness comparison mode (isolated from prod) |

## Cost tracking (no schema change)
`cost.js` PRICING gains `gpt-4.1-mini`; `estimateCostUsd` is model-keyed (unknown model → 0, safe).
Audit `model` records the generating model; provider derivable via `providerFromModel`.

## Files
**New:** `providers/OpenAIProvider.js`, `providers/openai.test.mjs`, this doc.
**Modified (additive):** `providers/index.js` (dispatch + `providerFromModel`/`buildProvider`),
`providers/keyStore.js` (+`getOpenAIKey`), `config.js` (+provider select/resolve), `config/aiModels.js`
(+2 config objects), `cost.js` (+gpt pricing), `scripts/calibrate-wave4b.mjs` (comparison mode).
**Untouched:** orchestrator `index.js`, gate/templates/kbSlice/prompt/contract, route, `schema.prisma`,
WAHA/SSE/inbox/frontend.

## Rollback
- **Instant:** unset `AI_REPLY_PROVIDER` (or `=claude`) — wave is inert.
- **Partial:** `OPENAI_API_KEY` unset / `AI_REPLY_PROVIDER=claude` — env change + restart, no redeploy.
- **Full:** `git revert` the commit — additive except the small `providers/index.js` dispatch, reverts clean.
- **No migration to undo.**

## Calibration comparison
`AI_REPLY_CALIBRATION_PROVIDER=openai node scripts/calibrate-wave4b.mjs` → runs A1–A14 through prod
(Claude) **and** OpenAI side-by-side (safety/contract auto; relevance/consultative/tone/actionability/
commercial-impact for human scoring). Read-only, no DB writes.
