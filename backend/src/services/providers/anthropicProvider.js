// Anthropic Messages API — dengan Prompt Caching (ephemeral)
// Mendukung tool use untuk co-pilot KB management

const BASE_URL = "https://api.anthropic.com/v1/messages";

const HEADERS_BASE = {
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "prompt-caching-2024-07-31",
};

// System prompt (KB + instruksi) dibungkus array agar di-cache Anthropic 5 menit
function buildSystemPayload(systemPrompt) {
  if (!systemPrompt?.trim()) return undefined;
  return [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
}

function normalizeUsage(usage) {
  return {
    inputTokens:       usage?.input_tokens                  || 0,
    outputTokens:      usage?.output_tokens                 || 0,
    cacheReadTokens:   usage?.cache_read_input_tokens       || 0,
    cacheCreateTokens: usage?.cache_creation_input_tokens   || 0,
  };
}

// Timeout eksplisit (28 Agustus 2026, ditemukan lewat verifikasi live) — fetch()
// polos TIDAK PERNAH timeout sendiri kalau koneksi macet/menggantung tanpa
// respons maupun error. Ditemukan Quality Scorer job (loop SEKUENSIAL per
// percakapan) macet TOTAL 40+ menit tanpa 1 baris log/error pun — satu request
// menggantung selamanya mengunci seluruh sisa batch, TIDAK ADA visibilitas
// sama sekali. 60 detik dipilih generous utk Haiku (respons normal <10 detik
// bahkan utk skema besar), tapi cukup ketat supaya 1 percakapan macet tidak
// menyandera puluhan lainnya di belakangnya.
const REQUEST_TIMEOUT_MS = 60_000;

async function postWithTimeout(reqBody, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: { ...HEADERS_BASE, "x-api-key": apiKey },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Anthropic API timeout setelah ${REQUEST_TIMEOUT_MS / 1000} detik — tidak ada respons.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Panggil Anthropic — tanpa tool use (AI Playground chatbot)
 * @returns { reply: string, usage }
 */
export async function chat({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const reqBody = { model, max_tokens: maxTokens, messages };
  const sys = buildSystemPayload(systemPrompt);
  if (sys) reqBody.system = sys;

  const response = await postWithTimeout(reqBody, apiKey);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Anthropic API error");

  return {
    reply: data.content?.find((c) => c.type === "text")?.text || "",
    usage: normalizeUsage(data.usage),
  };
}

/**
 * Panggil Anthropic dengan tool use — untuk co-pilot KB admin tools
 * @returns { reply, toolCalls: [{id, name, input}], assistantTurn, usage }
 */
export async function chatWithTools({ apiKey, model, systemPrompt, messages, tools, toolChoice, maxTokens = 1024 }) {
  const reqBody = { model, max_tokens: maxTokens, messages };
  const sys = buildSystemPayload(systemPrompt);
  if (sys) reqBody.system = sys;
  if (tools?.length) reqBody.tools = tools;
  // toolChoice ({type:"tool", name}) — MEMAKSA satu tool tertentu dipanggil,
  // dipakai qualityScorer/grading.js supaya output selalu structured (native
  // JSON mode Anthropic), bukan cuma "boleh pakai tool kalau perlu" (default).
  if (toolChoice) reqBody.tool_choice = toolChoice;

  const response = await postWithTimeout(reqBody, apiKey);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Anthropic API error");

  return {
    reply:         data.content?.find((c) => c.type === "text")?.text || "",
    toolCalls:     data.content?.filter((c) => c.type === "tool_use").map((c) => ({ id: c.id, name: c.name, input: c.input })) ?? [],
    assistantTurn: { role: "assistant", content: data.content },
    usage:         normalizeUsage(data.usage),
  };
}

// Tambah tool result ke messages array — format Anthropic
export function appendToolResult(messages, call, resultStr) {
  return [...messages, { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: resultStr }] }];
}
