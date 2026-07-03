/**
 * Tier 4 — STRESS: burst refusals, concurrent duplicate links, boundary sizes.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleMediaLinkProposeRequest } from '../lib/attachments/attachment-write.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveMediaProposal,
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
} from './fixtures/media/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-stress');

describe('media write — stress', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('100 concurrent link proposes with gate off all refuse', async () => {
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'off-burst'));
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        handleMediaLinkProposeRequest({
          dataDir: fx.dataDir,
          vaultId: fx.vaultId,
          cliScopes: ['personal'],
          body: sampleLinkProposeBody(),
          intent: 'x',
          createProposal,
        }),
      ),
    );
    assert.ok(results.every((r) => !r.ok && r.code === 'MEDIA_EXTERNAL_LINK_DISABLED'));
  });

  it('100 concurrent link proposes same ref → one live ref, rest 409 after first approve', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'dup'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const body = sampleLinkProposeBody({ consent_id: consentId });

    const first = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body,
      intent: 'first',
      createProposal,
    });
    assert.equal(first.ok, true);
    approveMediaProposal(fx.dataDir, first.payload.proposal_id, fx.vaultPath);

    const rest = await Promise.all(
      Array.from({ length: 99 }, (_, i) =>
        handleMediaLinkProposeRequest({
          dataDir: fx.dataDir,
          vaultId: fx.vaultId,
          cliScopes: ['personal', 'project', 'org'],
          body,
          intent: `dup-${i}`,
          createProposal,
        }),
      ),
    );
    assert.ok(rest.every((r) => !r.ok && r.code === 'MEDIA_LINEAGE_CONFLICT'));
  });

  it('opaque_ref 256 chars ok; 257 rejected; large intent bounded', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'bounds'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const ok256 = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleLinkProposeBody({
        consent_id: consentId,
        opaque_ref: 'A'.repeat(256),
      }),
      intent: 'ok',
      createProposal,
    });
    assert.equal(ok256.ok, true);

    const bad257 = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleLinkProposeBody({
        consent_id: consentId,
        opaque_ref: 'A'.repeat(257),
      }),
      intent: 'bad',
      createProposal,
    });
    assert.equal(bad257.ok, false);
    assert.equal(bad257.code, 'MEDIA_DRAFT_INVALID');

    const bigIntent = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleLinkProposeBody({ consent_id: consentId, opaque_ref: 'B'.repeat(32) }),
      intent: 'x'.repeat(2001),
      createProposal,
    });
    assert.equal(bigIntent.ok, false);
    assert.equal(bigIntent.code, 'MEDIA_DRAFT_INVALID');
  });
});
