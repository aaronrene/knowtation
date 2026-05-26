/**
 * Hosted indexer chunk sizing policy.
 *
 * The bridge indexer uses character chunks before sending text to embedding
 * providers. DeepInfra's commonly used BGE embedding models reject requests
 * above a 512-token context window, so the hosted default must keep a real
 * safety margin instead of relying on the old 2048 chars ~= 512 tokens rule.
 */

const DEFAULT_CHUNK_SIZE = 2048;
const DEFAULT_CHUNK_OVERLAP = 256;
const DEEPINFRA_SAFE_CHUNK_SIZE = 1024;
const DEEPINFRA_SAFE_CHUNK_OVERLAP = 128;

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
function parsePositiveInteger(raw) {
  if (raw == null || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.floor(value);
}

/**
 * @param {string|null|undefined} provider
 * @returns {string}
 */
export function defaultBridgeEmbeddingModelForProvider(provider) {
  const p = String(provider || 'ollama').trim().toLowerCase();
  if (p === 'openai') return 'text-embedding-3-small';
  if (p === 'voyage') return 'voyage-4-lite';
  if (p === 'deepinfra') return 'BAAI/bge-large-en-v1.5';
  return 'nomic-embed-text';
}

/**
 * @param {{ provider?: string|null, model?: string|null }} embeddingConfig
 * @returns {number}
 */
export function safeIndexerChunkSizeForEmbedding(embeddingConfig = {}) {
  const provider = String(embeddingConfig?.provider || '').trim().toLowerCase();
  if (provider === 'deepinfra') return DEEPINFRA_SAFE_CHUNK_SIZE;
  return DEFAULT_CHUNK_SIZE;
}

/**
 * @param {{
 *   INDEXER_CHUNK_SIZE?: string|number|null,
 *   INDEXER_CHUNK_OVERLAP?: string|number|null,
 * }} env
 * @param {{ provider?: string|null, model?: string|null }} embeddingConfig
 * @returns {{ chunkSize: number, chunkOverlap: number }}
 */
export function resolveIndexerChunkOptions(env = {}, embeddingConfig = {}) {
  const provider = String(embeddingConfig?.provider || '').trim().toLowerCase();
  const safeChunkSize = safeIndexerChunkSizeForEmbedding(embeddingConfig);
  const rawChunkSize = parsePositiveInteger(env.INDEXER_CHUNK_SIZE);
  const chunkSize =
    provider === 'deepinfra'
      ? Math.min(rawChunkSize ?? safeChunkSize, safeChunkSize)
      : (rawChunkSize ?? safeChunkSize);

  const defaultOverlap =
    provider === 'deepinfra' ? DEEPINFRA_SAFE_CHUNK_OVERLAP : DEFAULT_CHUNK_OVERLAP;
  const rawOverlap = parsePositiveInteger(env.INDEXER_CHUNK_OVERLAP);
  const providerMaxOverlap =
    provider === 'deepinfra' ? DEEPINFRA_SAFE_CHUNK_OVERLAP : Math.max(0, chunkSize - 1);
  const maxOverlap = Math.min(Math.max(0, chunkSize - 1), providerMaxOverlap);
  const chunkOverlap = Math.min(rawOverlap ?? defaultOverlap, maxOverlap);

  return { chunkSize, chunkOverlap };
}

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEEPINFRA_SAFE_CHUNK_SIZE,
  DEEPINFRA_SAFE_CHUNK_OVERLAP,
};
