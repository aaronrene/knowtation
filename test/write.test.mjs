/**
 * Write tests: writeNote new file, update, append, path validation.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { writeNote, isInboxPath } from '../lib/write.mjs';
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

  it('writes a new note and returns path and written: true', () => {
    const result = writeNote(testVault, 'inbox/new-note.md', {
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

  it('updates existing note when body/frontmatter provided without append', () => {
    writeNote(testVault, 'inbox/update.md', { body: 'First', frontmatter: { date: '2025-01-01' } });
    const result = writeNote(testVault, 'inbox/update.md', { body: 'Second', frontmatter: { date: '2025-02-01' } });
    assert.strictEqual(result.written, true);
    const read = readNote(testVault, 'inbox/update.md');
    assert.strictEqual(read.body.trim(), 'Second');
    assert.strictEqual(read.frontmatter?.date, '2025-02-01');
  });

  it('append option appends to body', () => {
    writeNote(testVault, 'inbox/append.md', { body: 'Part one.\n\n' });
    writeNote(testVault, 'inbox/append.md', { body: 'Part two.', append: true });
    const read = readNote(testVault, 'inbox/append.md');
    assert(read.body.includes('Part one.'));
    assert(read.body.includes('Part two.'));
  });

  it('throws for path that escapes vault', () => {
    assert.throws(
      () => writeNote(testVault, '../../../etc/foo.md', { body: 'x' }),
      /Invalid path|escapes vault/
    );
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
