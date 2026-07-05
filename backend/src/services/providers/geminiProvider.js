import OpenAI from "openai";

// Google menyediakan endpoint OpenAI-compatible — reuse SDK tanpa install paket baru
export async function chat({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

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

  const usage = response.usage || {};
  return {
    reply: response.choices[0]?.message?.content || "",
    usage: {
      inputTokens:       usage.prompt_tokens     || 0,
      outputTokens:      usage.completion_tokens || 0,
      cacheReadTokens:   0,
      cacheCreateTokens: 0,
    },
  };
}
