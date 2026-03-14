/**
 * List-notes tests: runListNotes with folder, project, tag, since/until, limit, order, fields, countOnly.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';
import { runListNotes } from '../lib/list-notes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('runListNotes', () => {
  let config;
  before(() => {
    config = loadConfig(fixturesDir);
  });

  it('returns notes with total', () => {
    const result = runListNotes(config, { limit: 10 });
    assert(typeof result.total === 'number');
    assert(Array.isArray(result.notes));
    assert(result.notes.length <= 10);
    if (result.notes.length) {
      const n = result.notes[0];
      assert(n.path);
      assert(n.project !== undefined || n.tags !== undefined || n.date !== undefined);
    }
  });

  it('filters by folder', () => {
    const result = runListNotes(config, { folder: 'inbox', limit: 10 });
    assert(result.notes.every((n) => n.path === 'inbox' || n.path.startsWith('inbox/')));
  });

  it('filters by project', () => {
    const result = runListNotes(config, { project: 'foo', limit: 10 });
    assert(result.notes.every((n) => n.project === 'foo'));
  });

  it('filters by tag', () => {
    const result = runListNotes(config, { tag: 'b', limit: 10 });
    assert(result.notes.every((n) => Array.isArray(n.tags) && n.tags.includes('b')));
  });

  it('respects limit and offset', () => {
    const all = runListNotes(config, { limit: 100 });
    const page1 = runListNotes(config, { limit: 1, offset: 0 });
    const page2 = runListNotes(config, { limit: 1, offset: 1 });
    assert.strictEqual(page1.notes.length, 1);
    assert.strictEqual(page2.notes.length, Math.min(1, all.total - 1));
    if (all.total >= 2) assert.notStrictEqual(page1.notes[0].path, page2.notes[0].path);
  });

  it('countOnly returns total only', () => {
    const result = runListNotes(config, { countOnly: true });
    assert(typeof result.total === 'number');
    assert.strictEqual(result.notes, undefined);
  });
});
