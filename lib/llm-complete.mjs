/**
 * Minimal chat completion for MCP summarize (Issue #1 Phase C6) and Hub proposal LLM jobs.
 * Order: OpenAI when OPENAI_API_KEY; else Anthropic when ANTHROPIC_API_KEY; else Ollama /api/chat.
 * Chat: OLLAMA_CHAT_MODEL / OPENAI_CHAT_MODEL / ANTHROPIC_CHAT_MODEL (see each branch).
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/**
 * @param {{ embedding?: { provider?: string, model?: string, ollama_url?: string }, llm?: { ollama_chat_model?: string, openai_chat_model?: string, anthropic_chat_model?: string } }} config - loadConfig() or mini hub config
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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const model =
      config.llm?.anthropic_chat_model ||
      process.env.ANTHROPIC_CHAT_MODEL ||
      'claude-3-5-haiku-20241022';
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Anthropic chat failed: ${res.status} ${t}`);
    }
    const data = await res.json();
    const blocks = data.content;
    const first = Array.isArray(blocks) && blocks[0] && blocks[0].text != null ? blocks[0].text : '';
    const text = String(first).trim();
    if (!text) throw new Error('Anthropic chat: empty response');
    return text;
  }

  const base = (config.embedding?.ollama_url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model =
    process.env.OLLAMA_CHAT_MODEL ||
    config.llm?.ollama_chat_model ||
    process.env.OLLAMA_MODEL ||
    'llama3.2';
  let ollamaRes;
  try {
    ollamaRes = await fetch(`${base}/api/chat`, {
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
  } catch (e) {
    // Connection-level failure (e.g. Node.js "fetch failed" when nothing listens at base).
    // On hosted/serverless this almost always means neither OPENAI_API_KEY nor
    // ANTHROPIC_API_KEY is configured and Ollama is not reachable at localhost.
    const detail = e?.message || String(e);
    throw new Error(
      `LLM provider not reachable (${base}): ${detail}. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in environment variables, or point OLLAMA_URL at a running Ollama instance.`,
    );
  }
  if (!ollamaRes.ok) {
    const t = await ollamaRes.text();
    throw new Error(`Ollama chat failed (${ollamaRes.status}): ${t}. Set OPENAI_API_KEY or OLLAMA_CHAT_MODEL to a chat-capable model.`);
  }
  const data = await ollamaRes.json();
  const text = data.message?.content;
  if (!text) throw new Error('Ollama chat: empty response');
  return String(text).trim();
}
