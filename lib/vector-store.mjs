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
 * Build Qdrant filter for project and tag. Folder (path prefix) is applied as post-filter.
 * @param {{ project?: string, tag?: string }} filters - normalized project slug and/or tag
 * @returns {{ must?: object[] }} or empty object
 */
function buildFilter(filters) {
  const must = [];
  if (filters.project != null && filters.project !== '') {
    must.push({ key: 'project', match: { value: filters.project } });
  }
  if (filters.tag != null && filters.tag !== '') {
    must.push({ key: 'tags', match: { any: [filters.tag] } });
  }
  return must.length ? { must } : {};
}

/**
 * Create a Qdrant vector store client. Validates config for qdrant.
 * @param {{ qdrant_url: string, vector_store: string }} config
 * @returns {{ ensureCollection: (dimension: number) => Promise<void>, upsert: (points) => Promise<void>, search: (queryVector: number[], options) => Promise<{ path, score, project, tags, date, text }[]> }}
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

    /**
     * Search by vector. Returns scored points with payload (path, project, tags, date, text).
     * Folder filter (path prefix) is applied as post-filter.
     * @param {number[]} queryVector
     * @param {{ limit?: number, project?: string, tag?: string, folder?: string }} options
     * @returns {Promise<{ path: string, score: number, project: string|null, tags: string[], date: string|null, text: string|null }[]>}
     */
    async search(queryVector, options = {}) {
      const limit = Math.min(options.limit ?? 10, 100);
      const filter = buildFilter({
        project: options.project ?? undefined,
        tag: options.tag ?? undefined,
      });
      let scored;
      try {
        scored = await client.search(COLLECTION_NAME, {
          vector: queryVector,
          limit: options.folder ? limit * 3 : limit,
          filter: Object.keys(filter).length ? filter : undefined,
          with_payload: true,
          with_vector: false,
        });
      } catch (e) {
        if (e.message && (e.message.includes('Not found') || e.message.includes('404'))) {
          throw new Error('Vector store collection not found. Run "knowtation index" first to index your vault.');
        }
        throw e;
      }
      let hits = (scored || []).map((p) => {
        const pl = p.payload || {};
        return {
          path: pl.path ?? '',
          score: typeof p.score === 'number' ? p.score : 0,
          project: pl.project ?? null,
          tags: Array.isArray(pl.tags) ? pl.tags : [],
          date: pl.date ?? null,
          text: pl.text ?? null,
        };
      });
      const folder = options.folder;
      if (folder && typeof folder === 'string') {
        const prefix = folder.replace(/\\/g, '/').replace(/\/$/, '') + '/';
        const exact = folder.replace(/\\/g, '/').replace(/\/$/, '');
        hits = hits.filter((h) => h.path === exact || h.path.startsWith(prefix));
        hits = hits.slice(0, limit);
      } else if (options.folder === undefined || options.folder === null) {
        hits = hits.slice(0, limit);
      }
      return hits;
    },

    /**
     * Return total point count for the collection (for count-only or existence check).
     * @returns {Promise<number>}
     */
    async count() {
      try {
        const result = await client.count(COLLECTION_NAME);
        return result?.count ?? 0;
      } catch (e) {
        if (e.message && (e.message.includes('Not found') || e.message.includes('404'))) {
          return 0;
        }
        throw e;
      }
    },
  };
}

export { COLLECTION_NAME };
