/**
 * Tier 2 — INTEGRATION: CLI = MCP = Hub handler parity (deep-equality gate).
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleAttachmentListRequest,
  handleAttachmentGetRequest,
  serializeAttachmentPayload,
} from '../lib/attachments/attachment-handlers.mjs';
import { buildAttachmentFixtureVault } from './fixtures/attachment-fixture.mjs';
import { deriveAttachmentId, normalizeUrlForId } from '../lib/attachments/attachment-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-parity');

function hubList(input) {
  return handleAttachmentListRequest({ ...input, role: 'admin' });
}

function cliList(input) {
  return handleAttachmentListRequest({
    ...input,
    cliScopes: ['personal', 'project', 'org'],
  });
}

function mcpList(input) {
  return handleAttachmentListRequest({
    ...input,
    cliScopes: ['personal', 'project', 'org'],
  });
}

describe('Attachment list/get — triple-surface parity', () => {
  let fx;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fx = buildAttachmentFixtureVault(tmpRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('list: Hub, CLI, and MCP payloads are deep-equal', () => {
    const base = { dataDir: fx.dataDir, vaultPath: fx.vaultPath, vaultId: fx.vaultId };
    const hub = hubList(base);
    const cli = cliList(base);
    const mcp = mcpList(base);
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(hub.payload, cli.payload);
    assert.deepEqual(cli.payload, mcp.payload);
    assert.equal(serializeAttachmentPayload(hub.payload), serializeAttachmentPayload(mcp.payload));
  });

  it('get: Hub, CLI, and MCP payloads are deep-equal', () => {
    const base = {
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: fx.fileId,
    };
    const hub = handleAttachmentGetRequest({ ...base, role: 'admin' });
    const cli = handleAttachmentGetRequest({ ...base, cliScopes: ['personal', 'project', 'org'] });
    assert.equal(hub.ok, true);
    assert.deepEqual(hub.payload, cli.payload);
  });

  it('scope filter is identical across surfaces for list and get', () => {
    const listPersonal = hubList({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      scope: 'personal',
    });
    assert.equal(listPersonal.ok, true);
    assert.ok(listPersonal.payload.attachments.every((a) => a.scope === 'personal'));

    const getProjectDenied = handleAttachmentGetRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.vaultPath,
      vaultId: fx.vaultId,
      attachmentId: deriveProjectUrlId(),
      visibleScopes: new Set(['personal']),
    });
    assert.equal(getProjectDenied.ok, false);
    assert.equal(getProjectDenied.code, 'unknown_attachment');
  });

  it('derivation is idempotent across repeated listAttachments', () => {
    const base = { dataDir: fx.dataDir, vaultPath: fx.vaultPath, vaultId: fx.vaultId };
    const first = hubList(base);
    const second = hubList(base);
    assert.deepEqual(first.payload.attachments, second.payload.attachments);
  });
});

function deriveProjectUrlId() {
  return deriveAttachmentId(
    'url',
    `url:projects/demo/project-photo.md|${normalizeUrlForId('https://project.example.org/img.png')}`,
  );
}

describe('Attachment routes — hub wiring contract', () => {
  it('registers GET /api/v1/attachments list and get with auth middleware', () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /app\.use\('\/api\/v1\/attachments', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /app\.get\('\/api\/v1\/attachments', requireRole\('viewer'/);
    assert.match(src, /app\.get\('\/api\/v1\/attachments\/:id', requireRole\('viewer'/);
    assert.match(src, /handleAttachmentListRequest/);
    assert.match(src, /handleAttachmentGetRequest/);
  });
});
