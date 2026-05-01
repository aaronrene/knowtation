/**
 * Minimal chat completion for MCP summarize (Issue #1 Phase C6) and Hub proposal LLM jobs.
 *
 * Provider selection (in order):
 *   1. KNOWTATION_CHAT_PROVIDER=deepinfra  → DeepInfra (OpenAI-compatible). Falls back to OpenAI then
 *                                            Anthropic if DeepInfra returns an error and those keys are set.
 *   2. KNOWTATION_CHAT_PROVIDER=openai     → OpenAI only (no fallback). Requires OPENAI_API_KEY.
 *   3. KNOWTATION_CHAT_PROVIDER=anthropic  → Anthropic only (no fallback). Requires ANTHROPIC_API_KEY.
 *   4. Implicit DeepInfra: DEEPINFRA_API_KEY set AND neither OPENAI_API_KEY nor ANTHROPIC_API_KEY set.
 *      (Backward compatible — does NOT preempt an existing OpenAI/Anthropic deployment.)
 *   5. KNOWTATION_CHAT_PREFER_ANTHROPIC=1 (or true): try Anthropic before OpenAI when both keys exist;
 *      OpenAI is used as fallback if Claude fails.
 *   6. Default: OpenAI when OPENAI_API_KEY; else Anthropic when ANTHROPIC_API_KEY; else Ollama /api/chat.
 *
 * Models: OPENAI_CHAT_MODEL (gpt-4o-mini), ANTHROPIC_CHAT_MODEL (claude-3-5-haiku-20241022),
 * DEEPINFRA_CHAT_MODEL (Qwen/Qwen2.5-72B-Instruct), OLLAMA_CHAT_MODEL (llama3.2).
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEEPINFRA_CHAT_URL = 'https://api.deepinfra.com/v1/openai/chat/completions';

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

function chatProvider() {
  return String(process.env.KNOWTATION_CHAT_PROVIDER || '').trim().toLowerCase();
}

/**
 * @param {{ llm?: { deepinfra_chat_model?: string } }} config
 * @param {{ system: string, user: string }} opts
 * @param {number} maxTokens
 */
async function deepinfraChat(config, opts, maxTokens) {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) throw new Error('DeepInfra chat: DEEPINFRA_API_KEY is not set');
  const model =
    config.llm?.deepinfra_chat_model ||
    process.env.DEEPINFRA_CHAT_MODEL ||
    'Qwen/Qwen2.5-72B-Instruct';
  const res = await fetch(DEEPINFRA_CHAT_URL, {
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
    throw new Error(`DeepInfra chat failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('DeepInfra chat: empty response');
  return String(text).trim();
}

/**
 * @param {{ embedding?: { provider?: string, model?: string, ollama_url?: string }, llm?: { ollama_chat_model?: string, openai_chat_model?: string, anthropic_chat_model?: string, deepinfra_chat_model?: string } }} config - loadConfig() or mini hub config
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
export async function completeChat(config, opts) {
  const maxTokens = opts.maxTokens ?? 512;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const deepinfraKey = process.env.DEEPINFRA_API_KEY;
  const hasOpenai = Boolean(openaiKey && String(openaiKey).trim());
  const hasAnthropic = Boolean(anthropicKey && String(anthropicKey).trim());
  const hasDeepinfra = Boolean(deepinfraKey && String(deepinfraKey).trim());
  const provider = chatProvider();

  // 1. Explicit DeepInfra: try DeepInfra first; fall back to OpenAI then Anthropic if available.
  if (provider === 'deepinfra') {
    if (!hasDeepinfra) {
      throw new Error(
        'KNOWTATION_CHAT_PROVIDER=deepinfra but DEEPINFRA_API_KEY is not set. ' +
          'Set DEEPINFRA_API_KEY in your environment (Netlify deploy env for hosted Hub) or remove KNOWTATION_CHAT_PROVIDER.',
      );
    }
    try {
      return await deepinfraChat(config, opts, maxTokens);
    } catch (e1) {
      if (hasOpenai) {
        try {
          return await openaiChat(config, opts, maxTokens);
        } catch (e2) {
          if (hasAnthropic) {
            try {
              return await anthropicChat(config, opts, maxTokens);
            } catch (e3) {
              const d = e1 instanceof Error ? e1.message : String(e1);
              const o = e2 instanceof Error ? e2.message : String(e2);
              const a = e3 instanceof Error ? e3.message : String(e3);
              throw new Error(
                `DeepInfra chat failed (${d}); OpenAI fallback failed (${o}); Anthropic fallback failed (${a})`,
              );
            }
          }
          const d = e1 instanceof Error ? e1.message : String(e1);
          const o = e2 instanceof Error ? e2.message : String(e2);
          throw new Error(`DeepInfra chat failed (${d}); OpenAI fallback failed (${o})`);
        }
      }
      if (hasAnthropic) {
        try {
          return await anthropicChat(config, opts, maxTokens);
        } catch (e2) {
          const d = e1 instanceof Error ? e1.message : String(e1);
          const a = e2 instanceof Error ? e2.message : String(e2);
          throw new Error(`DeepInfra chat failed (${d}); Anthropic fallback failed (${a})`);
        }
      }
      throw e1;
    }
  }

  // 2. Explicit OpenAI / Anthropic: bypass the provider-priority dance and require the matching key.
  if (provider === 'openai') {
    if (!hasOpenai) {
      throw new Error(
        'KNOWTATION_CHAT_PROVIDER=openai but OPENAI_API_KEY is not set. ' +
          'Set OPENAI_API_KEY or remove KNOWTATION_CHAT_PROVIDER.',
      );
    }
    return openaiChat(config, opts, maxTokens);
  }
  if (provider === 'anthropic') {
    if (!hasAnthropic) {
      throw new Error(
        'KNOWTATION_CHAT_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. ' +
          'Set ANTHROPIC_API_KEY or remove KNOWTATION_CHAT_PROVIDER.',
      );
    }
    return anthropicChat(config, opts, maxTokens);
  }

  // 3. Implicit DeepInfra: only the DeepInfra key is set (no OpenAI / no Anthropic).
  // Backward compatible — never preempts an existing OpenAI/Anthropic deployment.
  if (hasDeepinfra && !hasOpenai && !hasAnthropic) {
    return deepinfraChat(config, opts, maxTokens);
  }

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
