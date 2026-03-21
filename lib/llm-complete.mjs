/**
 * Minimal chat completion for MCP summarize (Issue #1 Phase C6).
 * OpenAI when OPENAI_API_KEY is set; else Ollama /api/chat when OLLAMA_URL or default localhost.
 * Chat model: OLLAMA_CHAT_MODEL env, or config key llm?.ollama_model, else llama3.2 (embed-only models will fail — set OLLAMA_CHAT_MODEL).
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * @param {{ embedding?: { provider?: string, model?: string, ollama_url?: string }, llm?: { ollama_chat_model?: string, openai_chat_model?: string } }} config - loadConfig()
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
export async function completeChat(config, opts) {
  const maxTokens = opts.maxTokens ?? 512;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    const model = config.llm?.openai_chat_model || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI chat failed: ${res.status} ${t}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI chat: empty response');
    return String(text).trim();
  }

  const base = (config.embedding?.ollama_url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model =
    process.env.OLLAMA_CHAT_MODEL ||
    config.llm?.ollama_chat_model ||
    process.env.OLLAMA_MODEL ||
    'llama3.2';
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      stream: false,
      options: { num_predict: maxTokens },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama chat failed (${res.status}): ${t}. Set OPENAI_API_KEY or OLLAMA_CHAT_MODEL to a chat-capable model.`);
  }
  const data = await res.json();
  const text = data.message?.content;
  if (!text) throw new Error('Ollama chat: empty response');
  return String(text).trim();
}
