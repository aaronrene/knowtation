/**
 * Vault tests: listMarkdownFiles, readNote, parseFrontmatterAndBody, resolveVaultRelativePath, noteFileExistsInVault, normalizeSlug, normalizeTags.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listMarkdownFiles,
  readNote,
  parseFrontmatterAndBody,
  resolveVaultRelativePath,
  normalizeSlug,
  normalizeTags,
  noteFileExistsInVault,
  listVaultFolderOptions,
} from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.join(__dirname, 'fixtures', 'vault-fs');

describe('vault', () => {
  describe('listMarkdownFiles', () => {
    it('returns vault-relative paths for all .md files', () => {
      const paths = listMarkdownFiles(vaultPath);
      assert(Array.isArray(paths));
      assert(paths.length >= 3);
      assert(paths.some((p) => p === 'inbox/one.md'));
      assert(paths.some((p) => p === 'inbox/two.md'));
      assert(paths.some((p) => p === 'projects/foo/note.md'));
      paths.forEach((p) => assert(!p.includes('\\')));
    });

    it('respects ignore option', () => {
      const paths = listMarkdownFiles(vaultPath, { ignore: ['inbox'] });
      assert(!paths.some((p) => p.startsWith('inbox/')));
      assert(paths.some((p) => p === 'projects/foo/note.md'));
    });
  });

  describe('readNote', () => {
    it('returns parsed note with path, project, tags, date', () => {
      const note = readNote(vaultPath, 'inbox/one.md');
      assert.strictEqual(note.path, 'inbox/one.md');
      assert.strictEqual(note.project, 'foo');
      assert.deepStrictEqual(note.tags, ['a', 'b']);
      assert(note.date && note.date.startsWith('2025'));
      assert(note.body && note.body.includes('Inbox one'));
    });

    it('throws for path that escapes vault', () => {
      assert.throws(
        () => readNote(vaultPath, '../../../etc/passwd'),
        /Invalid path|escapes vault/
      );
    });

    it('throws for non-existent file', () => {
      assert.throws(
        () => readNote(vaultPath, 'inbox/nonexistent.md'),
        /Note not found/
      );
    });
  });

  describe('parseFrontmatterAndBody', () => {
    it('parses YAML frontmatter and body', () => {
      const content = '---\ntitle: Hi\ndate: 2025-01-01\n---\n\n# Hello';
      const { frontmatter, body } = parseFrontmatterAndBody(content);
      assert.strictEqual(frontmatter.title, 'Hi');
      const dateStr = frontmatter.date instanceof Date ? frontmatter.date.toISOString().slice(0, 10) : String(frontmatter.date);
      assert.strictEqual(dateStr.slice(0, 10), '2025-01-01');
      assert.strictEqual(body.trim(), '# Hello');
    });

    it('returns empty frontmatter when no fence', () => {
      const { frontmatter, body } = parseFrontmatterAndBody('# No frontmatter');
      assert.deepStrictEqual(frontmatter, {});
      assert.strictEqual(body.trim(), '# No frontmatter');
    });
  });

  describe('resolveVaultRelativePath', () => {
    it('normalizes and returns vault-relative path', () => {
      const out = resolveVaultRelativePath(vaultPath, 'inbox/foo.md');
      assert.strictEqual(out, 'inbox/foo.md');
    });

    it('rejects path that escapes vault', () => {
      assert.throws(
        () => resolveVaultRelativePath(vaultPath, '../other/foo.md'),
        /Invalid path|escapes vault/
      );
    });

    it('rejects absolute path', () => {
      assert.throws(
        () => resolveVaultRelativePath(vaultPath, '/tmp/foo.md'),
        /Invalid path/
      );
    });
  });

  describe('noteFileExistsInVault', () => {
    it('returns true for an existing note path', () => {
      assert.strictEqual(noteFileExistsInVault(vaultPath, 'inbox/one.md'), true);
    });

    it('returns false for missing file', () => {
      assert.strictEqual(noteFileExistsInVault(vaultPath, 'inbox/ghost.md'), false);
    });

    it('returns false for empty or invalid input', () => {
      assert.strictEqual(noteFileExistsInVault(vaultPath, ''), false);
      assert.strictEqual(noteFileExistsInVault(vaultPath, '   '), false);
      assert.strictEqual(noteFileExistsInVault(vaultPath, null), false);
    });

    it('returns false for escape paths without throwing', () => {
      assert.strictEqual(noteFileExistsInVault(vaultPath, '../../../etc/passwd'), false);
    });
  });

  describe('listVaultFolderOptions', () => {
    it('returns inbox first then top-level and projects/* subdirs sorted', () => {
      const root = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'tmp-vault-folders-'));
      try {
        fs.mkdirSync(path.join(root, 'inbox'));
        fs.mkdirSync(path.join(root, 'media'));
        fs.mkdirSync(path.join(root, 'projects', 'born-free'), { recursive: true });
        const o = listVaultFolderOptions(root);
        assert.deepStrictEqual(o, ['inbox', 'media', 'projects', 'projects/born-free']);
      } finally {
        try {
          fs.rmSync(root, { recursive: true });
        } catch (_) {}
      }
    });

    it('returns at least inbox for missing path', () => {
      assert.deepStrictEqual(listVaultFolderOptions('/no/such/vault/path'), ['inbox']);
    });
  });

  describe('normalizeSlug', () => {
    it('lowercases and keeps only a-z0-9 and hyphen', () => {
      assert.strictEqual(normalizeSlug('Foo Bar'), 'foo-bar');
      assert.strictEqual(normalizeSlug('  xYz  '), 'xyz');
    });
  });

  describe('normalizeTags', () => {
    it('accepts array and returns normalized array', () => {
      assert.deepStrictEqual(normalizeTags(['A', 'b']), ['a', 'b']);
    });
    it('accepts comma-sep string', () => {
      assert.deepStrictEqual(normalizeTags('x, Y'), ['x', 'y']);
    });
  });
});
