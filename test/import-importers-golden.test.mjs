/**
 * Golden import tests: synthetic fixtures → vault notes with expected SPEC-aligned frontmatter.
 * Skips notion (live API), audio/video (Whisper + OPENAI_API_KEY).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runImport } from '../lib/import.mjs';
import { readNote } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, 'fixtures', 'import');
const fixtureMarkdown = path.join(__dirname, 'fixtures', 'markdown-import', 'simple.md');
const testVault = path.join(__dirname, 'fixtures', 'tmp-import-golden-vault');

function assertIsoDate(value) {
  assert(typeof value === 'string' && value.length >= 10, `expected date-like string, got ${value}`);
}

describe('import golden fixtures', () => {
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

  it('markdown', async () => {
    const result = await runImport('markdown', fixtureMarkdown, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-md',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'markdown');
    assertIsoDate(String(note.frontmatter.date || ''));
  });

  it('chatgpt-export', async () => {
    const input = path.join(fixturesRoot, 'chatgpt-export');
    const result = await runImport('chatgpt-export', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-chatgpt',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'chatgpt');
    assert.strictEqual(note.frontmatter.title, 'Fixture conversation');
    assert.ok(String(note.frontmatter.source_id || '').startsWith('chatgpt_'));
    assertIsoDate(String(note.frontmatter.date || ''));
    assert(note.body.includes('Fixture user line'));
  });

  it('claude-export (JSON)', async () => {
    const input = path.join(fixturesRoot, 'claude-export', 'sample.json');
    const result = await runImport('claude-export', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-claude',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'claude');
    assert.strictEqual(note.frontmatter.title, 'Fixture Claude note');
    assert.strictEqual(note.frontmatter.source_id, 'claude-fix-1');
    assert.strictEqual(note.frontmatter.date, '2024-01-15');
    assert(note.body.includes('Fixture body'));
  });

  it('mem0-export', async () => {
    const input = path.join(fixturesRoot, 'mem0-export', 'sample.json');
    const result = await runImport('mem0-export', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-mem0',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'mem0');
    assert.strictEqual(note.frontmatter.source_id, 'mem0-fix-1');
    assert(note.body.includes('Synthetic Mem0'));
  });

  it('mif', async () => {
    const input = path.join(fixturesRoot, 'mif', 'sample.memory.md');
    const result = await runImport('mif', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-mif',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'mif');
    assert.strictEqual(note.frontmatter.source_id, 'mif-fix-1');
    assert(note.body.includes('MIF import golden'));
  });

  it('jira-export', async () => {
    const input = path.join(fixturesRoot, 'jira-export', 'issues.csv');
    const result = await runImport('jira-export', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-jira',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'jira');
    assert.strictEqual(note.frontmatter.source_id, 'PROJ-1');
    assert.strictEqual(note.frontmatter.title, 'Fixture Jira issue');
    assertIsoDate(String(note.frontmatter.date || ''));
  });

  it('linear-export', async () => {
    const input = path.join(fixturesRoot, 'linear-export', 'issues.csv');
    const result = await runImport('linear-export', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-linear',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'linear');
    assert.strictEqual(note.frontmatter.source_id, 'LIN-1');
    assertIsoDate(String(note.frontmatter.date || ''));
    assert(note.body.includes('Fixture Linear'));
  });

  it('notebooklm (JSON)', async () => {
    const input = path.join(fixturesRoot, 'notebooklm', 'sample.json');
    const result = await runImport('notebooklm', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-nblm',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'notebooklm');
    assert.strictEqual(note.frontmatter.source_id, 'nb-fix-1');
    assert(note.body.includes('NotebookLM'));
  });

  it('gdrive (folder of md)', async () => {
    const input = path.join(fixturesRoot, 'gdrive');
    const result = await runImport('gdrive', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-gdrive',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'gdrive');
    assert.strictEqual(note.frontmatter.source_id, 'doc1');
    assert(note.body.includes('Synthetic Google Drive'));
  });
});
