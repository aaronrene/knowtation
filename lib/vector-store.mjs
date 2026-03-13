/**
 * Vector store abstraction. Qdrant backend for indexer (Phase 2); search in Phase 3.
 * SPEC §5: metadata (path, project, tags, date); stable chunk id for upsert.
 */

import crypto from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION_NAME = 'knowtation';

/**
 * Deterministic string to positive integer for Qdrant point id (upsert by same id = no duplicate).
 */
function pointIdFromChunkId(chunkId) {
  const buf = crypto.createHash('sha256').update(chunkId).digest();
  return buf.readUInt32BE(0);
}

/**
 * Create a Qdrant vector store client. Validates config for qdrant.
 * @param {{ qdrant_url: string, vector_store: string }} config
 * @returns {{ ensureCollection: (dimension: number) => Promise<void>, upsert: (points: { id: string, vector: number[], path: string, project?: string, tags: string[], date?: string }[]) => Promise<void> }}
 */
export function createVectorStore(config) {
  const store = config.vector_store || 'qdrant';
  if (store !== 'qdrant') {
    throw new Error(`Vector store "${store}" is not implemented. Use vector_store: qdrant and set qdrant_url.`);
  }
  const url = config.qdrant_url;
  if (!url || typeof url !== 'string') {
    throw new Error('Qdrant requires qdrant_url in config or QDRANT_URL env.');
  }

  const client = new QdrantClient({ url: url.replace(/\/$/, '') });

  return {
    async ensureCollection(dimension) {
      try {
        await client.getCollection(COLLECTION_NAME);
        return;
      } catch (_) {
        // Collection does not exist; create it.
      }
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      });
    },

    async upsert(points) {
      if (!points.length) return;
      const payload = points.map((p) => ({
        id: pointIdFromChunkId(p.id),
        vector: p.vector,
        payload: {
          chunk_id: p.id,
          path: p.path,
          project: p.project ?? null,
          tags: p.tags ?? [],
          date: p.date ?? null,
          text: p.text ?? null,
        },
      }));
      await client.upsert(COLLECTION_NAME, {
        wait: true,
        points: payload,
      });
    },
  };
}

export { COLLECTION_NAME };
