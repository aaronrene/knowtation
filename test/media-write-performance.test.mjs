/**
 * Tier 6 — PERFORMANCE: propose/apply budgets; lookups not vault scans.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleMediaLinkProposeRequest } from '../lib/attachments/attachment-write.mjs';
import { getActiveConsent } from '../lib/attachments/media-import-consent.mjs';
import { getEnabledConnector } from '../lib/attachments/media-connector-policy.mjs';
import { listAttachments } from '../lib/attachments/attachment-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveMediaProposal,
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
} from './fixtures/media/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-perf');

describe('media write — performance', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('propose + apply p95 under budget; consent/connector lookup O(1)', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'perf'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');

    const t0 = performance.now();
    for (let i = 0; i < 50; i += 1) {
      getEnabledConnector(fx.dataDir, fx.vaultId, 'gdrive');
      getActiveConsent(fx.dataDir, fx.vaultId, 'gdrive', 'personal');
    }
    const lookupMs = performance.now() - t0;
    assert.ok(lookupMs < 200, `lookups took ${lookupMs}ms`);

    const proposeTimes = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      const result = await handleMediaLinkProposeRequest({
        dataDir: fx.dataDir,
        vaultId: fx.vaultId,
        cliScopes: ['personal', 'project', 'org'],
        body: sampleLinkProposeBody({ consent_id: consentId, opaque_ref: `ref-${i}` }),
        intent: `perf-${i}`,
        createProposal,
      });
      proposeTimes.push(performance.now() - start);
      assert.equal(result.ok, true);
      approveMediaProposal(fx.dataDir, result.payload.proposal_id, fx.vaultPath);
    }
    proposeTimes.sort((a, b) => a - b);
    const p95 = proposeTimes[Math.floor(proposeTimes.length * 0.95)] ?? proposeTimes.at(-1);
    assert.ok(p95 < 500, `propose p95 ${p95}ms`);

    const listStart = performance.now();
    listAttachments(fx.dataDir, fx.vaultPath, fx.vaultId, {
      effectiveScope: 'personal',
      filterScopes: new Set(['personal', 'project', 'org']),
      source: 'connector_ref',
    });
    const listMs = performance.now() - listStart;
    assert.ok(listMs < 1000, `list join took ${listMs}ms`);
  });
});
