/**
 * Search tests: createVectorStore with sqlite-vec, runSearch requires embed (tested via vector-store-sqlite).
 * This file tests that runSearch returns the expected shape when given a pre-embedded vector path
 * by testing the vector store integration only. Full search (embed + store) is covered by manual test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createVectorStore } from '../lib/vector-store.mjs';
import { loadConfig } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('createVectorStore (sqlite-vec)', () => {
  it('returns store with search and count when vector_store is sqlite-vec', async () => {
    const config = loadConfig(fixturesDir);
    const configSqlite = {
      ...config,
      vector_store: 'sqlite-vec',
      data_dir: path.join(fixturesDir, 'data'),
    };
    const store = await createVectorStore(configSqlite);
    assert.strictEqual(typeof store.search, 'function');
    assert.strictEqual(typeof store.count, 'function');
    assert.strictEqual(typeof store.ensureCollection, 'function');
    assert.strictEqual(typeof store.upsert, 'function');
    if (typeof store.close === 'function') store.close();
  });
});
