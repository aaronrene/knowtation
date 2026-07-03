/**
 * Tier 5 — DATA INTEGRITY: propose no mutation; credential-free refs; idempotent attach.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleMediaLinkProposeRequest,
  handleMediaAttachProposeRequest,
} from '../lib/attachments/attachment-write.mjs';
import { loadExternalRefStore } from '../lib/attachments/attachment-external-ref-store.mjs';
import { readNote } from '../lib/vault.mjs';
import { noteStateIdFromParts } from '../lib/note-state-id.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveMediaProposal,
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
  sampleAttachProposeBody,
} from './fixtures/media/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-integrity');

describe('media write — data integrity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('propose alone does not mutate external ref store or note frontmatter', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    process.env.MEDIA_ATTACH_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'propose-only'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const noteBefore = readNote(fx.vaultPath, fx.targetNotePath);
    const refsBefore = JSON.stringify(loadExternalRefStore(fx.dataDir));

    await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({ consent_id: consentId }),
      intent: 'link',
      createProposal,
    });
    await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx),
      intent: 'attach',
      createProposal,
    });

    assert.equal(JSON.stringify(loadExternalRefStore(fx.dataDir)), refsBefore);
    const noteAfter = readNote(fx.vaultPath, fx.targetNotePath);
    assert.deepEqual(noteAfter.frontmatter?.attachments ?? [], noteBefore.frontmatter?.attachments ?? []);
  });

  it('approved external ref is credential-free; idempotent re-attach adds no duplicate', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    process.env.MEDIA_ATTACH_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'apply'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');

    const link = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({ consent_id: consentId }),
      intent: 'link',
      createProposal,
    });
    approveMediaProposal(fx.dataDir, link.payload.proposal_id, fx.vaultPath);

    const store = loadExternalRefStore(fx.dataDir);
    const blob = JSON.stringify(store);
    assert.ok(!blob.includes('https://'));
    assert.ok(!blob.includes('token'));
    assert.ok(!blob.includes('oauth'));

    const attach1 = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx, { attachment_id: link.payload.attachment_id }),
      intent: 'attach1',
      createProposal,
    });
    approveMediaProposal(fx.dataDir, attach1.payload.proposal_id, fx.vaultPath);
    const note1 = readNote(fx.vaultPath, fx.targetNotePath);
    const count1 = (note1.frontmatter?.attachments ?? []).length;

    const noteAfterFirst = readNote(fx.vaultPath, fx.targetNotePath);
    const freshBase = noteStateIdFromParts(noteAfterFirst.frontmatter ?? {}, noteAfterFirst.body ?? '');
    const attach2 = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx, {
        attachment_id: link.payload.attachment_id,
        base_state_id: freshBase,
      }),
      intent: 'attach2',
      createProposal,
    });
    assert.equal(attach2.ok, true);
    approveMediaProposal(fx.dataDir, attach2.payload.proposal_id, fx.vaultPath);
    const note2 = readNote(fx.vaultPath, fx.targetNotePath);
    assert.equal((note2.frontmatter?.attachments ?? []).length, count1);
  });

  it('revoked consent blocks new links but leaves applied refs intact', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'revoke'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const link = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({ consent_id: consentId, opaque_ref: 'keep-ref' }),
      intent: 'link',
      createProposal,
    });
    approveMediaProposal(fx.dataDir, link.payload.proposal_id, fx.vaultPath);

    const { handleMediaImportConsentRevokeRequest } = await import('../lib/attachments/attachment-write.mjs');
    handleMediaImportConsentRevokeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      consentId,
    });

    const blocked = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({
        consent_id: consentId,
        opaque_ref: 'new-ref-after-revoke',
      }),
      intent: 'blocked',
      createProposal,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'MEDIA_IMPORT_CONSENT_REQUIRED');

    const store = loadExternalRefStore(fx.dataDir);
    assert.ok(store.vaults[fx.vaultId]?.refs?.[link.payload.attachment_id]);
  });
});
