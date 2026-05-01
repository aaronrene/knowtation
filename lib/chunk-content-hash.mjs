/**
 * Stable content hash for an indexed chunk. Used by `hub/bridge/server.mjs`
 * `POST /api/v1/index` to skip re-embedding chunks whose text and search-relevant
 * metadata did not change since the last successful index.
 *
 * The hash MUST be stable across processes (same canonical input → same digest)
 * because we persist it in the sqlite-vec auxiliary column `+content_hash` and
 * compare against newly-built chunks on every re-index. Bumping the algorithm or
 * the canonical-form ordering breaks every cache hit and forces a full re-embed.
 *
 * Why include metadata (path/tags/project/date/...) — not just text:
 *   The bridge upserts the chunk row with these fields as vec0 metadata; if any
 *   of them change we must re-write the row even though the embedding is the
 *   same. Hashing them together means "skip" is always safe (vector AND payload
 *   are still correct).
 *
 * Truncation: SHA-256 → first 32 hex chars (128 bits). Birthday-collision
 * probability for ~10^9 chunks per vault is ≈ 10^-21, far below the noise floor
 * of any other failure mode (network blip, embedding API hiccup).
 */

import crypto from 'crypto';

/**
 * Compute the canonical content hash for a chunk.
 *
 * @param {{
 *   text: string,
 *   path: string,
 *   project?: string|null,
 *   tags?: string[]|null,
 *   date?: string|null,
 *   causal_chain_id?: string|null,
 *   entity?: string[]|null,
 *   episode_id?: string|null,
 * }} chunk - As produced by `lib/chunk.mjs:chunkNote`. `text` and `path` are required;
 *   the rest are optional and default to null/[] so chunks built without them in different
 *   parts of the codebase (e.g. bridge vs CLI) hash identically when their text+path match.
 * @returns {string} 32-char lowercase hex (128 bits).
 */
export function computeChunkContentHash(chunk) {
  if (chunk == null || typeof chunk !== 'object') {
    throw new TypeError('computeChunkContentHash: chunk is required');
  }
  if (typeof chunk.text !== 'string') {
    throw new TypeError('computeChunkContentHash: chunk.text must be a string');
  }
  if (typeof chunk.path !== 'string') {
    throw new TypeError('computeChunkContentHash: chunk.path must be a string');
  }
  // Canonical form: explicit field order, sorted arrays, null for missing values.
  // JSON.stringify with explicit object structure (not the chunk itself) so that future
  // additional chunk fields (e.g. embedded summaries) do not silently invalidate the cache.
  const tags = Array.isArray(chunk.tags) ? chunk.tags.slice().sort() : [];
  const entity = Array.isArray(chunk.entity) ? chunk.entity.slice().sort() : [];
  const meta = JSON.stringify({
    p: chunk.path,
    pr: chunk.project ?? null,
    t: tags,
    d: chunk.date ?? null,
    cc: chunk.causal_chain_id ?? null,
    e: entity,
    ep: chunk.episode_id ?? null,
  });
  const h = crypto.createHash('sha256');
  h.update(chunk.text);
  h.update('\x00');
  h.update(meta);
  return h.digest('hex').slice(0, 32);
}

/**
 * Versioned hash algorithm tag stored alongside each row. If we ever change the
 * canonical form (e.g. add a new metadata field or swap algorithm), bumping the
 * version invalidates every cached row and forces a one-time full re-embed
 * without us having to flip a separate "rebuild" flag everywhere.
 */
export const CHUNK_CONTENT_HASH_VERSION = 'v1';

/**
 * Normalize a provider name for the hash prefix: lowercased, restricted to
 * `[a-z0-9_-]`. Bridge / CLI both pass `getBridgeEmbeddingConfig().provider`
 * (e.g. `'deepinfra'`, `'openai'`, `'voyage'`, `'ollama'`); a typo'd or extended
 * provider name still produces a stable, comparable prefix here.
 *
 * @param {string} provider
 * @returns {string}
 */
function normalizeProviderForHash(provider) {
  return String(provider)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
}

/**
 * Normalize a model name for the hash prefix. Models legitimately contain `/`
 * (e.g. `BAAI/bge-large-en-v1.5`) and `.` so we DO NOT alphanumeric-strip them,
 * but we collapse whitespace + control characters that would corrupt log lines.
 *
 * @param {string} model
 * @returns {string}
 */
function normalizeModelForHash(model) {
  return String(model)
    .trim()
    .replace(/[\s\r\n\x00]+/g, '_');
}

/**
 * Compose the value persisted in the `+content_hash` column.
 *
 * Format: `"v1:<provider>:<model>:<32-hex>"` — the provider + model are part of
 * the prefix so a future provider/model swap (e.g. DeepInfra BGE-large 1024 →
 * DeepInfra BGE-m3 1024 — same dimension, different vector space) automatically
 * invalidates every cached row. Without this, a same-dimension model swap would
 * silently keep stale vectors and corrupt Meaning search results with no error.
 *
 * Including the prefix in the stored hash keeps it human-readable: an operator
 * can grep `+content_hash` rows and immediately see which provider/model produced
 * each vector, which makes any future cache-debugging session trivial.
 *
 * @param {{ text: string, path: string }} chunk
 * @param {{ provider: string, model: string }} embeddingConfig - The provider + model
 *   the bridge / CLI is about to call. Both fields are required: omitting them is
 *   a caller bug (would re-introduce the same-dimension silent corruption this
 *   prefix prevents) and is rejected loudly with a TypeError.
 * @returns {string} `"v1:<provider>:<model>:<32-hex>"`
 */
export function computeChunkContentHashTagged(chunk, embeddingConfig) {
  if (embeddingConfig == null || typeof embeddingConfig !== 'object') {
    throw new TypeError(
      'computeChunkContentHashTagged: embeddingConfig is required ({ provider, model }). ' +
        'Without provider+model in the prefix, a same-dimension model swap would silently keep stale vectors.',
    );
  }
  if (typeof embeddingConfig.provider !== 'string' || embeddingConfig.provider.trim() === '') {
    throw new TypeError(
      'computeChunkContentHashTagged: embeddingConfig.provider must be a non-empty string',
    );
  }
  if (typeof embeddingConfig.model !== 'string' || embeddingConfig.model.trim() === '') {
    throw new TypeError(
      'computeChunkContentHashTagged: embeddingConfig.model must be a non-empty string',
    );
  }
  const provider = normalizeProviderForHash(embeddingConfig.provider);
  const model = normalizeModelForHash(embeddingConfig.model);
  return `${CHUNK_CONTENT_HASH_VERSION}:${provider}:${model}:${computeChunkContentHash(chunk)}`;
}
