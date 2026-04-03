/**
 * Write tests: writeNote new file, update, append, path validation.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  writeNote,
  deleteNote,
  isInboxPath,
  normalizePathPrefix,
  notePathMatchesPrefix,
  deleteNotesByPrefix,
} from '../lib/write.mjs';
import { readNote } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testVault = path.join(__dirname, 'fixtures', 'tmp-write-vault');

describe('writeNote', () => {
  before(() => {
    if (fs.existsSync(testVault)) fs.rmSync(testVault, { recursive: true });
    fs.mkdirSync(testVault, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(testVault)) {
      try {
        fs.rmSync(testVault, { recursive: true });
      } catch (_) {}
    }
  });

  it('writes a new note and returns path and written: true', async () => {
    const result = await writeNote(testVault, 'inbox/new-note.md', {
      body: '# New\n\nContent.',
      frontmatter: { title: 'New Note', date: '2025-03-12' },
    });
    assert.strictEqual(result.path, 'inbox/new-note.md');
    assert.strictEqual(result.written, true);
    const read = readNote(testVault, 'inbox/new-note.md');
    assert(read.body.includes('New'));
    assert(read.body.includes('Content.'));
    assert.strictEqual(read.frontmatter?.title, 'New Note');
  });

  it('updates existing note when body/frontmatter provided without append', async () => {
    await writeNote(testVault, 'inbox/update.md', { body: 'First', frontmatter: { date: '2025-01-01' } });
    const result = await writeNote(testVault, 'inbox/update.md', { body: 'Second', frontmatter: { date: '2025-02-01' } });
    assert.strictEqual(result.written, true);
    const read = readNote(testVault, 'inbox/update.md');
    assert.strictEqual(read.body.trim(), 'Second');
    assert.strictEqual(read.frontmatter?.date, '2025-02-01');
  });

  it('append option appends to body', async () => {
    await writeNote(testVault, 'inbox/append.md', { body: 'Part one.\n\n' });
    await writeNote(testVault, 'inbox/append.md', { body: 'Part two.', append: true });
    const read = readNote(testVault, 'inbox/append.md');
    assert(read.body.includes('Part one.'));
    assert(read.body.includes('Part two.'));
  });

  it('throws for path that escapes vault', async () => {
    await assert.rejects(
      () => writeNote(testVault, '../../../etc/foo.md', { body: 'x' }),
      /Invalid path|escapes vault/
    );
  });
});

describe('deleteNote', () => {
  before(() => {
    if (fs.existsSync(testVault)) fs.rmSync(testVault, { recursive: true });
    fs.mkdirSync(testVault, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(testVault)) {
      try {
        fs.rmSync(testVault, { recursive: true });
      } catch (_) {}
    }
  });

  it('removes an existing file and returns path and deleted: true', async () => {
    await writeNote(testVault, 'inbox/to-delete.md', { body: 'x', frontmatter: { date: '2025-01-01' } });
    const result = deleteNote(testVault, 'inbox/to-delete.md');
    assert.strictEqual(result.path, 'inbox/to-delete.md');
    assert.strictEqual(result.deleted, true);
    assert.throws(() => readNote(testVault, 'inbox/to-delete.md'), /not found/);
  });

  it('throws for missing note', () => {
    assert.throws(() => deleteNote(testVault, 'inbox/missing.md'), /not found/);
  });

  it('throws for path that escapes vault', () => {
    assert.throws(
      () => deleteNote(testVault, '../../../etc/passwd'),
      /Invalid path|escapes vault/
    );
  });
});

describe('deleteNotesByPrefix', () => {
  before(() => {
    if (fs.existsSync(testVault)) fs.rmSync(testVault, { recursive: true });
    fs.mkdirSync(testVault, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(testVault)) {
      try {
        fs.rmSync(testVault, { recursive: true });
      } catch (_) {}
    }
  });

  it('normalizePathPrefix trims and rejects unsafe segments', () => {
    assert.strictEqual(normalizePathPrefix('  projects/foo  '), 'projects/foo');
    assert.strictEqual(normalizePathPrefix('projects/foo/'), 'projects/foo');
    assert.throws(() => normalizePathPrefix(''), /path_prefix/);
    assert.throws(() => normalizePathPrefix('..'), /Invalid/);
    assert.throws(() => normalizePathPrefix('a/./b'), /Invalid/);
  });

  it('notePathMatchesPrefix matches exact path or children only', () => {
    assert.strictEqual(notePathMatchesPrefix('projects/foo', 'projects/foo'), true);
    assert.strictEqual(notePathMatchesPrefix('projects/foo/bar.md', 'projects/foo'), true);
    assert.strictEqual(notePathMatchesPrefix('projects/foobar/x.md', 'projects/foo'), false);
    assert.strictEqual(notePathMatchesPrefix('other/foo.md', 'projects/foo'), false);
  });

  it('deletes all .md under prefix and returns paths', async () => {
    await writeNote(testVault, 'projects/p1/a.md', { body: 'a' });
    await writeNote(testVault, 'projects/p1/sub/b.md', { body: 'b' });
    await writeNote(testVault, 'projects/p2/keep.md', { body: 'k' });
    const { deleted, paths } = deleteNotesByPrefix(testVault, 'projects/p1');
    assert.strictEqual(deleted, 2);
    assert.strictEqual(paths.length, 2);
    assert(paths.includes('projects/p1/a.md'));
    assert(paths.includes('projects/p1/sub/b.md'));
    assert.throws(() => readNote(testVault, 'projects/p1/a.md'), /not found/);
    const kept = readNote(testVault, 'projects/p2/keep.md');
    assert.strictEqual(kept.body.trim(), 'k');
  });
});

describe('isInboxPath', () => {
  it('returns true for inbox and inbox/...', () => {
    assert.strictEqual(isInboxPath('inbox'), true);
    assert.strictEqual(isInboxPath('inbox/foo.md'), true);
  });
  it('returns true for projects/x/inbox/...', () => {
    assert.strictEqual(isInboxPath('projects/foo/inbox/bar.md'), true);
  });
  it('returns false for other paths', () => {
    assert.strictEqual(isInboxPath('projects/foo/note.md'), false);
    assert.strictEqual(isInboxPath('other/foo.md'), false);
  });
});
