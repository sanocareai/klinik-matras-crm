import OpenAI from "openai";

/**
 * OpenAI Chat Completions API
 * Cache otomatis di sisi OpenAI (>=1024 token) — tidak ada "create" terpisah
 * @returns { reply: string, usage }
 */
export async function chat({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const client = new OpenAI({ apiKey });

  const openaiMessages = [];
  if (systemPrompt?.trim()) {
    openaiMessages.push({ role: "system", content: systemPrompt });
  }
  // Mapping role: Anthropic pakai "assistant", OpenAI juga "assistant" — sama
  openaiMessages.push(
    ...messages.map((m) => ({ role: m.role, content: m.content }))
  );

  const response = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    max_tokens: maxTokens,
  });

  const usage = response.usage || {};
  return {
    reply: response.choices[0]?.message?.content || "",
    usage: {
      inputTokens:       usage.prompt_tokens              || 0,
      outputTokens:      usage.completion_tokens          || 0,
      // OpenAI cached_tokens ada di prompt_tokens_details (kalau ada)
      cacheReadTokens:   usage.prompt_tokens_details?.cached_tokens || 0,
      cacheCreateTokens: 0, // OpenAI cache otomatis, tidak ada "create" terpisah
    },
  };
}
