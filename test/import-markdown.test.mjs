/**
 * Markdown importer tests: importMarkdown with file and folder, dryRun, project/tags.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { importMarkdown } from '../lib/importers/markdown.mjs';
import { readNote } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureMd = path.join(__dirname, 'fixtures', 'markdown-import', 'simple.md');
const testVault = path.join(__dirname, 'fixtures', 'tmp-import-vault');

describe('importMarkdown', () => {
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

  it('imports a single file and returns imported paths', async () => {
    const ctx = {
      vaultPath: testVault,
      outputBase: 'imports/md',
      project: null,
      tags: [],
      dryRun: false,
    };
    const result = await importMarkdown(fixtureMd, ctx);
    assert(Array.isArray(result.imported));
    assert.strictEqual(result.count, 1);
    assert(result.imported[0].path.includes('simple.md'));
    const note = readNote(testVault, result.imported[0].path);
    assert(note.body.includes('Imported note'));
    assert(note.frontmatter?.source === 'markdown');
    assert(note.frontmatter?.date);
  });

  it('dryRun does not write files', async () => {
    const ctx = {
      vaultPath: testVault,
      outputBase: 'imports/dry',
      project: null,
      tags: [],
      dryRun: true,
    };
    const result = await importMarkdown(fixtureMd, ctx);
    assert.strictEqual(result.count, 1);
    const outPath = path.join(testVault, 'imports/dry/simple.md');
    assert(!fs.existsSync(outPath));
  });

  it('merges project and tags when provided', async () => {
    const ctx = {
      vaultPath: testVault,
      outputBase: 'imports/tagged',
      project: 'myproject',
      tags: ['imported', 'test'],
      dryRun: false,
    };
    const result = await importMarkdown(fixtureMd, ctx);
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.project, 'myproject');
    assert(Array.isArray(note.tags));
    assert(note.tags.includes('imported'));
    assert(note.tags.includes('test'));
  });

  it('throws when input path does not exist', async () => {
    const ctx = {
      vaultPath: testVault,
      outputBase: 'imports',
      project: null,
      tags: [],
      dryRun: false,
    };
    await assert.rejects(
      () => importMarkdown(path.join(__dirname, 'fixtures', 'nonexistent.md'), ctx),
      /Input not found/
    );
  });

  it('discovers .markdown and case variants of .md when importing a folder (ZIP extract parity)', async () => {
    const srcDir = path.join(testVault, 'src-mixed-md-ext');
    fs.mkdirSync(path.join(srcDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'nested', 'Note.MD'), '# From upper\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'readme.markdown'), '# Readme markdown ext\n', 'utf8');
    const ctx = {
      vaultPath: testVault,
      outputBase: 'imports/mixed-ext',
      project: null,
      tags: [],
      dryRun: false,
    };
    const result = await importMarkdown(srcDir, ctx);
    assert.strictEqual(result.count, 2);
    const basenames = result.imported.map((x) => path.basename(x.path)).sort();
    assert.deepStrictEqual(basenames, ['Note.MD', 'readme.markdown']);
  });
});
