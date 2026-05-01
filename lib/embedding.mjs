/**
 * Embedding provider abstraction. Ollama, OpenAI, Voyage AI, or DeepInfra from config.
 * SPEC §4.4: embedding.provider, embedding.model; env for API keys.
 *
 * DeepInfra (OpenAI-compatible): same single DEEPINFRA_API_KEY can drive chat
 * (lib/llm-complete.mjs) and embeddings here. Default model BAAI/bge-large-en-v1.5
 * (1024 dim). Switching dimension requires a vault re-index.
 */

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const DEEPINFRA_EMBED_URL = 'https://api.deepinfra.com/v1/openai/embeddings';

/**
 * Turn Undici/Node `fetch` failures (often message-only "fetch failed") into an actionable Hub/API error.
 * @param {'ollama'|'openai'|'voyage'|'deepinfra'} provider
 * @param {string} endpointDescription - Ollama base URL or short label for OpenAI
 * @param {string} model
 * @param {unknown} err
 * @returns {string}
 */
export function formatEmbeddingFetchFailure(provider, endpointDescription, model, err) {
  const raw = err && typeof err === 'object' && 'message' in err && err.message != null ? String(err.message) : String(err);
  const bits = [raw];
  if (err && typeof err === 'object' && 'cause' in err && err.cause != null) {
    const c = err.cause;
    if (c && typeof c === 'object' && 'message' in c && c.message != null) bits.push(String(c.message));
    if (c && typeof c === 'object' && 'code' in c && c.code != null) bits.push(`code=${String(c.code)}`);
  }
  const detail = bits.filter(Boolean).join(' — ');
  const m = String(model || '').trim() || 'nomic-embed-text';
  if (provider === 'ollama') {
    return (
      `Ollama embeddings unreachable at ${endpointDescription} (${detail}). ` +
      `For Meaning search, start Ollama (\`ollama serve\`), run \`ollama pull ${m}\`, and confirm the URL in config/env ` +
      `(\`OLLAMA_URL\` / \`embedding.ollama_url\`). If \`localhost\` fails, try \`http://127.0.0.1:11434\` (IPv6 vs IPv4). ` +
      `Alternatively set \`EMBEDDING_PROVIDER=openai\` and \`OPENAI_API_KEY\`, or \`EMBEDDING_PROVIDER=voyage\` and \`VOYAGE_API_KEY\`.`
    );
  }
  if (provider === 'voyage') {
    return (
      `Voyage embeddings unreachable (${detail}). ` +
      `Set \`VOYAGE_API_KEY\`, confirm \`embedding.provider: voyage\` / \`EMBEDDING_PROVIDER=voyage\`, and model (e.g. voyage-4-lite). ` +
      `See https://docs.voyageai.com/docs/embeddings. After switching provider or dimension, re-index the vault.`
    );
  }
  if (provider === 'deepinfra') {
    return (
      `DeepInfra embeddings unreachable (${detail}). ` +
      `Set \`DEEPINFRA_API_KEY\`, confirm \`embedding.provider: deepinfra\` / \`EMBEDDING_PROVIDER=deepinfra\`, and model ` +
      `(e.g. ${JSON.stringify(m)}). See https://deepinfra.com/docs/embeddings. After switching provider or dimension, re-index the vault.`
    );
  }
  return (
    `OpenAI embeddings request failed (${detail}). ` +
    `Check \`OPENAI_API_KEY\`, network access to api.openai.com, and model ${JSON.stringify(m)}.`
  );
}

/**
 * Rough embedding input-token estimate (~4 chars per token) for providers that do not return usage (e.g. Ollama).
 * @param {string[]} texts
 * @returns {number}
 */
export function estimateEmbeddingInputTokens(texts) {
  let n = 0;
  for (const t of texts) {
    const s = typeof t === 'string' ? t : '';
    n += Math.ceil(s.length / 4);
  }
  return n;
}

/**
 * Normalize and validate Ollama API base URL so fetch() never receives a relative or malformed URL
 * (Undici throws TypeError "Invalid URL" with no context).
 * @param {string|null|undefined} urlInput - From config or env; null/empty uses default localhost.
 * @returns {string} Base URL without trailing slash
 */
