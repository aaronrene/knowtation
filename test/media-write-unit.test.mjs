/**
 * Tier 1 — UNIT: regexes, deterministic ids, envelope stamps, gate defaults off.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONNECTOR_ID_RE,
  OPAQUE_REF_RE,
  CONSENT_ID_RE,
  deriveLinkAttachmentId,
  getMediaExternalLinkEnabled,
  getMediaAttachEnabled,
  handleMediaLinkProposeRequest,
  MEDIA_PROPOSAL_SOURCE,
  MEDIA_REVIEW_QUEUE,
} from '../lib/attachments/attachment-write.mjs';
import { ATTACHMENT_ID_RE } from '../lib/attachments/attachment-store.mjs';
import { createProposal, listProposals } from '../hub/proposals-store.mjs';
import {
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
} from './fixtures/media/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-unit');

describe('media write — unit', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('CONNECTOR_ID_RE / OPAQUE_REF_RE / CONSENT_ID_RE / ATTACHMENT_ID_RE accept canonical', () => {
    assert.ok(CONNECTOR_ID_RE.test('gdrive'));
    assert.ok(!CONNECTOR_ID_RE.test('GDrive'));
    assert.ok(OPAQUE_REF_RE.test('1AbCd_efGhIjkLmnOpQrStU'));
    assert.ok(!OPAQUE_REF_RE.test('a'.repeat(257)));
    assert.ok(CONSENT_ID_RE.test('mic_0123456789abcdef'));
    const linkId = deriveLinkAttachmentId('gdrive', 'handle123');
    assert.ok(ATTACHMENT_ID_RE.test(linkId));
    assert.match(linkId, /^att_link_[a-f0-9]{32}$/);
  });

  it('deriveLinkAttachmentId is deterministic', () => {
    const a = deriveLinkAttachmentId('gdrive', 'same');
    const b = deriveLinkAttachmentId('gdrive', 'same');
    assert.equal(a, b);
    assert.notEqual(a, deriveLinkAttachmentId('gdrive', 'other'));
  });

  it('both gates default off', () => {
    const dir = path.join(tmpRoot, 'gates');
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(getMediaExternalLinkEnabled(dir), false);
    assert.equal(getMediaAttachEnabled(dir), false);
  });

  it('hub_media_write_policy.json enables both gates when env unset (2F-b-d-kn-d staging)', () => {
    const dir = path.join(tmpRoot, 'policy-file');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'hub_media_write_policy.json'),
      JSON.stringify({ media_external_link_enabled: true, media_attach_enabled: true }),
      'utf8',
    );
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
    assert.equal(getMediaExternalLinkEnabled(dir), true);
    assert.equal(getMediaAttachEnabled(dir), true);
  });

  it('propose envelope stamps source media + review_queue media-writes when gate on', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'env'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const body = sampleLinkProposeBody({ consent_id: consentId });
    const result = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body,
      intent: 'link board',
      createProposal,
    });
    assert.equal(result.ok, true);
    assert.equal(result.payload.schema, 'knowtation.media_proposal/v0');
    assert.equal(result.payload.proposal_kind, 'media_external_link');
    assert.equal(result.payload.auto_approvable, false);
    assert.equal(result.payload.status, 'proposed');
    assert.equal(result.payload.review_queue, MEDIA_REVIEW_QUEUE);

    const { proposals } = listProposals(fx.dataDir, { source: MEDIA_PROPOSAL_SOURCE });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].source, MEDIA_PROPOSAL_SOURCE);
    assert.equal(proposals[0].review_queue, MEDIA_REVIEW_QUEUE);
    assert.equal(proposals[0].media_meta.proposal_kind, 'media_external_link');
    assert.equal(proposals[0].media_meta.record_kind, 'media_external_link');
  });
});
