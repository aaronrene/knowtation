/**
 * Tier 4 — STRESS: list cap at MAX_ATTACHMENT_SUMMARIES.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAttachments, MAX_ATTACHMENT_SUMMARIES } from '../lib/attachments/attachment-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-stress');

describe('Attachment store — stress', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultPath = path.join(tmpRoot, 'vault');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(vaultPath, 'media'), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    for (let i = 0; i < MAX_ATTACHMENT_SUMMARIES + 5; i += 1) {
      fs.writeFileSync(path.join(vaultPath, 'media', `file_${String(i).padStart(5, '0')}.png`), 'x');
    }

    fs.mkdirSync(path.join(vaultPath, 'notes'), { recursive: true });
    let body = '';
    for (let i = 0; i < 20; i += 1) {
      body += `\n![img${i}](https://host${i}.example.com/a${i}.png)\n`;
    }
    fs.writeFileSync(path.join(vaultPath, 'notes', 'many-urls.md'), body);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('list returns capped rows with truncated:true when over limit', () => {
    const result = listAttachments(dataDir, vaultPath, vaultId, {
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
      limit: MAX_ATTACHMENT_SUMMARIES,
    });
    assert.equal(result.attachments.length, MAX_ATTACHMENT_SUMMARIES);
    assert.equal(result.truncated, true);
  });

  it('many notes × embedded URLs stays linear (completes under budget)', () => {
    const t0 = performance.now();
    listAttachments(dataDir, vaultPath, vaultId, {
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
      limit: MAX_ATTACHMENT_SUMMARIES,
    });
    assert.ok(performance.now() - t0 < 5000);
  });
});
