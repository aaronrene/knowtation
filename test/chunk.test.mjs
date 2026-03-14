/**
 * Chunk tests: chunkNote produces stable ids, metadata on each chunk, split by heading/size.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkNote, stableChunkId } from '../lib/chunk.mjs';

describe('chunkNote', () => {
  it('returns chunks with id, text, path, project, tags, date', () => {
    const note = {
      body: '# First\n\nParagraph one.\n\n## Second\n\nParagraph two.',
      path: 'inbox/one.md',
      project: 'foo',
      tags: ['a', 'b'],
      date: '2025-03-01',
    };
    const chunks = chunkNote(note);
    assert(Array.isArray(chunks));
    assert(chunks.length >= 1);
    for (const c of chunks) {
      assert.strictEqual(typeof c.id, 'string');
      assert(c.id.length > 0);
      assert.strictEqual(c.path, 'inbox/one.md');
      assert.strictEqual(c.project, 'foo');
      assert.deepStrictEqual(c.tags, ['a', 'b']);
      assert.strictEqual(c.date, '2025-03-01');
      assert.strictEqual(typeof c.text, 'string');
    }
  });

  it('produces stable chunk ids for same path and index', () => {
    const id1 = stableChunkId('inbox/foo.md', 0);
    const id2 = stableChunkId('inbox/foo.md', 0);
    assert.strictEqual(id1, id2);
    assert.notStrictEqual(stableChunkId('inbox/foo.md', 1), id1);
    assert.notStrictEqual(stableChunkId('inbox/bar.md', 0), id1);
  });

  it('splits by heading when possible', () => {
    const note = {
      body: '## A\n\nText A.\n\n## B\n\nText B.',
      path: 'p.md',
    };
    const chunks = chunkNote(note);
    assert(chunks.length >= 2);
    assert(chunks.some((c) => c.text.includes('Text A')));
    assert(chunks.some((c) => c.text.includes('Text B')));
  });

  it('respects chunkSize option for long content', () => {
    const long = 'x'.repeat(3000);
    const note = { body: long, path: 'p.md' };
    const chunks = chunkNote(note, { chunkSize: 500, chunkOverlap: 50 });
    assert(chunks.length >= 2);
    chunks.forEach((c) => assert(c.text.length <= 600));
  });
});
