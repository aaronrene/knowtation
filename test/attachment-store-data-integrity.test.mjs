/**
 * Tier 5 — DATA INTEGRITY: deletion propagation and overlay orphan GC.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAttachmentGetRequest, handleAttachmentListRequest } from '../lib/attachments/attachment-handlers.mjs';
import { attachmentForClient } from '../lib/attachments/attachment-store.mjs';
import { saveAttachmentStore } from '../lib/attachments/attachment-store-file.mjs';
import { buildAttachmentFixtureVault } from './fixtures/attachment-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-integrity');

describe('Attachment store — data integrity', () => {
  let fx;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fx = buildAttachmentFixtureVault(tmpRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('I-A-DEL-01: deleting owning note removes mist/embedded attachments', () => {
    const before = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
    });
    assert.equal(before.ok, true);
    assert.ok(before.payload.attachments.some((a) => a.attachment_id === fx.mistId));

    fs.unlinkSync(path.join(fx.vaultPath, 'notes', 'mist-note.md'));

    const afterList = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
    });
    assert.ok(!afterList.payload.attachments.some((a) => a.attachment_id === fx.mistId));

    const afterGet = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: fx.mistId,
      role: 'admin',
    });
    assert.equal(afterGet.ok, false);
    assert.equal(afterGet.code, 'unknown_attachment');
  });

  it('I-A-DEL-01: deleting media file removes vault_file attachment', () => {
    fs.unlinkSync(path.join(fx.vaultPath, 'media', 'sample.png'));
    const got = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: fx.fileId,
      role: 'admin',
    });
    assert.equal(got.ok, false);
    assert.equal(got.code, 'unknown_attachment');
  });

  it('I-A-ORPH-01: overlay entry for underivable id never resurrects attachment', () => {
    saveAttachmentStore(fx.dataDir, {
      vaults: {
        [fx.vaultId]: {
          policies: {
            att_file_deadbeefdeadbeefdeadbeefdeadbe: {
              agent_visible: true,
              retention: 'vault_lifetime',
              updated: '2026-07-02T00:00:00Z',
            },
          },
        },
      },
    });
    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
    });
    assert.ok(!list.payload.attachments.some((a) => a.attachment_id.startsWith('att_file_dead')));
  });

  it('attachmentForClient adds no path/url/byte leak fields', () => {
    const got = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: fx.urlId,
      role: 'admin',
    });
    assert.equal(got.ok, true);
    const client = attachmentForClient(got.payload.attachment);
    const json = JSON.stringify(client);
    assert.ok(!json.includes('media/'));
    assert.ok(!json.includes('https://'));
    assert.equal('bytes' in client, false);
  });
});
