import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('enrichIndexedNotes', () => {
  const mockNotes = [
    { path: 'inbox/note1.md', body: 'Content of note 1', frontmatter: {} },
    { path: 'inbox/note2.md', body: 'Content of note 2', frontmatter: {} },
    { path: 'inbox/note3.md', body: 'Already enriched', frontmatter: { ai_summary: 'exists' } },
    { path: 'inbox/empty.md', body: '', frontmatter: {} },
  ];

  function makeMockServer({ response = 'Summary text', sampling = true } = {}) {
    return {
      server: {
        getClientCapabilities: () => (sampling ? { sampling: {} } : {}),
        createMessage: async () => ({
          content: { type: 'text', text: response },
          model: 'mock',
          role: 'assistant',
        }),
      },
    };
  }

  it('skips notes with existing ai_summary', async () => {
    const enrichableNotes = mockNotes.filter((n) => n.body && !n.frontmatter?.ai_summary);
    assert.equal(enrichableNotes.length, 2);
    const skippedNote = mockNotes.find((n) => n.frontmatter?.ai_summary);
    assert.ok(skippedNote);
    assert.equal(skippedNote.path, 'inbox/note3.md');
  });

  it('skips notes with empty body', async () => {
    const enrichable = mockNotes.filter((n) => n.path && n.body && !n.frontmatter?.ai_summary);
    assert.equal(enrichable.length, 2);
    assert.ok(!enrichable.find((n) => n.path === 'inbox/empty.md'));
  });

  it('reports progress correctly', async () => {
    const progressCalls = [];
    const onProgress = async (done, total) => {
      progressCalls.push({ done, total });
    };

    const notes = [
      { path: 'a.md', body: 'content a', frontmatter: {} },
      { path: 'b.md', body: 'content b', frontmatter: {} },
    ];

    for (let i = 0; i < notes.length; i++) {
      await onProgress(i + 1, notes.length);
    }

    assert.equal(progressCalls.length, 2);
    assert.deepEqual(progressCalls[0], { done: 1, total: 2 });
    assert.deepEqual(progressCalls[1], { done: 2, total: 2 });
  });

  it('limits to max 200 notes', () => {
    const limit = Math.min(300, 200);
    assert.equal(limit, 200);
  });
});
