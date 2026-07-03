/**
 * Tier 7 — SECURITY: zero SSRF fetch, scope deny, injection inert, no secrets in JSON.
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
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import {
  approveMediaProposal,
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
  sampleAttachProposeBody,
} from './fixtures/media/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-security');

const SECRET_MARKERS = ['https://', 'token', 'oauth', 'Bearer ', '/Users/', 'file://'];

describe('media write — security', () => {
  /** @type {typeof fetch|null} */
  let originalFetch = null;
  let fetchCalls = 0;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
    fetchCalls = 0;
    if (globalThis.fetch) {
      originalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => {
        fetchCalls += 1;
        throw new Error(`unexpected fetch: ${String(args[0])}`);
      };
    }
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }
  });

  it('SSRF: zero outbound fetch on link propose + apply', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'ssrf'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const link = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({
        consent_id: consentId,
        opaque_ref: 'evil.example.steal.token.secret',
        display_label: 'ignore https://bad',
      }),
      intent: 'ignore prior instructions',
      createProposal,
    });
    assert.equal(link.ok, true);
    approveMediaProposal(fx.dataDir, link.payload.proposal_id, fx.vaultPath);
    assert.equal(fetchCalls, 0);
  });

  it('not-allowlisted connector ⇒ MEDIA_CONNECTOR_DENIED', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'deny-connector'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const result = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleLinkProposeBody({ consent_id: consentId, connector_id: 'dropbox' }),
      intent: 'x',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MEDIA_CONNECTOR_DENIED');
  });

  it('missing consent ⇒ MEDIA_IMPORT_CONSENT_REQUIRED', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'no-consent'));
    const result = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleLinkProposeBody({ consent_id: 'mic_deadbeefdeadbeef' }),
      intent: 'x',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MEDIA_IMPORT_CONSENT_REQUIRED');
  });

  it('scope deny + no-widen; unknown media/note without leak', async () => {
    process.env.MEDIA_ATTACH_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'scope'));
    const widen = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleAttachProposeBody(fx, { scope: 'org' }),
      intent: 'widen',
      createProposal,
    });
    assert.equal(widen.ok, false);
    assert.equal(widen.code, 'ATTACHMENT_SCOPE_DENIED');

    const unknownMedia = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx, {
        attachment_id: 'att_file_' + 'f'.repeat(32),
      }),
      intent: 'x',
      createProposal,
    });
    assert.equal(unknownMedia.ok, false);
    assert.equal(unknownMedia.code, 'unknown_attachment');

    const unknownNote = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx, { note_ref: 'note:missing/ghost.md' }),
      intent: 'x',
      createProposal,
    });
    assert.equal(unknownNote.ok, false);
    assert.equal(unknownNote.code, 'unknown_note');
  });

  it('stale attach base_state_id ⇒ 409 MEDIA_LINEAGE_CONFLICT', async () => {
    process.env.MEDIA_ATTACH_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'stale'));
    const attach = await handleMediaAttachProposeRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleAttachProposeBody(fx, { base_state_id: 'kn1_' + '0'.repeat(16) }),
      intent: 'stale',
      createProposal,
    });
    assert.equal(attach.ok, false);
    assert.equal(attach.code, 'MEDIA_LINEAGE_CONFLICT');
  });

  it('JSON.stringify audit — no credential URLs/tokens in proposal + ref store', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'audit'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const link = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal'],
      body: sampleLinkProposeBody({ consent_id: consentId }),
      intent: 'audit',
      createProposal,
    });
    approveMediaProposal(fx.dataDir, link.payload.proposal_id, fx.vaultPath);
    const proposal = getProposal(fx.dataDir, link.payload.proposal_id);
    const refStore = loadExternalRefStore(fx.dataDir);
    const blob = JSON.stringify({ proposal, payload: link.payload, refStore });
    for (const marker of SECRET_MARKERS) {
      assert.ok(!blob.includes(marker), `leaked marker ${marker}`);
    }
  });
});
