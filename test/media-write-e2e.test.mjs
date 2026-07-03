/**
 * Tier 3 — E2E: consent → link → approve → read → attach → approve → linked_note_refs.
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
import {
  handleAttachmentListRequest,
  handleAttachmentGetRequest,
} from '../lib/attachments/attachment-handlers.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveMediaProposal,
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
  sampleAttachProposeBody,
} from './fixtures/media/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-e2e');

describe('media write — e2e lifecycle', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('grant consent → link propose → approve → connector_ref list → attach → approve → linked note', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    process.env.MEDIA_ATTACH_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'full'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');

    const link = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({ consent_id: consentId }),
      intent: 'link shared board',
      createProposal,
    });
    assert.equal(link.ok, true);
    assert.equal(approveMediaProposal(fx.dataDir, link.payload.proposal_id, fx.vaultPath).ok, true);

    const connectorList = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
      source: 'connector_ref',
    });
    assert.equal(connectorList.ok, true);
    assert.ok(connectorList.payload.attachments.some((a) => a.source === 'connector_ref'));
    const linkId = link.payload.attachment_id;
    assert.ok(connectorList.payload.attachments.some((a) => a.attachment_id === linkId));

    const attach = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx, { attachment_id: linkId }),
      intent: 'attach to lesson',
      createProposal,
    });
    assert.equal(attach.ok, true);
    assert.equal(approveMediaProposal(fx.dataDir, attach.payload.proposal_id, fx.vaultPath).ok, true);

    const got = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: linkId,
      role: 'admin',
    });
    assert.equal(got.ok, true);
    assert.ok(got.payload.attachment.linked_note_refs.includes(fx.targetNoteRef));
  });
});