export function normalizeOllamaEmbedBaseUrl(urlInput) {
  const raw = urlInput == null || urlInput === '' ? OLLAMA_DEFAULT_URL : String(urlInput);
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(
      'Ollama embed base URL is empty after trim. Set OLLAMA_URL to an absolute http(s) URL ' +
        '(e.g. https://your-ollama-host:11434). On Netlify/serverless use EMBEDDING_PROVIDER=openai and OPENAI_API_KEY.'
    );
  }
  // Node's URL() accepts "host:port" as a non-http "protocol" — reject missing scheme explicitly.
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `Ollama base URL must be an absolute http(s) URL starting with http:// or https://; got ${JSON.stringify(raw)}. ` +
        'Examples: http://localhost:11434 (local Hub only), https://ollama.example.com:11434'
    );
  }
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error(
      `Ollama base URL is not a valid URL; got ${JSON.stringify(raw)}. ` +
        'Examples: http://localhost:11434, https://ollama.example.com:11434'
    );
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Ollama base URL must use http or https; got protocol ${u.protocol} for ${u.href}`);
  }
  return u.toString().replace(/\/$/, '');
}

/**
 * @typedef {{ voyageInputType?: 'query'|'document' }} EmbedOptions
 * Voyage retrieval: pass `voyageInputType: 'query'` for search queries and `'document'` for index chunks (recommended).
 */

/**
 * Embed one or many texts. Returns array of vectors (same order as input).
 * @param {string[]} texts
 * @param {{ provider: string, model: string, ollama_url?: string }} config - From loadConfig().embedding
 * @param {EmbedOptions} [options]
 * @returns {Promise<number[][]>}
 */
export async function embed(texts, config, options = {}) {
  const { vectors } = await embedWithUsage(texts, config, options);
  return vectors;
}

/**
 * Same as {@link embed} but returns **embedding_input_tokens** for billing (OpenAI: API `usage.prompt_tokens`; Ollama: estimate).
 * @param {string[]} texts
 * @param {{ provider: string, model: string, ollama_url?: string }} config
 * @param {EmbedOptions} [options]
 * @returns {Promise<{ vectors: number[][], embedding_input_tokens: number }>}
 */
export async function embedWithUsage(texts, config, options = {}) {
  if (!texts.length) return { vectors: [], embedding_input_tokens: 0 };
  const provider = String(config?.provider || 'ollama').trim().toLowerCase();
  let model =
    config?.model != null && String(config.model).trim() !== '' ? String(config.model).trim() : null;
  if (model == null) {
    if (provider === 'openai') model = 'text-embedding-3-small';
    else if (provider === 'voyage') model = 'voyage-4-lite';
    else if (provider === 'deepinfra') model = 'BAAI/bge-large-en-v1.5';
    else model = 'nomic-embed-text';
  }

  if (provider === 'ollama') {
    return embedOllamaWithUsage(texts, { model, url: config?.ollama_url || OLLAMA_DEFAULT_URL });
  }
  if (provider === 'openai') {
    return embedOpenAIWithUsage(texts, { model, apiKey: process.env.OPENAI_API_KEY });
  }
  if (provider === 'voyage') {
    const inputType = options?.voyageInputType === 'query' || options?.voyageInputType === 'document' ? options.voyageInputType : undefined;
    return embedVoyageWithUsage(texts, { model, apiKey: process.env.VOYAGE_API_KEY, inputType });
  }
  if (provider === 'deepinfra') {
    return embedDeepInfraWithUsage(texts, { model, apiKey: process.env.DEEPINFRA_API_KEY });
  }
  throw new Error(`Unknown embedding provider: ${provider}. Supported: ollama, openai, voyage, deepinfra.`);
}

/**
 * Default backoff before retrying a single 429. Exported so tests can keep wall time low
 * by wrapping `embedDeepInfraWithUsage` with a smaller `sleepFn`. The bridge index path
 * runs on Netlify Functions where every retry costs against the 60s sync cap, so we keep
 * the retry budget intentionally small (one retry; second 429 surfaces as an error).
 */
export const DEEPINFRA_429_BACKOFF_DEFAULT_MS = 1000;
export const DEEPINFRA_429_BACKOFF_MAX_MS = 5000;

/**
 * Parse a fetch-Response `Retry-After` header. Spec allows seconds (integer) or HTTP-date.
 * We support seconds and fall back to the default if absent or unparseable.
 *
 * @param {string|null|undefined} headerValue
 * @param {number} defaultMs
 * @returns {number} milliseconds to wait before retrying
 */
export function retryAfterHeaderMs(headerValue, defaultMs = DEEPINFRA_429_BACKOFF_DEFAULT_MS) {
  if (headerValue == null || headerValue === '') return defaultMs;
  const trimmed = String(headerValue).trim();
  // Pure integer (seconds) is the dominant case from DeepInfra/OpenAI.
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    if (!Number.isFinite(sec) || sec < 0) return defaultMs;
    const ms = sec * 1000;
    return Math.min(Math.max(ms, defaultMs), DEEPINFRA_429_BACKOFF_MAX_MS);
  }
  // HTTP-date fallback. Cap to MAX so a "1 hour" header does not strand a function.
  const t = Date.parse(trimmed);
  if (!Number.isFinite(t)) return defaultMs;
  const ms = t - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return defaultMs;
  return Math.min(Math.max(ms, defaultMs), DEEPINFRA_429_BACKOFF_MAX_MS);
}

/**
 * @param {string[]} texts
 * @param {{ model: string, url: string }}
 * @returns {Promise<number[][]>}
 */
async function embedOllamaWithUsage(texts, { model, url }) {
  const base = normalizeOllamaEmbedBaseUrl(url);
  const apiKey = process.env.OLLAMA_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  const out = [];
  let embedding_input_tokens = 0;
  // Ollama /api/embed accepts one prompt; for batch we call per text (or check if array is supported)
  for (const text of texts) {
    embedding_input_tokens += estimateEmbeddingInputTokens([text]);
    let res;
    try {
      res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: text }),
      });
    } catch (e) {
      throw new Error(formatEmbeddingFetchFailure('ollama', base, model, e));
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embed failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    if (data.embeddings && data.embeddings[0]) {
      out.push(data.embeddings[0]);
    } else if (Array.isArray(data.embedding)) {
      out.push(data.embedding);
    } else {
      throw new Error('Ollama embed response missing embeddings');
    }
  }
  return { vectors: out, embedding_input_tokens };
}

/**
 * @param {string[]} texts
 * @param {{ model: string, apiKey?: string }}
 * @returns {Promise<number[][]>}
 */
async function embedOpenAIWithUsage(texts, { model, apiKey }) {
  if (!apiKey) {
    throw new Error('OpenAI embeddings require OPENAI_API_KEY environment variable.');
  }
  let res;
  try {
    res = await fetch(OPENAI_EMBED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (e) {
    throw new Error(formatEmbeddingFetchFailure('openai', OPENAI_EMBED_URL, model, e));
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embed failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  const byIndex = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = byIndex.map((d) => d.embedding);
  let embedding_input_tokens = 0;
  if (data.usage && typeof data.usage.prompt_tokens === 'number') {
    embedding_input_tokens = data.usage.prompt_tokens;
  } else {
    embedding_input_tokens = estimateEmbeddingInputTokens(texts);
  }
  return { vectors, embedding_input_tokens };
}

/**
 * @param {string[]} texts
 * @param {{ model: string, apiKey?: string, inputType?: 'query'|'document' }} opts
 */
async function embedVoyageWithUsage(texts, { model, apiKey, inputType }) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('Voyage embeddings require VOYAGE_API_KEY environment variable.');
  }
  const body = {
    model,
    input: texts.length === 1 ? texts[0] : texts,
    ...(inputType ? { input_type: inputType } : {}),
  };
  let res;
  try {
    res = await fetch(VOYAGE_EMBED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(formatEmbeddingFetchFailure('voyage', VOYAGE_EMBED_URL, model, e));
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage embed failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  const byIndex = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = byIndex.map((d) => d.embedding);
  let embedding_input_tokens = 0;
  if (data.usage && typeof data.usage.total_tokens === 'number') {
    embedding_input_tokens = data.usage.total_tokens;
  } else {
    embedding_input_tokens = estimateEmbeddingInputTokens(texts);
  }
  return { vectors, embedding_input_tokens };
}

/**
 * @param {string[]} texts
 * @param {{
 *   model: string,
 *   apiKey?: string,
 *   fetchImpl?: typeof fetch,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   maxRetries?: number,
 * }} opts
 * DeepInfra OpenAI-compatible embeddings: same wire format as OpenAI, different host + key.
 *
 * 429 handling: bridge index runs concurrent embed calls (`lib/parallel-embed-pool.mjs`).
 * If we accidentally exceed DeepInfra's per-second limit, we want a short backoff + one
 * retry (driven by the `Retry-After` header when present) so a transient burst does not
 * fail an entire vault re-index. A second 429 surfaces as an error and gets reported to
 * the user; we deliberately do not retry indefinitely because Netlify's 60s sync-function
 * cap leaves no room for exponential-backoff multi-minute waits.
 */
export async function embedDeepInfraWithUsage(
  texts,
  { model, apiKey, fetchImpl, sleepFn, maxRetries } = {},
) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('DeepInfra embeddings require DEEPINFRA_API_KEY environment variable.');
  }
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  const doSleep =
    typeof sleepFn === 'function' ? sleepFn : (ms) => new Promise((r) => setTimeout(r, ms));
  const retryBudget = Number.isFinite(maxRetries) && maxRetries >= 0 ? Math.floor(maxRetries) : 1;

  let attempt = 0;
  // Loop bounded by retryBudget; each non-429 outcome (success or other error) returns/throws.
  while (true) {
    let res;
    try {
      res = await doFetch(DEEPINFRA_EMBED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });
    } catch (e) {
      throw new Error(formatEmbeddingFetchFailure('deepinfra', DEEPINFRA_EMBED_URL, model, e));
    }
    if (res.status === 429 && attempt < retryBudget) {
      const headerValue =
        typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null;
      const waitMs = retryAfterHeaderMs(headerValue);
      // Drain body to free the connection so the retry can reuse the keepalive socket.
      try {
        await res.text();
      } catch (_) {}
      await doSleep(waitMs);
      attempt++;
      continue;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DeepInfra embed failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    const byIndex = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = byIndex.map((d) => d.embedding);
    let embedding_input_tokens = 0;
    if (data.usage && typeof data.usage.prompt_tokens === 'number') {
      embedding_input_tokens = data.usage.prompt_tokens;
    } else if (data.usage && typeof data.usage.total_tokens === 'number') {
      embedding_input_tokens = data.usage.total_tokens;
    } else {
      embedding_input_tokens = estimateEmbeddingInputTokens(texts);
    }
    return { vectors, embedding_input_tokens };
  }
}

/**
 * Dimension for the configured model (for creating collection). Ollama nomic-embed-text is 768.
 * @param {{ provider?: string, model?: string }} config
 * @returns {number}
 */
export function embeddingDimension(config) {
  const provider = String(config?.provider || 'ollama').trim().toLowerCase();
  if (provider === 'openai') {
    // text-embedding-3-small 1536, text-embedding-3-large 3072, ada 1536
    const m = String(config?.model || '').trim().toLowerCase();
    if (m.includes('large')) return 3072;
    return 1536;
  }
  if (provider === 'voyage') {
    const m = String(config?.model || '').trim().toLowerCase();
    if (m.includes('voyage-3-lite') && !m.includes('3.5')) return 512;
    if (m.includes('code-2') || (m.includes('large-2') && !m.includes('voyage-3') && !m.includes('voyage-4'))) return 1536;
    return 1024;
  }
  if (provider === 'deepinfra') {
    // Common DeepInfra embedding models. Default BAAI/bge-large-en-v1.5 is 1024.
    // Switching dimension requires a vault re-index — see EMBEDDING_MODEL in .env.example.
    const m = String(config?.model || '').trim().toLowerCase();
    if (m.includes('qwen3-embedding-8b') || m.includes('bge-en-icl')) return 4096;
    if (m.includes('qwen3-embedding-4b')) return 2560;
    if (m.includes('qwen3-embedding-0.6b')) return 1024;
    if (m.includes('multilingual-e5-large') || m.includes('bge-large') || m.includes('bge-m3')) return 1024;
    if (m.includes('bge-base') || m.includes('e5-base')) return 768;
    if (m.includes('bge-small') || m.includes('e5-small')) return 384;
    return 1024; // safe default for the default model BAAI/bge-large-en-v1.5
  }
  // nomic-embed-text and most Ollama embed models
  return 768;
}
