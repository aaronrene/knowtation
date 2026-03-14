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
 * Normalize date to YYYY-MM-DD for range comparison (Qdrant accepts string range).
 * @param {string} d - ISO 8601 or YYYY-MM-DD
 * @returns {string}
 */
function dateToComparable(d) {
  if (d == null || typeof d !== 'string') return '';
  const s = d.trim().slice(0, 10);
  return s || '';
}

/**
 * Build Qdrant filter for project, tag, date range, and optional chain/entity/episode.
 * Folder (path prefix) is applied as post-filter.
 * @param {{ project?: string, tag?: string, since?: string, until?: string, chain?: string, entity?: string, episode?: string }} filters
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
  // Date range (since/until) applied as post-filter for compatibility with string payload
  if (filters.chain != null && filters.chain !== '') {
    must.push({ key: 'causal_chain_id', match: { value: filters.chain } });
  }
  if (filters.entity != null && filters.entity !== '') {
    must.push({ key: 'entity', match: { any: [filters.entity] } });
  }
  if (filters.episode != null && filters.episode !== '') {
    must.push({ key: 'episode_id', match: { value: filters.episode } });
  }
  return must.length ? { must } : {};
}

/**
 * Create vector store (Qdrant or sqlite-vec). Validates config.
 * @param {{ qdrant_url?: string, vector_store?: string, data_dir?: string }} config
 * @returns {{ ensureCollection: (dimension: number) => Promise<void>, upsert: (points) => Promise<void>, search: (queryVector: number[], options) => Promise<{ path, score, project, tags, date, text }[]>, count?: () => Promise<number> }}
 */
export async function createVectorStore(config) {
  const store = config.vector_store || 'qdrant';
  if (store === 'sqlite-vec') {
    const { createSqliteVectorStore } = await import('./vector-store-sqlite.mjs');
    return createSqliteVectorStore(config);
  }
  if (store !== 'qdrant') {
    throw new Error(`Vector store "${store}" is not implemented. Use vector_store: qdrant or sqlite-vec.`);
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
          causal_chain_id: p.causal_chain_id ?? null,
          entity: p.entity ?? [],
          episode_id: p.episode_id ?? null,
        },
      }));
      await client.upsert(COLLECTION_NAME, {
        wait: true,
        points: payload,
      });
    },

    /**
     * Search by vector. Returns scored points with payload (path, project, tags, date, text).
     * Folder filter (path prefix) and order are applied as post-filter/post-sort.
     * @param {number[]} queryVector
     * @param {{ limit?: number, project?: string, tag?: string, folder?: string, since?: string, until?: string, chain?: string, entity?: string, episode?: string, order?: string }} options
     * @returns {Promise<{ path: string, score: number, project: string|null, tags: string[], date: string|null, text: string|null }[]>}
     */
    async search(queryVector, options = {}) {
      const limit = Math.min(options.limit ?? 10, 100);
      const filter = buildFilter({
        project: options.project ?? undefined,
        tag: options.tag ?? undefined,
        since: options.since ?? undefined,
        until: options.until ?? undefined,
        chain: options.chain ?? undefined,
        entity: options.entity ?? undefined,
        episode: options.episode ?? undefined,
      });
      let scored;
      try {
        scored = await client.search(COLLECTION_NAME, {
          vector: queryVector,
          limit: options.folder || options.since || options.until ? Math.min(limit * 3, 300) : limit,
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
      }
      const since = dateToComparable(options.since);
      const until = dateToComparable(options.until);
      if (since || until) {
        hits = hits.filter((h) => {
          const d = dateToComparable(h.date);
          if (!d) return false;
          if (since && d < since) return false;
          if (until && d > until) return false;
          return true;
        });
      }
      const order = options.order;
      if (order === 'date-asc') {
        hits.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      } else if (order === 'date') {
        hits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }
      hits = hits.slice(0, limit);
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
