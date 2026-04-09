/**
 * Embedding provider abstraction. Ollama, OpenAI, or Voyage AI from config.
 * SPEC §4.4: embedding.provider, embedding.model; env for API keys.
 */

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * Turn Undici/Node `fetch` failures (often message-only "fetch failed") into an actionable Hub/API error.
 * @param {'ollama'|'openai'|'voyage'} provider
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
  throw new Error(`Unknown embedding provider: ${provider}. Supported: ollama, openai, voyage.`);
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
  // nomic-embed-text and most Ollama embed models
  return 768;
}
