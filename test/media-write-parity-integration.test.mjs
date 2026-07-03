/**
 * Tier 2 — INTEGRATION: CLI = MCP = Hub parity + disabled gates.
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
import { createProposal } from '../hub/proposals-store.mjs';
import {
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
  sampleAttachProposeBody,
} from './fixtures/media/write-helpers.mjs';
import { registerAttachmentTools } from '../mcp/tools/attachment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-media-write-parity');

function stripVolatile(payload) {
  const copy = structuredClone(payload);
  delete copy.proposal_id;
  return copy;
}

describe('media write — triple-surface parity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('Hub, CLI, MCP produce deep-equal link propose envelope when gate on', async () => {
    process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'link'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const body = sampleLinkProposeBody({ consent_id: consentId });

    const hub = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      role: 'admin',
      body,
      intent: 'link it',
      createProposal,
    });
    const cli = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body,
      intent: 'link it',
      createProposal,
    });
    const mcp = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body,
      intent: 'link it',
      createProposal,
    });
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(stripVolatile(hub.payload), stripVolatile(cli.payload));
    assert.deepEqual(stripVolatile(cli.payload), stripVolatile(mcp.payload));
  });

  it('both gates off refuse link and attach on all surfaces', async () => {
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'off'));
    const linkBody = sampleLinkProposeBody();
    const attachBody = sampleAttachProposeBody(fx);

    for (const ctx of [{ role: 'admin' }, { cliScopes: ['personal'] }]) {
      const link = await handleMediaLinkProposeRequest({
        dataDir: fx.dataDir,
        vaultId: fx.vaultId,
        body: linkBody,
        intent: 'link',
        createProposal,
        ...ctx,
      });
      assert.equal(link.ok, false);
      assert.equal(link.code, 'MEDIA_EXTERNAL_LINK_DISABLED');

      const attach = await handleMediaAttachProposeRequest({
        dataDir: fx.dataDir,
        vaultPath: fx.vaultPath,
        vaultId: fx.vaultId,
        body: attachBody,
        intent: 'attach',
        createProposal,
        ...ctx,
      });
      assert.equal(attach.ok, false);
      assert.equal(attach.code, 'MEDIA_ATTACH_DISABLED');
    }
  });

  it('consent grant is not registered as an MCP write tool', () => {
    /** @type {string[]} */
    const registered = [];
    const fakeServer = {
      registerTool(name) {
        registered.push(name);
      },
    };
    registerAttachmentTools(fakeServer);
    assert.ok(registered.includes('media_external_link_propose'));
    assert.ok(registered.includes('media_attach_propose'));
    assert.ok(registered.includes('media_import_consent_list'));
    assert.ok(!registered.includes('media_import_consent_grant'));
    assert.ok(!registered.includes('media_import_consent_revoke'));
  });
});
