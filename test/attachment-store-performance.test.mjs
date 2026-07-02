/**
 * Tier 6 — PERFORMANCE: list/get p95 budget on MAX fixture.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAttachments, getAttachment, MAX_ATTACHMENT_SUMMARIES, deriveAttachmentId } from '../lib/attachments/attachment-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-performance');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Attachment store — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultPath = path.join(tmpRoot, 'vault');
  const vaultId = 'default';
  let sampleId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(vaultPath, 'media'), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    for (let i = 0; i < MAX_ATTACHMENT_SUMMARIES; i += 1) {
      const name = `perf_${String(i).padStart(5, '0')}.png`;
      fs.writeFileSync(path.join(vaultPath, 'media', name), 'x');
      if (i === 0) sampleId = deriveAttachmentId('file', `file:media/${name}`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listAttachments and getAttachment stay within p95 budget', () => {
    const listTimes = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      listAttachments(dataDir, vaultPath, vaultId, {
        filterScopes: new Set(['personal', 'project', 'org']),
        effectiveScope: 'org',
        limit: MAX_ATTACHMENT_SUMMARIES,
      });
      listTimes.push(performance.now() - t0);
    }

    const getTimes = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      getAttachment(dataDir, vaultPath, vaultId, sampleId, {
        visibleScopes: new Set(['personal', 'project', 'org']),
      });
      getTimes.push(performance.now() - t0);
    }

    assert.ok(percentile(listTimes, 95) < 2000);
    assert.ok(percentile(getTimes, 95) < 2000);
  });
});
