/**
 * Vector store abstraction. Qdrant backend for indexer (Phase 2); search in Phase 3.
 * SPEC §5: metadata (path, project, tags, date); stable chunk id for upsert.
 */

import crypto from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { MAX_VECTOR_KNN } from './vector-knn-limit.mjs';

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
 * Build Qdrant filter for project, tag, date range, vault_id, and optional chain/entity/episode.
 * Folder (path prefix) is applied as post-filter.
 * @param {{ project?: string, tag?: string, since?: string, until?: string, chain?: string, entity?: string, episode?: string, vault_id?: string }} filters
 * @returns {{ must?: object[] }} or empty object
 */
function buildFilter(filters) {
  const must = [];
  if (filters.vault_id != null && filters.vault_id !== '') {
    must.push({ key: 'vault_id', match: { value: filters.vault_id } });
  }
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
          vault_id: p.vault_id ?? 'default',
          project: p.project ?? null,
          tags: p.tags ?? [],
          date: p.date ?? null,
          text: p.text ?? null,
          causal_chain_id: p.causal_chain_id ?? null,
          entity: p.entity ?? [],
          episode_id: p.episode_id ?? null,
          // `content_hash` is the bridge-side cache key for skip-re-embed; mirror the
          // sqlite-vec backend so both stores expose the same getChunkHashes surface.
          content_hash: p.content_hash ?? null,
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
     * @param {{ limit?: number, vault_id?: string, project?: string, tag?: string, folder?: string, since?: string, until?: string, chain?: string, entity?: string, episode?: string, order?: string }} options
     * @returns {Promise<{ path: string, score: number, project: string|null, tags: string[], date: string|null, text: string|null }[]>}
     */
    async search(queryVector, options = {}) {
      const limit = Math.min(options.limit ?? 10, 100);
      const filter = buildFilter({
        vault_id: options.vault_id ?? undefined,
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
        const pathPrefixFilter = options.folder && String(options.folder).trim() !== '';
        const knnLimit = Math.min(
          pathPrefixFilter
            ? Math.min(Math.max(limit * 100, 2000), 10000)
            : options.since || options.until
              ? Math.min(limit * 3, 300)
              : limit,
          MAX_VECTOR_KNN,
        );
        scored = await client.search(COLLECTION_NAME, {
          vector: queryVector,
          limit: knnLimit,
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
      const scoredList = Array.isArray(scored)
        ? scored
        : scored && typeof scored === 'object' && Array.isArray(scored.points)
          ? scored.points
          : [];
      let hits = scoredList.map((p) => {
        const pl = p.payload || {};
        const rawSc = p.score;
        let score = typeof rawSc === 'number' && Number.isFinite(rawSc) ? rawSc : Number(rawSc);
        if (!Number.isFinite(score)) score = 0;
        return {
          path: pl.path ?? '',
          score,
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

    /**
     * Remove all points tagged with this Hub vault_id (Phase 15 multi-vault).
     * @param {string} vaultId
     * @returns {Promise<number>} 1 if delete ran; 0 if collection missing
     */
    async deleteByVaultId(vaultId) {
      if (vaultId == null || vaultId === '') return 0;
      const vid = String(vaultId).trim();
      if (!vid) return 0;
      const filter = buildFilter({ vault_id: vid });
      if (!filter.must || filter.must.length === 0) return 0;
      try {
        await client.delete(COLLECTION_NAME, { wait: true, filter });
        return 1;
      } catch (e) {
        if (e.message && (e.message.includes('Not found') || e.message.includes('404'))) {
          return 0;
        }
        throw e;
      }
    },

    /**
     * Mirror of `vector-store-sqlite.getChunkHashes`: returns Map<chunk_id, content_hash>
     * for the named vault. Implemented via Qdrant `scroll` (paginated) since `count` does
     * not return payload. A null/empty content_hash is treated as cache miss and skipped.
     *
     * @param {string} vaultId
     * @returns {Promise<Map<string, string>>}
     */
    async getChunkHashes(vaultId) {
      const out = new Map();
      if (vaultId == null || vaultId === '') return out;
      const vid = String(vaultId).trim();
      if (!vid) return out;
      const filter = buildFilter({ vault_id: vid });
      if (!filter.must || filter.must.length === 0) return out;
      try {
        let nextOffset = undefined;
        const PAGE = 256;
        // Bound iterations defensively (vault can have huge note count, but a runaway
        // server would block the index handler past Netlify's sync cap).
        for (let i = 0; i < 4096; i++) {
          const page = await client.scroll(COLLECTION_NAME, {
            filter,
            with_payload: true,
            with_vector: false,
            limit: PAGE,
            offset: nextOffset,
          });
          const points = Array.isArray(page?.points) ? page.points : [];
          for (const p of points) {
            const cid = p?.payload?.chunk_id;
            const ch = p?.payload?.content_hash;
            if (typeof cid !== 'string' || cid === '') continue;
            if (typeof ch !== 'string' || ch === '') continue;
            out.set(cid, ch);
          }
          nextOffset = page?.next_page_offset;
          if (!nextOffset || points.length === 0) break;
        }
      } catch (e) {
        if (e.message && (e.message.includes('Not found') || e.message.includes('404'))) {
          return out;
        }
        throw e;
      }
      return out;
    },

    /**
     * Mirror of `vector-store-sqlite.deleteByChunkIds`: takes string chunk_ids and
     * deletes the corresponding integer points. Used by the bridge to remove orphans
     * (chunks present in the previous index but absent from the current export).
     *
     * @param {string[]} chunkIds
     * @returns {Promise<number>} count requested for delete (Qdrant does not return per-id success)
     */
    async deleteByChunkIds(chunkIds) {
      if (!Array.isArray(chunkIds) || chunkIds.length === 0) return 0;
      const ids = chunkIds
        .filter((cid) => typeof cid === 'string' && cid !== '')
        .map((cid) => pointIdFromChunkId(cid));
      if (ids.length === 0) return 0;
      try {
        await client.delete(COLLECTION_NAME, { wait: true, points: ids });
        return ids.length;
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
