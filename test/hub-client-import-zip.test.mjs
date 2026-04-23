import assert from 'assert';
import { test } from 'node:test';
import JSZip from 'jszip';
import {
  getHubImportFileMode,
  buildImportZipBlobWithJsZip,
  DEFAULT_HUB_IMPORT_ZIP_LIMITS,
} from '../web/hub/hub-client-import-zip.mjs';

test('getHubImportFileMode: direct single, sequential multi pdf, client_zip markdown multi', () => {
  const a = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
  const b = new File([new Uint8Array([1])], 'b.pdf', { type: 'application/pdf' });
  const c1 = new File([new Uint8Array([1])], 'a.csv', { type: 'text/csv' });
  const c2 = new File([new Uint8Array([1])], 'b.csv', { type: 'text/csv' });
  const z = new File([new Uint8Array([1])], 'e.zip', { type: 'application/zip' });
  assert.equal(getHubImportFileMode('pdf', [a]), 'direct');
  assert.equal(getHubImportFileMode('pdf', [a, b]), 'sequential');
  assert.equal(getHubImportFileMode('generic-csv', [c1, c2]), 'sequential');
  const m1 = new File([new Uint8Array([1])], 'x.md', { type: 'text/markdown' });
  const m2 = new File([new Uint8Array([1])], 'y.md', { type: 'text/markdown' });
  assert.equal(getHubImportFileMode('markdown', [m1, m2]), 'client_zip');
  assert.equal(getHubImportFileMode('markdown', [z]), 'direct');
});

test('getHubImportFileMode: chatgpt always client_zip unless single server zip', () => {
  const c = new File([new Uint8Array([1])], 'conversations.json', { type: 'application/json' });
  const z = new File([new Uint8Array([1])], 'e.zip', { type: 'application/zip' });
  assert.equal(getHubImportFileMode('chatgpt-export', [c]), 'client_zip');
  assert.equal(getHubImportFileMode('chatgpt-export', [z]), 'direct');
});

test('getHubImportFileMode: claude: multi md = zip, multi json = sequential', () => {
  const j1 = new File([new Uint8Array([1])], 'a.json', { type: 'application/json' });
  const j2 = new File([new Uint8Array([1])], 'b.json', { type: 'application/json' });
  const m1 = new File([new Uint8Array([1])], 'a.md', { type: 'text/markdown' });
  const m2 = new File([new Uint8Array([1])], 'b.md', { type: 'text/markdown' });
  assert.equal(getHubImportFileMode('claude-export', [j1, j2]), 'sequential');
  assert.equal(getHubImportFileMode('claude-export', [m1, m2]), 'client_zip');
});

test('buildImportZipBlobWithJsZip: preserves paths, duplicate rename', async () => {
  const w = { warn: () => {} };
  const a = new File([new TextEncoder().encode('# a')], 'a.md', { type: 'text/plain' });
  const b = new File([new TextEncoder().encode('# b')], 'a.md', { type: 'text/plain' });
  const blob = await buildImportZipBlobWithJsZip(JSZip, [a, b], DEFAULT_HUB_IMPORT_ZIP_LIMITS, w);
  const buf = await blob.arrayBuffer();
  const jz = new JSZip();
  const u = await jz.loadAsync(buf);
  const names = Object.keys(u.files).filter((k) => !u.files[k].dir);
  assert.equal(names.length, 2);
  assert(names.some((n) => n === 'a.md' || n === 'a(1).md'), 'expected deduped name');
});

test('buildImportZipBlobWithJsZip: rejects too many small files (limit)', async () => {
  const limits = {
    maxZipBytes: 10 * 1024 * 1024,
    maxUncompressedBytes: 10 * 1024 * 1024,
    maxFiles: 2,
  };
  const a = new File([new Uint8Array([0])], '1.md', { type: 'text/plain' });
  const b = new File([new Uint8Array([0])], '2.md', { type: 'text/plain' });
  const c = new File([new Uint8Array([0])], '3.md', { type: 'text/plain' });
  await assert.rejects(
    () => buildImportZipBlobWithJsZip(JSZip, [a, b, c], limits, {}),
    /Too many files/,
  );
});
