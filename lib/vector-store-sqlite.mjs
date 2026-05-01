/**
 * sqlite-vec backend for vector store. Phase 10.
 * Same interface as Qdrant: ensureCollection(dimension), upsert(points), search(queryVector, options), count().
 * DB path: data_dir/knowtation_vectors.db
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { MAX_VECTOR_KNN } from './vector-knn-limit.mjs';

const TABLE_NAME = 'knowtation_vec';
const DB_FILENAME = 'knowtation_vectors.db';

/**
 * sqlite-vec / better-sqlite3 may return `distance` as number, bigint, string, or (rarely) Buffer.
 * @param {unknown} raw
 * @returns {number|null}
 */
function coerceVecDistance(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw) && raw.length === 8) {
    const n = raw.readDoubleLE(0);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function pointIdFromChunkId(chunkId) {
  const buf = crypto.createHash('sha256').update(chunkId).digest();
  return buf.readUInt32BE(0);
}

function dateToComparable(d) {
  if (d == null || typeof d !== 'string') return '';
  return d.trim().slice(0, 10) || '';
}

/**
 * Create sqlite-vec vector store. Uses data_dir for DB path.
 * @param {{ vector_store: string, data_dir: string }} config
 * @returns {{ ensureCollection: (dimension: number) => Promise<void>, upsert: (points) => Promise<void>, search: (queryVector: number[], options?: { limit?: number, vault_id?: string, project?: string, tag?: string, folder?: string, since?: string, until?: string, order?: string, chain?: string, entity?: string, episode?: string }) => Promise<{ path, score, project, tags, date, text }[]>, count: () => Promise<number> }}
 */
export function createSqliteVectorStore(config) {
  const dataDir = config.data_dir || 'data';
  const resolvedDir = path.isAbsolute(dataDir) ? dataDir : path.resolve(process.cwd(), dataDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }
  const dbPath = path.join(resolvedDir, DB_FILENAME);
  const db = new Database(dbPath);
  sqliteVec.load(db);

  let _dimension = null;

  return {
    /** Close the database (for tests or cleanup). */
    close() {
      db.close();
    },

    async ensureCollection(dimension) {
      _dimension = dimension;
      const tableInfo = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (tableInfo && tableInfo.sql) {
        const match = tableInfo.sql.match(/embedding\s+FLOAT\s*\[\s*(\d+)\s*]/i);
        const existingDim = match ? parseInt(match[1], 10) : null;
        if (existingDim != null && existingDim !== dimension) {
          throw new Error(
            `Vector store dimension mismatch: table has ${existingDim}, requested ${dimension}. ` +
            `Delete ${dbPath} and run "knowtation index" to re-index with the current embedding model.`
          );
        }
        // Phase 15: multi-vault Hub shares one DB; older vec0 tables lacked vault_id — drop and recreate.
        // Phase 19+ (`feat/bridge-embed-hash-cache`): older tables also lacked `+content_hash`,
        // which is required for the bridge to skip re-embedding unchanged chunks. vec0 virtual
        // tables cannot be ALTERed, so we drop + recreate; the bridge runs `deleteByVaultId`
        // anyway when persisted vectors are missing, so the one-time cost is a single full
        // re-embed of the active vault. After that, the cache is populated and re-indexes are fast.
        const hasVaultId = /\bvault_id\b/i.test(tableInfo.sql);
        const hasContentHash = /\bcontent_hash\b/i.test(tableInfo.sql);
        if (!hasVaultId || !hasContentHash) {
          db.exec(`DROP TABLE ${TABLE_NAME}`);
        } else {
          return;
        }
      }
      // vec0: id integer primary key, embedding float[dim], metadata columns, +auxiliary.
      // `+content_hash` is auxiliary (not indexed) — read alongside id for the bridge cache check.
      const sql = `CREATE VIRTUAL TABLE ${TABLE_NAME} USING vec0(
        id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimension}],
        path TEXT,
        project TEXT,
        date TEXT,
        causal_chain_id TEXT,
        episode_id TEXT,
        +vault_id TEXT,
        +tags TEXT,
        +entity TEXT,
        +chunk_text TEXT,
        +content_hash TEXT,
        +chunk_id TEXT
      )`;
      db.exec(sql);
    },

    async upsert(points) {
      if (!points.length) return;
      // vec0 does not support INSERT OR REPLACE / UPSERT (sqlite-vec #127); delete then insert.
      const delStmt = db.prepare(`DELETE FROM ${TABLE_NAME} WHERE id = ?`);
      const run = db.transaction((pts) => {
        for (const p of pts) {
          const id = pointIdFromChunkId(p.id);
          const tagsStr = JSON.stringify(p.tags ?? []);
          const entityStr = JSON.stringify(p.entity ?? []);
          // vec0 TEXT metadata columns do not accept NULL; use empty string.
          const esc = (v) => {
            if (v == null || v === '') return "''";
            return "'" + String(v).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
          };
          const embeddingStr = JSON.stringify(Array.from(p.vector));
          if (embeddingStr.includes("'")) {
            throw new Error('Vector cannot contain single quote (invalid embedding).');
          }
          delStmt.run(id);
          const vaultStr = esc(p.vault_id ?? 'default');
          // `chunk_id` (string) lets the bridge's content-hash cache look up rows without
          // having to invert the SHA-256-truncated integer id (`pointIdFromChunkId`).
          const chunkIdStr = esc(p.id);
          const contentHashStr = esc(p.content_hash);
          db.exec(
            `INSERT INTO ${TABLE_NAME} (id, embedding, path, project, date, causal_chain_id, episode_id, vault_id, tags, entity, chunk_text, content_hash, chunk_id) VALUES (${id}, '${embeddingStr}', ${esc(p.path)}, ${esc(p.project)}, ${esc(p.date)}, ${esc(p.causal_chain_id)}, ${esc(p.episode_id)}, ${vaultStr}, ${esc(tagsStr)}, ${esc(entityStr)}, ${esc(p.text)}, ${contentHashStr}, ${chunkIdStr})`
          );
        }
      });
      run(points);
    },

    async search(queryVector, options = {}) {
      const limit = Math.min(options.limit ?? 10, 100);
      const needsWideFetch =
        options.folder ||
        options.since ||
        options.until ||
        options.tag ||
        options.entity ||
        (options.vault_id != null && options.vault_id !== '');
      // Multi-vault: KNN is global; a small vault can be absent from top-k unless k is large enough.
      const vaultScoped = options.vault_id != null && options.vault_id !== '';
      const pathPrefixFilter = options.folder && String(options.folder).trim() !== '';
      let fetchLimit = limit;
      if (pathPrefixFilter) {
        fetchLimit = Math.min(Math.min(Math.max(limit * 100, 2000), 10000), MAX_VECTOR_KNN);
      } else if (needsWideFetch) {
        fetchLimit = Math.min(
          Math.min(vaultScoped ? Math.max(limit * 25, 400) : limit * 3, vaultScoped ? 2000 : 300),
          MAX_VECTOR_KNN,
        );
      } else {
        fetchLimit = Math.min(fetchLimit, MAX_VECTOR_KNN);
      }

      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (!exists) {
        throw new Error('Vector store collection not found. Run "knowtation index" first to index your vault.');
      }

      const vecStr = JSON.stringify(Array.from(queryVector));
      // vec0 KNN: one binding for the vector; k as literal to avoid binding order issues.
      const stmt = db.prepare(`
        SELECT id, path, project, date, causal_chain_id, episode_id, vault_id, tags, entity, chunk_text, distance
        FROM ${TABLE_NAME}
        WHERE embedding MATCH ? AND k = ${fetchLimit}
      `);

      let rows;
      try {
        rows = stmt.all(vecStr);
      } catch (e) {
        if (e.message && e.message.includes('no such table')) {
          throw new Error('Vector store collection not found. Run "knowtation index" first to index your vault.');
        }
        throw e;
      }

      let hits = (rows || []).map((row) => {
        let tags = [];
        try {
          tags = row.tags ? JSON.parse(row.tags) : [];
        } catch (_) {}
        // vec0 returns a distance (lower = more similar). It may be cosine-like in ~[0, 2] or
        // L2 / other metrics >> 1. Using `max(0, 1 - d)` collapses every L2 hit to score 0.
        const raw = row.distance ?? row.DISTANCE ?? row.vec_distance;
        const distance = coerceVecDistance(raw);
        const score = distance != null ? 1 / (1 + distance) : 0;
        return {
          path: row.path ?? '',
          score,
          vec_distance: distance,
          project: row.project ?? null,
          tags: Array.isArray(tags) ? tags : [],
          date: row.date ?? null,
          text: row.chunk_text ?? null,
          _vault_id: row.vault_id || 'default',
          _entity: row.entity,
          _causal_chain_id: row.causal_chain_id,
          _episode_id: row.episode_id,
        };
      });

      const vaultWant = options.vault_id;
      if (vaultWant != null && vaultWant !== '') {
        hits = hits.filter((h) => (h._vault_id || 'default') === vaultWant);
      }

      if (options.project != null && options.project !== '') {
        hits = hits.filter((h) => h.project === options.project);
      }
      if (options.chain != null && options.chain !== '') {
        hits = hits.filter((h) => h._causal_chain_id === options.chain);
      }
      if (options.episode != null && options.episode !== '') {
        hits = hits.filter((h) => h._episode_id === options.episode);
      }
      if (options.tag != null && options.tag !== '') {
        const tag = options.tag;
        hits = hits.filter((h) => Array.isArray(h.tags) && h.tags.includes(tag));
      }
      if (options.entity != null && options.entity !== '') {
        const entity = options.entity;
        hits = hits.filter((h) => {
          let arr = [];
          try {
            arr = h._entity ? JSON.parse(h._entity) : [];
          } catch (_) {}
          return Array.isArray(arr) && arr.includes(entity);
        });
      }
      hits.forEach((h) => {
        delete h._vault_id;
        delete h._entity;
        delete h._causal_chain_id;
        delete h._episode_id;
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
      return hits.slice(0, limit);
    },

    async count() {
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (!exists) return 0;
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${TABLE_NAME}`).get();
      return row?.c ?? 0;
    },

    /**
     * Remove all indexed chunks for a Hub vault id (Phase 15 multi-vault).
     * @param {string} vaultId
     * @returns {Promise<number>} rows deleted
     */
    async deleteByVaultId(vaultId) {
      if (vaultId == null || vaultId === '') return 0;
      const vid = String(vaultId).trim();
      if (!vid) return 0;
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (!exists) return 0;
      const info = db.prepare(`DELETE FROM ${TABLE_NAME} WHERE vault_id = ?`).run(vid);
      return typeof info.changes === 'number' ? info.changes : 0;
    },

    /**
     * Read existing `(chunk_id → content_hash)` pairs for one vault. Used by
     * `hub/bridge/server.mjs POST /api/v1/index` to skip re-embedding chunks
     * whose text + metadata are unchanged since the last successful index.
     *
     * Rows that pre-date the `+content_hash` column will not appear here (the
     * `ensureCollection` migration drops + recreates such tables, so the cache
     * is always either fully populated for current rows or empty after a one-
     * time migration). Rows with an empty content_hash (theoretically possible
     * from older buggy writers) are skipped so they get re-embedded.
     *
     * @param {string} vaultId
     * @returns {Promise<Map<string, string>>} chunk_id → content_hash. Empty if collection missing.
     */
    async getChunkHashes(vaultId) {
      if (vaultId == null || vaultId === '') return new Map();
      const vid = String(vaultId).trim();
      if (!vid) return new Map();
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (!exists) return new Map();
      const rows = db
        .prepare(`SELECT chunk_id, content_hash FROM ${TABLE_NAME} WHERE vault_id = ?`)
        .all(vid);
      const out = new Map();
      for (const row of rows || []) {
        const cid = row?.chunk_id;
        const ch = row?.content_hash;
        if (typeof cid !== 'string' || cid === '') continue;
        if (typeof ch !== 'string' || ch === '') continue;
        out.set(cid, ch);
      }
      return out;
    },

    /**
     * Delete rows by their string chunk_id. Used by the bridge incremental
     * index to remove orphans (chunks that existed in the previous successful
     * index but are no longer present in the current canister export, e.g.
     * after a note was deleted or its path was renamed).
     *
     * Internally hashes each chunk_id to its integer primary key (same as
     * `upsert`), so the API surface stays string-based for callers.
     *
     * @param {string[]} chunkIds
     * @returns {Promise<number>} rows deleted
     */
    async deleteByChunkIds(chunkIds) {
      if (!Array.isArray(chunkIds) || chunkIds.length === 0) return 0;
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (!exists) return 0;
      const stmt = db.prepare(`DELETE FROM ${TABLE_NAME} WHERE id = ?`);
      let total = 0;
      const run = db.transaction((ids) => {
        for (const cid of ids) {
          if (typeof cid !== 'string' || cid === '') continue;
          const id = pointIdFromChunkId(cid);
          const info = stmt.run(id);
          if (info && typeof info.changes === 'number') total += info.changes;
        }
      });
      run(chunkIds);
      return total;
    },
  };
}
