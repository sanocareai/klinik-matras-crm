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

/**
 * Panggil Anthropic — tanpa tool use (AI Playground chatbot)
 * @returns { reply: string, usage }
 */
export async function chat({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const reqBody = { model, max_tokens: maxTokens, messages };
  const sys = buildSystemPayload(systemPrompt);
  if (sys) reqBody.system = sys;

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { ...HEADERS_BASE, "x-api-key": apiKey },
    body: JSON.stringify(reqBody),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Anthropic API error");

  return {
    reply: data.content?.find((c) => c.type === "text")?.text || "",
    usage: normalizeUsage(data.usage),
  };
}

/**
 * Panggil Anthropic dengan tool use — untuk co-pilot KB admin tools
 * Kembalikan raw response agar caller bisa handle multi-turn tool loop
 * @returns { reply?, toolBlock?, rawContent, stopReason, usage }
 */
export async function chatWithTools({ apiKey, model, systemPrompt, messages, tools, maxTokens = 1024 }) {
  const reqBody = { model, max_tokens: maxTokens, messages };
  const sys = buildSystemPayload(systemPrompt);
  if (sys) reqBody.system = sys;
  if (tools?.length) reqBody.tools = tools;

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { ...HEADERS_BASE, "x-api-key": apiKey },
    body: JSON.stringify(reqBody),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Anthropic API error");

  const toolBlock = data.stop_reason === "tool_use"
    ? data.content?.find((c) => c.type === "tool_use")
    : null;

  return {
    reply:      data.content?.find((c) => c.type === "text")?.text || "",
    toolBlock,
    rawContent: data.content,
    stopReason: data.stop_reason,
    usage:      normalizeUsage(data.usage),
  };
}
