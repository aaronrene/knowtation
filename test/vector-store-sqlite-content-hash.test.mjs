/**
 * Tests for the `+content_hash` cache surface on `lib/vector-store-sqlite.mjs`:
 *   - upsert persists `content_hash` and `chunk_id` alongside the integer primary key
 *   - getChunkHashes(vaultId) returns Map<chunk_id, content_hash> scoped to the vault
 *   - deleteByChunkIds(chunkIds) removes rows by string chunk_id (internally hashed)
 *   - cross-vault isolation: getChunkHashes('A') never sees rows from vault B
 *   - rows with empty content_hash are skipped (defensive)
 *   - ensureCollection migration: legacy table without content_hash → drop + recreate
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { createSqliteVectorStore } from '../lib/vector-store-sqlite.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testRoot = path.join(__dirname, 'fixtures', 'tmp-content-hash');

function freshDir(name) {
  const dir = path.join(testRoot, name);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pointFor({ id, vault, vector, hash, text = 't', pathStr = 'a.md' }) {
  return {
    id,
    vector,
    text,
    path: pathStr,
    vault_id: vault,
    project: null,
    tags: [],
    date: null,
    causal_chain_id: null,
    entity: [],
    episode_id: null,
    content_hash: hash,
  };
}

describe('vector-store-sqlite — content_hash cache surface', () => {
  before(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(testRoot)) {
      try {
        fs.rmSync(testRoot, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  it('ensureCollection creates a table that includes content_hash + chunk_id columns', () => {
    const dir = freshDir('ensure');
    const store = createSqliteVectorStore({ data_dir: dir });
    return store.ensureCollection(3).then(() => {
      const db = new Database(path.join(dir, 'knowtation_vectors.db'));
      sqliteVec.load(db);
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='knowtation_vec'")
        .get();
      db.close();
      store.close();
      assert.ok(row && row.sql);
      assert.match(row.sql, /content_hash/);
      assert.match(row.sql, /chunk_id/);
    });
  });

  it('upsert persists content_hash and chunk_id; getChunkHashes returns them keyed by chunk_id', async () => {
    const dir = freshDir('upsert');
    const store = createSqliteVectorStore({ data_dir: dir });
    await store.ensureCollection(2);
    await store.upsert([
      pointFor({ id: 'vA::path/a_0', vault: 'vA', vector: [0.1, 0.2], hash: 'v1:abcd' }),
      pointFor({ id: 'vA::path/b_0', vault: 'vA', vector: [0.3, 0.4], hash: 'v1:efgh' }),
    ]);
    const hashes = await store.getChunkHashes('vA');
    assert.equal(hashes.size, 2);
    assert.equal(hashes.get('vA::path/a_0'), 'v1:abcd');
    assert.equal(hashes.get('vA::path/b_0'), 'v1:efgh');
    store.close();
  });

  it('getChunkHashes is vault-scoped (no cross-vault leak)', async () => {
    const dir = freshDir('vault-scope');
    const store = createSqliteVectorStore({ data_dir: dir });
    await store.ensureCollection(2);
    await store.upsert([
      pointFor({ id: 'vA::a_0', vault: 'vA', vector: [1, 0], hash: 'v1:aaaa' }),
      pointFor({ id: 'vB::a_0', vault: 'vB', vector: [0, 1], hash: 'v1:bbbb' }),
    ]);
    const a = await store.getChunkHashes('vA');
    const b = await store.getChunkHashes('vB');
    assert.equal(a.size, 1);
    assert.equal(a.get('vA::a_0'), 'v1:aaaa');
    assert.equal(b.size, 1);
    assert.equal(b.get('vB::a_0'), 'v1:bbbb');
    store.close();
  });

  it('getChunkHashes returns empty Map when collection is missing or vaultId is empty', async () => {
    const dir = freshDir('empty');
    const store = createSqliteVectorStore({ data_dir: dir });
    const empty = await store.getChunkHashes('vA');
    assert.equal(empty.size, 0);
    await store.ensureCollection(2);
    const stillEmpty = await store.getChunkHashes('');
    assert.equal(stillEmpty.size, 0);
    const stillEmpty2 = await store.getChunkHashes(null);
    assert.equal(stillEmpty2.size, 0);
    store.close();
  });

  it('rows written without content_hash are skipped by getChunkHashes (defensive)', async () => {
    const dir = freshDir('no-hash');
    const store = createSqliteVectorStore({ data_dir: dir });
    await store.ensureCollection(2);
    await store.upsert([
      pointFor({ id: 'vA::with_0', vault: 'vA', vector: [1, 0], hash: 'v1:has' }),
      pointFor({ id: 'vA::without_0', vault: 'vA', vector: [0, 1], hash: undefined }),
    ]);
    const hashes = await store.getChunkHashes('vA');
    assert.equal(hashes.size, 1);
    assert.equal(hashes.get('vA::with_0'), 'v1:has');
    assert.equal(hashes.has('vA::without_0'), false);
    store.close();
  });

  it('deleteByChunkIds removes the named rows and returns the deleted count', async () => {
    const dir = freshDir('delete');
    const store = createSqliteVectorStore({ data_dir: dir });
    await store.ensureCollection(2);
    await store.upsert([
      pointFor({ id: 'vA::keep_0', vault: 'vA', vector: [1, 0], hash: 'v1:k' }),
      pointFor({ id: 'vA::drop_0', vault: 'vA', vector: [0, 1], hash: 'v1:d1' }),
      pointFor({ id: 'vA::drop_1', vault: 'vA', vector: [1, 1], hash: 'v1:d2' }),
    ]);
    assert.equal(await store.count(), 3);
    const deleted = await store.deleteByChunkIds(['vA::drop_0', 'vA::drop_1']);
    assert.equal(deleted, 2);
    assert.equal(await store.count(), 1);
    const hashes = await store.getChunkHashes('vA');
    assert.equal(hashes.size, 1);
    assert.ok(hashes.has('vA::keep_0'));
    store.close();
  });

  it('deleteByChunkIds returns 0 for empty/invalid input and missing collection', async () => {
    const dir = freshDir('delete-empty');
    const store = createSqliteVectorStore({ data_dir: dir });
    assert.equal(await store.deleteByChunkIds([]), 0);
    assert.equal(await store.deleteByChunkIds(null), 0);
    await store.ensureCollection(2);
    assert.equal(await store.deleteByChunkIds(['', null, undefined]), 0);
    store.close();
  });

  it('ensureCollection migrates a legacy table that lacks content_hash by dropping + recreating', async () => {
    const dir = freshDir('migrate');
    const dbPath = path.join(dir, 'knowtation_vectors.db');
    // Hand-build a legacy table without content_hash/chunk_id (mirrors pre-PR schema).
    const db = new Database(dbPath);
    sqliteVec.load(db);
    db.exec(`CREATE VIRTUAL TABLE knowtation_vec USING vec0(
      id INTEGER PRIMARY KEY,
      embedding FLOAT[2],
      path TEXT,
      project TEXT,
      date TEXT,
      causal_chain_id TEXT,
      episode_id TEXT,
      +vault_id TEXT,
      +tags TEXT,
      +entity TEXT,
      +chunk_text TEXT
    )`);
    db.close();
    const store = createSqliteVectorStore({ data_dir: dir });
    await store.ensureCollection(2);
    // After migration, getChunkHashes works without throwing (column now exists).
    const hashes = await store.getChunkHashes('vA');
    assert.equal(hashes.size, 0);
    // And new upserts populate content_hash correctly.
    await store.upsert([
      pointFor({ id: 'vA::x_0', vault: 'vA', vector: [1, 0], hash: 'v1:xxxx' }),
    ]);
    const after = await store.getChunkHashes('vA');
    assert.equal(after.get('vA::x_0'), 'v1:xxxx');
    store.close();
  });
});
