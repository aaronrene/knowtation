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

const TABLE_NAME = 'knowtation_vec';
const DB_FILENAME = 'knowtation_vectors.db';

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
 * @returns {{ ensureCollection: (dimension: number) => Promise<void>, upsert: (points) => Promise<void>, search: (queryVector: number[], options) => Promise<{ path, score, project, tags, date, text }[]>, count: () => Promise<number> }}
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
        return;
      }
      // vec0: id integer primary key, embedding float[dim], metadata columns, +auxiliary
      const sql = `CREATE VIRTUAL TABLE ${TABLE_NAME} USING vec0(
        id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimension}],
        path TEXT,
        project TEXT,
        date TEXT,
        causal_chain_id TEXT,
        episode_id TEXT,
        +tags TEXT,
        +entity TEXT,
        +chunk_text TEXT
      )`;
      db.exec(sql);
    },

    async upsert(points) {
      if (!points.length) return;
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
          db.exec(
            `INSERT OR REPLACE INTO ${TABLE_NAME} (id, embedding, path, project, date, causal_chain_id, episode_id, tags, entity, chunk_text) VALUES (${id}, '${embeddingStr}', ${esc(p.path)}, ${esc(p.project)}, ${esc(p.date)}, ${esc(p.causal_chain_id)}, ${esc(p.episode_id)}, ${esc(tagsStr)}, ${esc(entityStr)}, ${esc(p.text)})`
          );
        }
      });
      run(points);
    },

    async search(queryVector, options = {}) {
      const limit = Math.min(options.limit ?? 10, 100);
      const fetchLimit = options.folder || options.since || options.until || options.tag || options.entity
        ? Math.min(limit * 3, 300)
        : limit;

      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(TABLE_NAME);
      if (!exists) {
        throw new Error('Vector store collection not found. Run "knowtation index" first to index your vault.');
      }

      const vecStr = JSON.stringify(Array.from(queryVector));
      // vec0 KNN: one binding for the vector; k as literal to avoid binding order issues.
      const stmt = db.prepare(`
        SELECT id, path, project, date, causal_chain_id, episode_id, tags, entity, chunk_text, distance
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
        const distance = typeof row.distance === 'number' ? row.distance : 0;
        const score = Math.max(0, 1 - distance);
        return {
          path: row.path ?? '',
          score,
          project: row.project ?? null,
          tags: Array.isArray(tags) ? tags : [],
          date: row.date ?? null,
          text: row.chunk_text ?? null,
          _entity: row.entity,
          _causal_chain_id: row.causal_chain_id,
          _episode_id: row.episode_id,
        };
      });

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
  };
}
