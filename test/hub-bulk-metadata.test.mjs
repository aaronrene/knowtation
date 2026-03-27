/**
 * Bulk delete/rename by project slug (Node Hub helpers).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { writeNote } from '../lib/write.mjs';
import { readNote } from '../lib/vault.mjs';
import { deleteNotesByProjectSlug, renameProjectSlugInVault } from '../lib/hub-bulk-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testVault = path.join(__dirname, 'fixtures', 'tmp-bulk-meta-vault');

describe('hub-bulk-metadata', () => {
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

  it('deleteNotesByProjectSlug removes notes matching project frontmatter', () => {
    writeNote(testVault, 'inbox/a.md', { body: 'a', frontmatter: { project: 'acme', title: 'A' } });
    writeNote(testVault, 'inbox/b.md', { body: 'b', frontmatter: { project: 'other', title: 'B' } });
    const { deleted, paths } = deleteNotesByProjectSlug(testVault, 'acme');
    assert.strictEqual(deleted, 1);
    assert.strictEqual(paths.length, 1);
    assert(paths.includes('inbox/a.md'));
    assert.throws(() => readNote(testVault, 'inbox/a.md'), /not found/);
    const kept = readNote(testVault, 'inbox/b.md');
    assert.strictEqual(kept.body.trim(), 'b');
  });

  it('renameProjectSlugInVault updates frontmatter project slug', () => {
    writeNote(testVault, 'inbox/r1.md', { body: 'x', frontmatter: { project: 'oldp', title: 'T' } });
    writeNote(testVault, 'inbox/r2.md', { body: 'y', frontmatter: { project: 'oldp' } });
    const { updated, paths } = renameProjectSlugInVault(testVault, 'oldp', 'newp');
    assert.strictEqual(updated, 2);
    assert.strictEqual(paths.length, 2);
    const n1 = readNote(testVault, 'inbox/r1.md');
    assert.strictEqual(n1.project, 'newp');
    const n2 = readNote(testVault, 'inbox/r2.md');
    assert.strictEqual(n2.project, 'newp');
  });

  it('deleteNotesByProjectSlug throws when project empty', () => {
    assert.throws(() => deleteNotesByProjectSlug(testVault, '   '), /project slug required/);
  });

  it('deleteNotesByProjectSlug matches path-inferred project under projects/<slug>/', () => {
    writeNote(testVault, 'projects/pathonly/inbox/z.md', { body: 'z', frontmatter: { title: 'Z' } });
    const { deleted, paths } = deleteNotesByProjectSlug(testVault, 'pathonly');
    assert.strictEqual(deleted, 1);
    assert(paths.includes('projects/pathonly/inbox/z.md'));
  });
});
