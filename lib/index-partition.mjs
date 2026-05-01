/**
 * Pure partition step for `hub/bridge/server.mjs POST /api/v1/index`'s incremental
 * cache flow. Given the chunks built from the canister export (each tagged with a
 * versioned content hash) and the `(chunk_id → content_hash)` Map persisted by the
 * sqlite-vec / Qdrant store from the previous successful index, decide:
 *
 *   - which chunks can be **skipped** (hash matches: vector + payload already correct);
 *   - which chunks must be **embedded** (new chunk, or text/metadata changed);
 *   - which prior chunk_ids are **orphans** (present in the store but absent from
 *     the current export, e.g. note deleted or path renamed).
 *
 * Pulled out of the index handler so the partition contract has unit tests without
 * spinning up the canister, embedding provider, or sqlite-vec backend.
 *
 * @typedef {{
 *   chunk: { id: string, text: string, path: string, [k: string]: any },
 *   storeId: string,
 *   contentHash: string,
 * }} ChunkWithHash
 *
 * @param {ChunkWithHash[]} chunksWithHash - Output of building chunks for the current export.
 * @param {Map<string, string>|null|undefined} existingHashes - From `store.getChunkHashes(vaultId)`.
 *   Treated as empty when null/undefined (e.g. backend without the surface).
 * @returns {{
 *   toEmbed: ChunkWithHash[],
 *   skippedCachedCount: number,
 *   orphanIds: string[],
 *   presentChunkIds: Set<string>,
 * }}
 */
export function partitionChunksForReindex(chunksWithHash, existingHashes) {
  if (!Array.isArray(chunksWithHash)) {
    throw new TypeError('partitionChunksForReindex: chunksWithHash must be an array');
  }
  const cache = existingHashes instanceof Map ? existingHashes : new Map();
  const toEmbed = [];
  let skippedCachedCount = 0;
  const presentChunkIds = new Set();
  for (const item of chunksWithHash) {
    if (
      !item ||
      typeof item.storeId !== 'string' ||
      item.storeId === '' ||
      typeof item.contentHash !== 'string' ||
      item.contentHash === ''
    ) {
      throw new TypeError(
        'partitionChunksForReindex: each item must have non-empty storeId and contentHash',
      );
    }
    presentChunkIds.add(item.storeId);
    const prior = cache.get(item.storeId);
    if (prior && prior === item.contentHash) {
      skippedCachedCount++;
      continue;
    }
    toEmbed.push(item);
  }
  const orphanIds = [];
  for (const cid of cache.keys()) {
    if (!presentChunkIds.has(cid)) orphanIds.push(cid);
  }
  return { toEmbed, skippedCachedCount, orphanIds, presentChunkIds };
}
