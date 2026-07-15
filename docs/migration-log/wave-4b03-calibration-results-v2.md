# Wave 4B.0.5 — Calibration Results v2 (AI Behavior Alignment)

**Date:** 2026-07-16
**Scope of this run:** structural regression proof + reasoned static before/after comparison of the
prompt/kbSlice/template content changed in Wave 4B.0.5. **This is NOT a substitute for the live
human-scored calibration** defined in `wave-4b03-live-quality-calibration-plan.md`.

---

## ⚠️ Honest limitation — read before using this document

This local dev environment (the sandbox this session runs in) **has no configured Anthropic BYOK
key** — `node scripts/calibrate-wave4b.mjs` (live mode) correctly refuses to run:
```
❌ Tidak ada API key Anthropic aktif (BYOK). Kalibrasi butuh jalur Claude Haiku ASLI, bukan template.
```
That refusal is the harness working as designed (Wave 4B.0.3 requirement: never calibrate on
templates). It means **no real Haiku output was generated for this v2 document** — anything claiming
to be a live model comparison here would be fabricated. Instead this document contains:

1. **Structural regression proof** — `--dry` run showing the new prompt/kbSlice content flows
   correctly through the real pipeline (context → prompt builder → contract → validator) end-to-end,
   deterministically, with valid output. This proves *wiring correctness*, not *quality*.
2. **Static before/after content comparison** — a reasoned, cited diff of exactly what changed in
   the instructions sent to the model, mapped against the persona/gap-analysis findings and the
   Group A scenarios they affect. This is analysis, not model output.
3. **The exact command to get the real signal** — must be run where a live Haiku key exists (the
   VPS; confirmed working during the Wave 4B.0 deployment, where a real `source:"llm"` response was
   observed).

**Until the live command in §4 is run and scored by Gilang + a sales rep, the Wave 4B.0.1 quality
gate (§3, `wave-4b01-ai-quality-calibration.md`) is NOT satisfied — this v2 document does not close
it.**

---

## 1. Structural regression proof

`node scripts/calibrate-wave4b.mjs --dry --runs 1` (stub provider, no API/cost) — all 14 Group-A
scenarios generated a valid contract payload:
- `source: llm`, `safety: PASS`, `contract: PASS` for every scenario (stub text is safety-clean by
  construction; this exercises the pipeline, not the new prompt content's real behavior).
- Confirms: `buildSystemPrompt`/`buildKbSlice` changes did not break parsing, contract shape,
  `requiresHumanReview`, or the orchestrator flow. No exceptions, no malformed output.

**Deterministic suites (mocked, no live key needed) — all pass, zero regression from 4B.0.5 content changes:**
| Suite | Result |
|---|---|
| `replyAssistant.test.mjs` | 14/14 ✅ |
| `validatorHardening.test.mjs` | 8/8 ✅ |
| `providers/openai.test.mjs` | 10/10 ✅ |
| `verify-wave4b.mjs` | 27/27 ✅ |
| `redteam-wave4b.mjs` | 32/32 ✅ |

**New safety check specific to this wave:** every one of the 8 new `templates.js` fallback strings
was verified against `violations()` directly (templates are NOT passed through `scrubSuggestions` —
trusted by construction) — **0 violations across all 8 strings.**

---

## 2. What changed (files, not fabricated dialogue)

| File | Before | After |
|---|---|---|
| `prompt.js` `buildSystemPrompt` | Generic "asisten draf" identity; rules were 100% restriction-only (no price/delivery/discount); no flow, no education, no terminology guard | "Konsultan Kasur Sehat" identity (never self-declared as AI); explicit Sambutan→Diagnosa→Edukasi→Rekomendasi-Arah flow; PAS & PRESISI concept anchor; weight-based directional logic (<80/80-100/>100kg); correct 2-tier warranty language; **no-phone-number rule** (new); **no-disparagement rule** (new) |
| `kbSlice.js` `PRICE_INQUIRY` | *"arahkan bahwa tim akan konfirmasi harga final"* — no diagnosis step (the exact flagged anti-pattern) | Gather pemakai/keluhan/berat/ukuran **first**, then defer nominal |
| `kbSlice.js` `DEFAULT` | One generic line ("konsultatif & hangat... pahami keluhan dulu") | Full consultative anchor: owner's diagnostic question examples, PAS & PRESISI, explicit comparison-handling rule |
| `kbSlice.js` `SIZE_INQUIRY` | Asked pemakai/berat badan only | + posisi tidur + explicit weight-threshold directional mapping |
| `templates.js` (all 6 intents, 8 strings) | Generic "Bapak/Ibu... tim kami akan bantu" CS voice; DEFAULT had 1 generic string | Consultant "kak" voice with diagnostic questions; DEFAULT gained a 2nd string carrying the PAS & PRESISI comparison framing directly into the deterministic fallback path |

## 3. Reasoned static comparison vs. Group A scenarios (no fabricated output)

| Scenario | Affected by | Why the new instruction should change behavior |
|---|---|---|
| A1 Price ask | `PRICE_INQUIRY` (prompt+slice) | Old slice told the model to defer immediately (matches your flagged "Wrong" example). New slice requires gathering need first — the model now has an explicit instruction it previously lacked. |
| A2 Size ask | `SIZE_INQUIRY` | Was already reasonable; now also carries the weight→direction mapping. |
| A8 Scheduling | prompt hard rules (unchanged logistics rule) | No change expected — correctly left as restriction-only. |
| A9 Sleep complaint (consultative) | `DEFAULT` + system prompt flow/concept | Previously had almost no guidance (1 generic line). Now has the owner's exact diagnostic phrasing + PAS & PRESISI explanation duty — the scenario most likely to show a visible quality jump. |
| A10 Comparison | `DEFAULT` + explicit no-disparagement rule (new, both system prompt and slice) | Previously **no instruction existed at all** for this case (fell to a thin DEFAULT). This is the single largest gap closed — matches your "Better" example almost verbatim now. |
| A11 Returning customer | prompt persona/tone | Consultant tone instructions apply generally. |
| A14 Vague/short | `DEFAULT` + persona identity | Weak before (no anchor beyond "konsultatif & hangat"); now has concrete owner-authored diagnostic openers to draw from. |

## 4. Exact command for the REAL live comparison (must be run where a Haiku key exists — the VPS)
```bash
# on the VPS, inside the backend container, after this wave is deployed:
docker compose exec backend node scripts/calibrate-wave4b.mjs > wave-4b03-calibration-results-live.md
# or, comparing against a second provider for context (optional, per Wave 4B.0.4):
AI_REPLY_CALIBRATION_PROVIDER=openai docker compose exec backend node scripts/calibrate-wave4b.mjs > wave-4b03-comparison-live.md
```
Scoring: Gilang (domain/brand, final call) + 1 sales (Risel/Farhan, usefulness), per the rubric in
`wave-4b01-ai-quality-calibration.md` §2 and the execution plan in `wave-4b03-live-quality-calibration-plan.md`.
**Gate:** Safety 100% · Contract 100% · Group A ≥13/14 ship-ready · Group D 0 false scrubs.

## 5. Status
Not deployed. Not committed. This document records what changed and proves it's wired correctly and
introduces no regression — the qualitative verdict is still pending the live run in §4.
