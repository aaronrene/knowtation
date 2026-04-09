/**
 * Minimal chat completion for MCP summarize (Issue #1 Phase C6) and Hub proposal LLM jobs.
 * Default order: OpenAI when OPENAI_API_KEY; else Anthropic when ANTHROPIC_API_KEY; else Ollama /api/chat.
 * Opt-in: KNOWTATION_CHAT_PREFER_ANTHROPIC=1 (or true) tries Anthropic before OpenAI when both keys exist;
 * OpenAI is used as fallback if Claude fails.
 * Chat: OLLAMA_CHAT_MODEL / OPENAI_CHAT_MODEL / ANTHROPIC_CHAT_MODEL (see each branch).
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/**
 * @param {{ llm?: { openai_chat_model?: string } }} config
 * @param {{ system: string, user: string }} opts
 * @param {number} maxTokens
 */
async function openaiChat(config, opts, maxTokens) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI chat: OPENAI_API_KEY is not set');
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

/**
 * @param {{ llm?: { anthropic_chat_model?: string } }} config
 * @param {{ system: string, user: string }} opts
 * @param {number} maxTokens
 */
async function anthropicChat(config, opts, maxTokens) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error('Anthropic chat: ANTHROPIC_API_KEY is not set');
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

function chatPreferAnthropic() {
  const v = process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

/**
 * @param {{ embedding?: { provider?: string, model?: string, ollama_url?: string }, llm?: { ollama_chat_model?: string, openai_chat_model?: string, anthropic_chat_model?: string } }} config - loadConfig() or mini hub config
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
export async function completeChat(config, opts) {
  const maxTokens = opts.maxTokens ?? 512;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const hasOpenai = Boolean(openaiKey && String(openaiKey).trim());
  const hasAnthropic = Boolean(anthropicKey && String(anthropicKey).trim());

  if (chatPreferAnthropic() && hasAnthropic && hasOpenai) {
    try {
      return await anthropicChat(config, opts, maxTokens);
    } catch (e1) {
      try {
        return await openaiChat(config, opts, maxTokens);
      } catch (e2) {
        const a = e1 instanceof Error ? e1.message : String(e1);
        const o = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(`Anthropic chat failed (${a}); OpenAI fallback failed (${o})`);
      }
    }
  }

  if (chatPreferAnthropic() && hasAnthropic && !hasOpenai) {
    return anthropicChat(config, opts, maxTokens);
  }

  if (hasOpenai) {
    return openaiChat(config, opts, maxTokens);
  }
  if (hasAnthropic) {
    return anthropicChat(config, opts, maxTokens);
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
