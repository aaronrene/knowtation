/**
 * Embedding provider abstraction. Ollama (e.g. nomic-embed-text) or OpenAI from config.
 * SPEC §4.4: embedding.provider, embedding.model; env for API keys.
 */

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

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
 * Embed one or many texts. Returns array of vectors (same order as input).
 * @param {string[]} texts
 * @param {{ provider: string, model: string, ollama_url?: string }} config - From loadConfig().embedding
 * @returns {Promise<number[][]>}
 */
export async function embed(texts, config) {
  if (!texts.length) return [];
  const provider = String(config?.provider || 'ollama').trim().toLowerCase();
  const model =
    config?.model == null || String(config.model).trim() === ''
      ? 'nomic-embed-text'
      : String(config.model).trim();

  if (provider === 'ollama') {
    return embedOllama(texts, { model, url: config?.ollama_url || OLLAMA_DEFAULT_URL });
  }
  if (provider === 'openai') {
    return embedOpenAI(texts, { model, apiKey: process.env.OPENAI_API_KEY });
  }
  throw new Error(`Unknown embedding provider: ${provider}. Supported: ollama, openai.`);
}

/**
 * @param {string[]} texts
 * @param {{ model: string, url: string }}
 * @returns {Promise<number[][]>}
 */
async function embedOllama(texts, { model, url }) {
  const base = normalizeOllamaEmbedBaseUrl(url);
  const apiKey = process.env.OLLAMA_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  const out = [];
  // Ollama /api/embed accepts one prompt; for batch we call per text (or check if array is supported)
  for (const text of texts) {
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: text }),
    });
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
  return out;
}

/**
 * @param {string[]} texts
 * @param {{ model: string, apiKey?: string }}
 * @returns {Promise<number[][]>}
 */
async function embedOpenAI(texts, { model, apiKey }) {
  if (!apiKey) {
    throw new Error('OpenAI embeddings require OPENAI_API_KEY environment variable.');
  }
  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embed failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  const byIndex = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return byIndex.map((d) => d.embedding);
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
  // nomic-embed-text and most Ollama embed models
  return 768;
}
