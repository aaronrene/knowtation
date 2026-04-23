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
const fixturePdf = path.join(__dirname, 'fixtures', 'pdf-import', 'hello.pdf');
const fixtureDocx = path.join(__dirname, 'fixtures', 'docx-import', 'hello.docx');
const fixtureGenericCsv = path.join(__dirname, 'fixtures', 'generic-csv-import', 'sample.csv');
const fixtureJsonRows = path.join(__dirname, 'fixtures', 'json-rows-import', 'sample.json');
const fixtureVcf = path.join(__dirname, 'fixtures', 'vcf-import', 'sample.vcf');
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

  it('pdf', async () => {
    const result = await runImport('pdf', fixturePdf, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-pdf',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'pdf-import');
    assert.strictEqual(note.frontmatter.pdf_file, 'hello.pdf');
    assert.equal(Number(note.frontmatter.pdf_pages), 1);
    assert.ok(String(note.frontmatter.source_id || '').length >= 16);
    assertIsoDate(String(note.frontmatter.date || ''));
    assert(note.body.includes('Knowtation PDF fixture'));
  });

  it('docx', async () => {
    const result = await runImport('docx', fixtureDocx, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-docx',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'docx-import');
    assert.strictEqual(note.frontmatter.docx_file, 'hello.docx');
    assert.ok(String(note.frontmatter.source_id || '').length >= 16);
    assertIsoDate(String(note.frontmatter.date || ''));
    assert(note.body.includes('Knowtation DOCX fixture'));
    assert(note.body.includes('Second line for golden test'));
  });

  it('markdown empty file', async () => {
    const input = path.join(fixturesRoot, 'empty.md');
    const result = await runImport('markdown', input, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-empty-md',
      dryRun: false,
    });
    assert.strictEqual(result.count, 1);
    const note = readNote(testVault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'markdown');
    assert.strictEqual(String(note.body || '').trim(), '');
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
    assert.ok(note.body.includes('## All CSV fields (JSON)'));
    assert.ok(note.body.includes('"Issue key": "PROJ-1"'));
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
    assert(note.body.includes('## All CSV fields (JSON)'));
    assert(note.body.includes('"id": "LIN-1"'));
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

  it('generic-csv', async () => {
    const result = await runImport('generic-csv', fixtureGenericCsv, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-generic-csv',
      dryRun: false,
    });
    assert.strictEqual(result.count, 2);
    const a = readNote(testVault, result.imported[0].path);
    const b = readNote(testVault, result.imported[1].path);
    assert.strictEqual(a.frontmatter.source, 'csv-import');
    assert.strictEqual(a.frontmatter.csv_file, 'sample.csv');
    assert.strictEqual(a.frontmatter.title, 'sample.csv · Alice');
    assert.equal(Number(a.frontmatter.row_index), 1);
    {
      const h = a.frontmatter.import_column_headers;
      const cols = typeof h === 'string' ? JSON.parse(h) : h;
      assert.deepStrictEqual(cols, ['name', 'amount', 'note']);
    }
    assert(a.body.startsWith('# sample.csv · Alice'));
    assert(a.body.includes('## Full row (JSON)'));
    assert(a.body.includes('"name": "Alice"'));
    assert(a.body.includes('Alice') && a.body.includes('10'));
    assert.equal(Number(b.frontmatter.row_index), 2);
    assert.strictEqual(b.frontmatter.title, 'sample.csv · Bob');
    assert(b.body.startsWith('# sample.csv · Bob'));
    assert(b.body.includes('Bob'));
  });

  it('json-rows', async () => {
    const result = await runImport('json-rows', fixtureJsonRows, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-json-rows',
      dryRun: false,
    });
    assert.strictEqual(result.count, 2);
    const n0 = readNote(testVault, result.imported[0].path);
    const n1 = readNote(testVault, result.imported[1].path);
    assert.strictEqual(n0.frontmatter.source, 'json-import');
    assert.strictEqual(n0.frontmatter.json_file, 'sample.json');
    assert.equal(Number(n0.frontmatter.item_index), 0);
    assert.strictEqual(n0.frontmatter.source_id, 'row-a');
    assert(n0.body.includes('"name": "First"'));
    assert.equal(Number(n1.frontmatter.item_index), 1);
    assert(n1.body.includes('Second'));
  });

  it('excel-xlsx', async () => {
    const xlsx = await import('xlsx');
    const xlsxPath = path.join(testVault, 'golden-temp.xlsx');
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ['name', 'n'],
        ['Alpha', 10],
        ['Beta', 20],
      ]),
      'First',
    );
    xlsx.writeFile(wb, xlsxPath);
    const result = await runImport('excel-xlsx', xlsxPath, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-excel',
      dryRun: false,
    });
    assert.strictEqual(result.count, 2);
    const a = readNote(testVault, result.imported[0].path);
    const b = readNote(testVault, result.imported[1].path);
    assert.strictEqual(a.frontmatter.source, 'xlsx-import');
    assert.strictEqual(a.frontmatter.title, 'golden-temp.xlsx · Alpha');
    assert.equal(Number(a.frontmatter.row_index), 1);
    assert(a.body.startsWith('# golden-temp.xlsx · Alpha'));
    assert(a.body.includes('## Full row (JSON)'));
    assert(a.body.includes('"name": "Alpha"'));
    assert(a.body.includes('Alpha') && a.body.includes('10'));
    assert.strictEqual(b.frontmatter.title, 'golden-temp.xlsx · Beta');
    assert(b.body.startsWith('# golden-temp.xlsx · Beta'));
    assert(b.body.includes('Beta'));
  });

  it('vcf', async () => {
    const result = await runImport('vcf', fixtureVcf, {
      vaultPath: testVault,
      outputDir: 'inbox/golden-vcf',
      dryRun: false,
    });
    assert.strictEqual(result.count, 2);
    const n0 = readNote(testVault, result.imported[0].path);
    const n1 = readNote(testVault, result.imported[1].path);
    assert.strictEqual(n0.frontmatter.source, 'vcf-import');
    assert(n0.path.includes('contacts/') && n0.path.includes('vcf'));
    assert(n0.body.includes('Alice') && n0.body.includes('alice@example.com'));
    assert(n1.body.includes('Bob') && n1.body.includes('bob@example.com'));
  });

  it('google-sheets: requires service account in environment', async () => {
    const a = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const j = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    try {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      await assert.rejects(
        runImport('google-sheets', '1dummySpreadsheetId', {
          vaultPath: testVault,
          outputDir: 'inbox/golden-sheets',
          dryRun: true,
        }),
        /google-sheets import: set GOOGLE_SERVICE_ACCOUNT_JSON/,
      );
    } finally {
      if (a === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = a;
      if (j === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = j;
    }
  });
});
