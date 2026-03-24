/**
 * SQLite vector store tests: ensureCollection, upsert, search, count, close.
 * Uses a temp directory for the DB.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createSqliteVectorStore } from '../lib/vector-store-sqlite.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.join(__dirname, 'fixtures', 'tmp-vector-db');

describe('vector-store-sqlite', () => {
  let store;

  before(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
    fs.mkdirSync(testDataDir, { recursive: true });
    store = createSqliteVectorStore({ data_dir: testDataDir });
  });

  after(() => {
    if (store && typeof store.close === 'function') store.close();
    if (fs.existsSync(testDataDir)) {
      try {
        fs.rmSync(testDataDir, { recursive: true });
      } catch (_) {}
    }
  });

  it('ensureCollection creates table with given dimension', async () => {
    await store.ensureCollection(3);
    const count = await store.count();
    assert.strictEqual(count, 0);
  });

  it('ensureCollection throws when table exists with different dimension', async () => {
    await assert.rejects(
      () => store.ensureCollection(5),
      /dimension mismatch/
    );
  });

  it('upsert inserts points and count increases', async () => {
    await store.upsert([
      {
        id: 'path/to/a_0',
        vector: [0.1, 0.2, 0.3],
        path: 'path/to/a.md',
        project: 'p',
        date: '2025-03-01',
        tags: ['t1'],
        text: 'chunk one',
      },
      {
        id: 'path/to/b_0',
        vector: [0.4, 0.5, 0.6],
        path: 'path/to/b.md',
        project: 'p',
        date: '2025-03-02',
        tags: [],
        text: 'chunk two',
      },
    ]);
    const count = await store.count();
    assert.strictEqual(count, 2);
  });

  it('upsert same chunk id again replaces row (vec0 has no INSERT OR REPLACE)', async () => {
    await store.upsert([
      {
        id: 'path/to/a_0',
        vector: [0.11, 0.21, 0.31],
        path: 'path/to/a.md',
        project: 'p',
        date: '2025-03-01',
        tags: ['t1'],
        text: 'replaced chunk',
      },
    ]);
    const count = await store.count();
    assert.strictEqual(count, 2);
    const hits = await store.search([0.11, 0.21, 0.31], { limit: 5 });
    const a = hits.find((h) => h.path === 'path/to/a.md');
    assert(a && a.text === 'replaced chunk');
  });

  it('search returns hits with path, score, text', async () => {
    const hits = await store.search([0.15, 0.25, 0.35], { limit: 5 });
    assert(Array.isArray(hits));
    assert(hits.length >= 1);
    const first = hits[0];
    assert(first.path);
    assert(typeof first.score === 'number');
    assert(first.text != null);
  });

  it('search filters by vault_id so multi-vault indexes do not leak paths', async () => {
    const dim = 3;
    const dir = path.join(testDataDir, 'vault-filter-sub');
    fs.mkdirSync(dir, { recursive: true });
    const vStore = createSqliteVectorStore({ data_dir: dir });
    await vStore.ensureCollection(dim);
    const vA = [1, 0, 0];
    const vB = [0, 1, 0];
    await vStore.upsert([
      {
        id: 'vault-a::same_0',
        vector: vA,
        path: 'same.md',
        vault_id: 'vault-a',
        project: null,
        date: null,
        tags: [],
        text: 'alpha',
      },
      {
        id: 'vault-b::same_0',
        vector: vB,
        path: 'same.md',
        vault_id: 'vault-b',
        project: null,
        date: null,
        tags: [],
        text: 'beta',
      },
    ]);
    const forA = await vStore.search(vA, { limit: 5, vault_id: 'vault-a' });
    const forB = await vStore.search(vB, { limit: 5, vault_id: 'vault-b' });
    assert.strictEqual(forA.length, 1);
    assert.strictEqual(forA[0].text, 'alpha');
    assert.strictEqual(forB.length, 1);
    assert.strictEqual(forB[0].text, 'beta');
    const noFilter = await vStore.search(vA, { limit: 10 });
    assert.strictEqual(noFilter.length, 2);
    vStore.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('has close() method for cleanup', () => {
    assert.strictEqual(typeof store.close, 'function');
  });
});
