/**
 * Embedding provider abstraction. Ollama (e.g. nomic-embed-text) or OpenAI from config.
 * SPEC §4.4: embedding.provider, embedding.model; env for API keys.
 */

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

/**
 * Embed one or many texts. Returns array of vectors (same order as input).
 * @param {string[]} texts
 * @param {{ provider: string, model: string, ollama_url?: string }} config - From loadConfig().embedding
 * @returns {Promise<number[][]>}
 */
export async function embed(texts, config) {
  if (!texts.length) return [];
  const provider = (config?.provider || 'ollama').toLowerCase();
  const model = config?.model || 'nomic-embed-text';

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
  const base = url.replace(/\/$/, '');
  const out = [];
  // Ollama /api/embed accepts one prompt; for batch we call per text (or check if array is supported)
  for (const text of texts) {
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const provider = (config?.provider || 'ollama').toLowerCase();
  if (provider === 'openai') {
    // text-embedding-3-small 1536, text-embedding-3-large 3072, ada 1536
    const m = (config?.model || '').toLowerCase();
    if (m.includes('large')) return 3072;
    return 1536;
  }
  // nomic-embed-text and most Ollama embed models
  return 768;
}
