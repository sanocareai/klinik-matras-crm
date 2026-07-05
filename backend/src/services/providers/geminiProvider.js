import OpenAI from "openai";

// Google menyediakan endpoint OpenAI-compatible — reuse SDK tanpa install paket baru
const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

function normalizeUsage(usage = {}) {
  return {
    inputTokens:       usage.prompt_tokens     || 0,
    outputTokens:      usage.completion_tokens || 0,
    cacheReadTokens:   0,
    cacheCreateTokens: 0,
  };
}

/**
 * Gemini via OpenAI-compatible endpoint — tanpa tool use (AI Playground chatbot)
 * @returns { reply, usage }
 */
export async function chat({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const client = new OpenAI({ apiKey, baseURL: GOOGLE_BASE_URL });

  const openaiMessages = [];
  if (systemPrompt?.trim()) {
    openaiMessages.push({ role: "system", content: systemPrompt });
  }
  openaiMessages.push(...messages.map((m) => ({ role: m.role, content: m.content })));

  const response = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    max_tokens: maxTokens,
  });

  return {
    reply: response.choices[0]?.message?.content || "",
    usage: normalizeUsage(response.usage),
  };
}

/**
 * Gemini dengan function calling — untuk co-pilot KB tools
 * Google OpenAI-compatible endpoint mendukung function calling format OpenAI
 * @returns { reply, toolCalls: [{id, name, input}], assistantTurn, usage }
 */
export async function chatWithTools({ apiKey, model, systemPrompt, messages, tools, maxTokens = 1024 }) {
  const client = new OpenAI({ apiKey, baseURL: GOOGLE_BASE_URL });

  const openaiMessages = [];
  if (systemPrompt?.trim()) openaiMessages.push({ role: "system", content: systemPrompt });
  openaiMessages.push(
    ...messages.map((m) => {
      if (m.role === "tool") return m;
      if (m.role === "assistant" && m.tool_calls) return { role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls };
      return { role: m.role, content: m.content };
    })
  );

  const reqBody = { model, messages: openaiMessages, max_tokens: maxTokens };
  if (tools?.length) reqBody.tools = tools;

  const response = await client.chat.completions.create(reqBody);
  const msg = response.choices[0].message;

  return {
    reply:         msg.content || "",
    toolCalls:     msg.tool_calls?.map((tc) => ({ id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })) ?? [],
    assistantTurn: { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls },
    usage:         normalizeUsage(response.usage),
  };
}

// Tambah tool result ke messages array — format OpenAI (sama dengan Gemini)
export function appendToolResult(messages, call, resultStr) {
  return [...messages, { role: "tool", tool_call_id: call.id, content: resultStr }];
}
