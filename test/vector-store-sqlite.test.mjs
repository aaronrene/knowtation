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

  it('search returns hits with path, score, text', async () => {
    const hits = await store.search([0.15, 0.25, 0.35], { limit: 5 });
    assert(Array.isArray(hits));
    assert(hits.length >= 1);
    const first = hits[0];
    assert(first.path);
    assert(typeof first.score === 'number');
    assert(first.text != null);
  });

  it('has close() method for cleanup', () => {
    assert.strictEqual(typeof store.close, 'function');
  });
});
