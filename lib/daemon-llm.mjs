/**
 * Daemon LLM wrapper — Phase E of the Daemon Consolidation Spec.
 *
 * Resolves daemon.llm configuration and routes to the correct provider/endpoint,
 * delegating to completeChat for the anthropic and ollama provider paths.
 *
 * Supported configurations via config.daemon.llm:
 *
 *   provider  | base_url set? | behaviour
 *   ----------|---------------|--------------------------------------------------
 *   null       | yes           | OpenAI-compat fetch to base_url (OpenRouter, vLLM, LM Studio…)
 *   "openai"   | yes/no        | OpenAI-compat fetch (base_url or api.openai.com)
 *   "anthropic"| ignored       | delegates to completeChat (uses ANTHROPIC_API_KEY); warns if base_url set
 *   "ollama"   | ignored       | delegates to completeChat (uses OLLAMA_URL/OLLAMA_CHAT_MODEL)
 *   null       | no            | delegates to completeChat (auto-detects from env)
 *
 * API key resolution for the OpenAI-compat path:
 *   - If daemon.llm.api_key_env is set → process.env[api_key_env]
 *   - Otherwise                        → process.env.OPENAI_API_KEY
 *
 * Config keys (all under config.daemon.llm):
 *   provider    — openai | anthropic | ollama | null
 *   base_url    — custom endpoint (env override: KNOWTATION_DAEMON_LLM_BASE_URL)
 *   api_key_env — name of the env var holding the API key (e.g. "OPENROUTER_API_KEY")
 *   model       — model name override
 *   max_tokens  — per-call token limit (default: 1024)
 */

import { completeChat } from './llm-complete.mjs';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the API key for the OpenAI-compat path.
 * When api_key_env is provided, reads from that named env var.
 * Otherwise falls back to OPENAI_API_KEY.
 *
 * @param {string|null} apiKeyEnv — env var name, e.g. "OPENROUTER_API_KEY"
 * @returns {string|null}
 */
export function resolveApiKey(apiKeyEnv) {
  if (apiKeyEnv && typeof apiKeyEnv === 'string') {
    return process.env[apiKeyEnv] ?? null;
  }
  return process.env.OPENAI_API_KEY ?? null;
}

/**
 * Build a merged config that overrides the model field used by completeChat
 * for the specified provider. Used when delegating to completeChat so that
 * daemon.llm.model is honoured.
 *
 * @param {object} config — loadConfig() result
 * @param {{ provider: string|null, model: string|null }} opts
 * @returns {object}
 */
export function buildDelegateConfig(config, { provider, model }) {
  if (!model) return config;
  const llmPatch = {};
  if (provider === 'anthropic') {
    llmPatch.anthropic_chat_model = model;
  } else if (provider === 'ollama') {
    llmPatch.ollama_chat_model = model;
  } else {
    llmPatch.openai_chat_model = model;
  }
  return { ...config, llm: { ...config.llm, ...llmPatch } };
}

/**
 * Make a fetch call to an OpenAI Chat Completions-compatible endpoint.
 *
 * @param {{
 *   baseUrl: string,
 *   apiKey: string,
 *   model: string,
 *   maxTokens: number,
 *   system: string,
 *   user: string,
 * }} params
 * @returns {Promise<string>}
 */
export async function callOpenAiCompat({ baseUrl, apiKey, model, maxTokens, system, user }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI-compat chat failed (${url}): ${res.status} ${body}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`OpenAI-compat chat: empty response from ${url}`);
  return String(text).trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * LLM completion function that respects daemon.llm configuration.
 *
 * Pass this as the `llmFn` option to consolidateMemory, runDiscoverPass, and
 * validateLlmConnectivity when you want daemon-specific LLM routing:
 *
 *   await consolidateMemory(config, { llmFn: daemonLlm });
 *
 * Falls back transparently to completeChat (env-based auto-detection) when no
 * daemon-specific LLM config is present.
 *
 * @param {object} config — loadConfig() result; daemon.llm is read from config.daemon.llm
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
export async function daemonLlm(config, opts) {
  const dlm = config.daemon?.llm ?? {};
  const provider = dlm.provider ?? null;
  const baseUrl = dlm.base_url ?? null;
  const apiKeyEnv = dlm.api_key_env ?? null;
  const model = dlm.model ?? null;
  const maxTokens = opts.maxTokens ?? dlm.max_tokens ?? 1024;

  // ── Anthropic: base_url is not applicable; warn and delegate ─────────────────
  if (provider === 'anthropic') {
    if (baseUrl) {
      process.stderr.write(
        '[daemon-llm] Warning: base_url is ignored when provider is "anthropic". ' +
          'Use provider: null or provider: "openai" for custom OpenAI-compatible endpoints.\n',
      );
    }
    return completeChat(buildDelegateConfig(config, { provider: 'anthropic', model }), {
      ...opts,
      maxTokens,
    });
  }

  // ── Ollama: delegate to completeChat (uses OLLAMA_URL / OLLAMA_CHAT_MODEL) ───
  if (provider === 'ollama') {
    return completeChat(buildDelegateConfig(config, { provider: 'ollama', model }), {
      ...opts,
      maxTokens,
    });
  }

  // ── OpenAI-compat: base_url set, or provider: "openai", or api_key_env set ───
  //
  // provider: null + base_url → OpenAI-compat endpoint (OpenRouter, vLLM, LM Studio…)
  // provider: "openai" + base_url → same
  // provider: "openai" (no base_url) → standard OpenAI URL with optional api_key_env
  // api_key_env set (no base_url) → standard OpenAI URL with custom key var
  if (baseUrl || provider === 'openai' || apiKeyEnv) {
    const effectiveBaseUrl = baseUrl ?? OPENAI_DEFAULT_BASE_URL;
    const apiKey = resolveApiKey(apiKeyEnv);
    if (!apiKey) {
      const envVarName = apiKeyEnv ?? 'OPENAI_API_KEY';
      throw new Error(
        `daemon-llm: API key not found. Set the "${envVarName}" environment variable.`,
      );
    }
    return callOpenAiCompat({
      baseUrl: effectiveBaseUrl,
      apiKey,
      model: model || 'gpt-4o-mini',
      maxTokens,
      system: opts.system,
      user: opts.user,
    });
  }

  // ── No daemon-specific config: fall through to completeChat (env auto-detect) ─
  return completeChat(buildDelegateConfig(config, { provider: null, model }), {
    ...opts,
    maxTokens,
  });
}
