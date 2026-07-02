/**
 * Tier 3 — E2E: temp vault derivation walkthrough and filtered list/get.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAttachmentListRequest, handleAttachmentGetRequest } from '../lib/attachments/attachment-handlers.mjs';
import { buildAttachmentFixtureVault } from './fixtures/attachment-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-e2e');

describe('E2E — Attachment read walkthrough', () => {
  let fx;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fx = buildAttachmentFixtureVault(tmpRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('derives vault_file, mist_blob, and embedded_url attachments', () => {
    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
    });
    assert.equal(list.ok, true);
    const sources = new Set(list.payload.attachments.map((a) => a.source));
    assert.ok(sources.has('vault_file'));
    assert.ok(sources.has('mist_blob'));
    assert.ok(sources.has('embedded_url'));
  });

  it('get vault_file returns linked note refs when present; embedded_url filter works', () => {
    const got = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: fx.fileId,
      role: 'admin',
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.attachment.storage_kind, 'vault_blob');

    const embeddedOnly = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
      source: 'embedded_url',
    });
    assert.equal(embeddedOnly.ok, true);
    assert.ok(embeddedOnly.payload.attachments.every((a) => a.source === 'embedded_url'));
    assert.ok(embeddedOnly.payload.attachments.some((a) => a.storage_kind === 'external_link'));
  });
});
