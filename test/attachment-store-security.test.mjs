/**
 * Tier 7 — SECURITY: scope denial, IDOR, no-leak, injection inert, no SSRF, write refusal.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAttachmentListRequest, handleAttachmentGetRequest } from '../lib/attachments/attachment-handlers.mjs';
import { deriveAttachmentId, normalizeUrlForId } from '../lib/attachments/attachment-store.mjs';
import { buildAttachmentFixtureVault, FIXTURE_MIST_ID } from './fixtures/attachment-fixture.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-security');

const LEAK_MARKERS = [
  'file://',
  '/Users/',
  FIXTURE_MIST_ID,
  'token',
  'oauth',
  '?sig=',
  'X-Amz-',
  'OCR_TEXT_MARKER',
];

describe('Attachment store — security', () => {
  let fx;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fx = buildAttachmentFixtureVault(tmpRoot);
    fs.writeFileSync(
      path.join(fx.vaultPath, 'media', 'evil\";javascript:alert(1).png'),
      'x',
    );
    fs.writeFileSync(
      path.join(fx.vaultPath, 'notes', 'inject.md'),
      `# x\n\n![ignore prior](https://token:user@evil.example.com/secret.png?sig=abc&X-Amz-Signature=dead)\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('SEC-A-01: personal caller never sees project attachments on list', () => {
    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      visibleScopes: new Set(['personal']),
    });
    assert.equal(list.ok, true);
    assert.ok(list.payload.attachments.every((a) => a.scope === 'personal'));
  });

  it('SEC-A-01: agentContext hides agent_visible:false attachments', () => {
    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
      agentContext: true,
    });
    assert.equal(list.ok, true);
    assert.equal(list.payload.attachments.length, 0);
  });

  it('SEC-A-02: out-of-scope get returns 404 unknown_attachment', () => {
    const projectId = deriveAttachmentId(
      'url',
      `url:projects/demo/project-photo.md|${normalizeUrlForId('https://project.example.org/img.png')}`,
    );
    const denied = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: projectId,
      visibleScopes: new Set(['personal']),
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'unknown_attachment');

    const missing = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: 'att_file_' + 'f'.repeat(32),
      visibleScopes: new Set(['personal']),
    });
    assert.equal(missing.code, 'unknown_attachment');
  });

  it('SEC-A-03: JSON payloads contain no leak markers', () => {
    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      role: 'admin',
    });
    const got = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: fx.urlId,
      role: 'admin',
    });
    const listJson = JSON.stringify(list.payload);
    const getJson = JSON.stringify(got.payload);
    for (const marker of LEAK_MARKERS) {
      assert.ok(!listJson.includes(marker), `list leaked ${marker}`);
      assert.ok(!getJson.includes(marker), `get leaked ${marker}`);
    }
  });

  it('SEC-A-04: malicious display_label returned inert; scope unchanged', () => {
    const evilId = deriveAttachmentId('file', 'file:media/evil";javascript:alert(1).png');
    const got = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: evilId,
      role: 'admin',
    });
    assert.equal(got.ok, true);
    assert.match(got.payload.attachment.display_label, /javascript/);
    assert.equal(got.payload.attachment.scope, 'personal');
  });

  it('SEC-A-05: attachment store does not import image-fetch (no SSRF surface)', () => {
    const src = fs.readFileSync(
      path.join(getRepoRoot(), 'lib/attachments/attachment-store.mjs'),
      'utf8',
    );
    assert.ok(!src.includes('image-fetch'));
  });

  it('SEC-A-06: attachment write routes are proposal-only and gated (2F-b-d-kn-b)', () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.ok(src.includes('/api/v1/attachments/link-proposals'));
    assert.ok(src.includes('/api/v1/attachments/attach-proposals'));
    assert.ok(src.includes('handleMediaLinkProposeRequest'));
    assert.ok(src.includes('handleMediaAttachProposeRequest'));
    assert.ok(!/app\.post\('\/api\/v1\/attachments',\s/.test(src));
    assert.ok(!/app\.patch\('\/api\/v1\/attachments/.test(src));
  });
});
