/**
 * Keyword search: phrase, all_terms, folder, content_scope.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';
import { runKeywordSearch, keywordSearchNotesArray, noteRecordFromExportPayload } from '../lib/keyword-search.mjs';
import { filterNotesByListOptions } from '../lib/list-notes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('runKeywordSearch', () => {
  const envBackup = {
    KNOWTATION_VAULT_PATH: process.env.KNOWTATION_VAULT_PATH,
    KNOWTATION_DATA_DIR: process.env.KNOWTATION_DATA_DIR,
  };
  const fixtureVaultAbs = path.join(fixturesDir, 'vault-fs');
  let config;
  before(() => {
    process.env.KNOWTATION_VAULT_PATH = fixtureVaultAbs;
    delete process.env.KNOWTATION_DATA_DIR;
    config = loadConfig(fixturesDir);
  });
  after(() => {
    if (envBackup.KNOWTATION_VAULT_PATH !== undefined) {
      process.env.KNOWTATION_VAULT_PATH = envBackup.KNOWTATION_VAULT_PATH;
    } else {
      delete process.env.KNOWTATION_VAULT_PATH;
    }
    if (envBackup.KNOWTATION_DATA_DIR !== undefined) {
      process.env.KNOWTATION_DATA_DIR = envBackup.KNOWTATION_DATA_DIR;
    } else {
      delete process.env.KNOWTATION_DATA_DIR;
    }
  });

  it('matches phrase in body (case-insensitive)', async () => {
    const out = await runKeywordSearch('inbox one', {}, config);
    assert.strictEqual(out.mode, 'keyword');
    const paths = (out.results || []).map((r) => r.path);
    assert(paths.includes('inbox/one.md'));
  });

  it('matches all_terms (AND)', async () => {
    const out = await runKeywordSearch('inbox two', { match: 'all_terms' }, config);
    const paths = (out.results || []).map((r) => r.path);
    assert(paths.includes('inbox/two.md'));
  });

  it('matches phrase in title frontmatter', async () => {
    const out = await runKeywordSearch('Project note', {}, config);
    const paths = (out.results || []).map((r) => r.path);
    assert(paths.includes('projects/foo/note.md'));
  });

  it('filters by folder', async () => {
    const out = await runKeywordSearch('Body', { folder: 'inbox' }, config);
    const paths = (out.results || []).map((r) => r.path);
    assert(paths.every((p) => p === 'inbox' || p.startsWith('inbox/')));
    assert(!paths.some((p) => p.startsWith('projects/')));
  });

  it('content_scope notes excludes approval logs', async () => {
    const all = await runKeywordSearch('approvaluniquekeyword', {}, config);
    assert((all.results || []).some((r) => r.path.startsWith('approvals/')));
    const notesOnly = await runKeywordSearch('approvaluniquekeyword', { content_scope: 'notes' }, config);
    assert(!(notesOnly.results || []).some((r) => r.path.startsWith('approvals/')));
  });

  it('countOnly returns count', async () => {
    const out = await runKeywordSearch('Body', { countOnly: true }, config);
    assert.strictEqual(out.mode, 'keyword');
    assert(typeof out.count === 'number');
    assert.strictEqual(out.results, undefined);
  });
});

describe('keywordSearchNotesArray + export payload', () => {
  it('noteRecordFromExportPayload parses frontmatter JSON string', () => {
    const rec = noteRecordFromExportPayload({
      path: 'x.md',
      body: 'hello',
      frontmatter: JSON.stringify({ title: 'T', tags: ['z'], project: 'p' }),
    });
    assert.strictEqual(rec.path, 'x.md');
    assert.strictEqual(rec.body, 'hello');
    assert.strictEqual(rec.frontmatter.title, 'T');
  });

  it('filters export-shaped notes like list-notes', () => {
    const raw = [
      { path: 'inbox/a.md', body: 'alpha beta', frontmatter: '{}' },
      { path: 'projects/foo/b.md', body: 'alpha only here', frontmatter: '{}' },
    ];
    const notes = raw.map(noteRecordFromExportPayload);
    const filtered = filterNotesByListOptions(notes, { folder: 'inbox' });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].path, 'inbox/a.md');
    const out = keywordSearchNotesArray(filtered, 'alpha beta', { limit: 10 });
    assert.strictEqual(out.results?.length, 1);
  });
});
