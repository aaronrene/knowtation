/**
 * SEC-SEAM-MEDIA-b — seven-tier coverage (§SM.4 matrix).
 * Frozen: docs/SEC-SEAM-MEDIA-FREEZE.md (SM-C1–C12).
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import fs from 'node:fs';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  maybeApplyHostedMediaAfterApprove,
  mergeMediaApplyIntoApproveResponse,
} from '../hub/gateway/media-approve-hosted.mjs';
import {
  FM_PROPOSAL_SOURCE,
  FM_MEDIA_PROPOSAL_KIND,
  mergeMediaFrontmatter,
  normalizeCanisterProposalForMediaPrecheck,
  applyApprovedMediaProposalFromCanister,
} from '../lib/attachments/media-hosted-proposal.mjs';
import {
  MEDIA_PROPOSAL_SOURCE,
  deriveLinkAttachmentId,
  precheckApprovedMediaProposal,
  reconcileApprovedMediaProposal,
  handleMediaLinkProposeRequest,
  resolveMediaPointerForAttach,
} from '../lib/attachments/attachment-write.mjs';
import { handleAttachmentListRequest } from '../lib/attachments/attachment-handlers.mjs';
import { getExternalRef, loadExternalRefStore } from '../lib/attachments/attachment-external-ref-store.mjs';
import {
  withMediaBlobSync,
  mediaBlobKey,
  MEDIA_EXTERNAL_REFS_FILENAME,
  mergeExternalRefStoreJson,
  mergeImportConsentStoreJson,
} from '../hub/bridge/media-blob-store.mjs';
import {
  isSeamSurfaceProposal,
  matchesScoolingMediaFingerprint,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
} from './fixtures/media/write-helpers.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { loadMediaImportConsentStore, saveMediaImportConsentStore } from '../lib/attachments/media-import-consent.mjs';
import { noteStateIdFromParts } from '../lib/note-state-id.mjs';
import { readNote } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-sec-seam-media-hosted');

const SECRET = 'sec-seam-media-hosted-secret-32chars!!';
const ACTOR = 'google:learner-media';
const visible = new Set(['personal', 'project', 'org']);

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function startServer(handler) {
  const srv = http.createServer(handler);
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

/**
 * @param {Map<string, Record<string, unknown>>} proposalRows
 * @param {Map<string, { frontmatter: object, body: string }>} [noteRows]
 */
function mockCanisterApp(proposalRows, noteRows = new Map()) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.post('/api/v1/proposals/:id/approve', (req, res) => {
    const row = proposalRows.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    row.status = 'approved';
    res.json({ proposal_id: req.params.id, status: 'approved' });
  });
  app.get('/api/v1/proposals/:id', (req, res) => {
    const row = proposalRows.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    res.json(row);
  });
  app.get('/api/v1/notes/:path(*)', (req, res) => {
    const notePath = decodeURIComponent(req.params.path);
    const row = noteRows.get(notePath);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    res.json({
      path: notePath,
      frontmatter: JSON.stringify(row.frontmatter ?? {}),
      body: row.body ?? '',
    });
  });
  app.post('/api/v1/notes', (req, res) => {
    const notePath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!notePath) return res.status(400).json({ error: 'path required', code: 'BAD_REQUEST' });
    noteRows.set(notePath, {
      frontmatter:
        req.body.frontmatter && typeof req.body.frontmatter === 'object' ? req.body.frontmatter : {},
      body: typeof req.body.body === 'string' ? req.body.body : '',
    });
    res.json({ path: notePath, written: true });
  });
  return app;
}

function fakeBlobStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  const sets = [];
  return {
    store,
    sets,
    get: async (key) => (store.has(key) ? store.get(key) : null),
    set: async (key, value) => {
      sets.push(key);
      store.set(key, value);
    },
  };
}

function mediaLinkRow(opts) {
  const {
    proposalId,
    status = 'approved',
    connectorId = 'gdrive',
    opaqueRef = '1AbCd_efGhIjkLmnOpQrStU',
    consentId,
    scope = 'personal',
    vaultId = 'default',
  } = opts;
  const attachmentId = deriveLinkAttachmentId(connectorId, opaqueRef);
  const body = {
    proposal_kind: 'media_external_link',
    connector_id: connectorId,
    opaque_ref: opaqueRef,
    display_label: 'Design board',
    consent_id: consentId,
    scope,
    attachment_id: attachmentId,
  };
  return {
    proposal_id: proposalId,
    status,
    path: `meta/media/proposals/${proposalId}.json`,
    body: JSON.stringify(body, null, 2),
    frontmatter: mergeMediaFrontmatter(
      { type: 'media_proposal', proposal_kind: 'media_external_link', attachment_id: attachmentId },
      {
        proposal_kind: 'media_external_link',
        attachment_id: attachmentId,
        connector_id: connectorId,
        consent_id: consentId,
        note_ref: null,
      },
    ),
    vault_id: vaultId,
    base_state_id: 'kn1_absent',
    external_ref: `scooling.media:${proposalId}`,
  };
}

function mediaAttachRow(opts) {
  const {
    proposalId,
    status = 'approved',
    attachmentId,
    noteRef,
    baseStateId,
    mediaPointer,
    vaultId = 'default',
  } = opts;
  const body = {
    proposal_kind: 'media_attach',
    attachment_id: attachmentId,
    note_ref: noteRef,
    scope: 'personal',
    base_state_id: baseStateId,
    media_pointer: mediaPointer,
  };
  return {
    proposal_id: proposalId,
    status,
    path: `meta/media/proposals/${proposalId}.json`,
    body: JSON.stringify(body, null, 2),
    frontmatter: mergeMediaFrontmatter(
      {
        type: 'media_proposal',
        proposal_kind: 'media_attach',
        attachment_id: attachmentId,
        note_ref: noteRef,
      },
      {
        proposal_kind: 'media_attach',
        attachment_id: attachmentId,
        note_ref: noteRef,
        media_pointer: mediaPointer,
      },
    ),
    vault_id: vaultId,
    base_state_id: baseStateId,
    external_ref: `scooling.media:${proposalId}`,
  };
}

function plainNoteProposal(proposalId, status = 'approved') {
  return {
    proposal_id: proposalId,
    status,
    path: 'notes/plain.md',
    body: 'plain note body',
    frontmatter: { type: 'note' },
    vault_id: 'default',
  };
}

function readRepo(rel) {
  return fs.readFileSync(path.join(projectRoot, rel), 'utf8');
}

async function bootGateway(t, { canisterUrl, bridgeUrl, adminSub, cacheBust }) {
  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = canisterUrl;
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;
  process.env.HUB_ADMIN_USER_IDS = adminSub;
  t.after(() => {
    delete process.env.HUB_ADMIN_USER_IDS;
  });

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gwmedia=${cacheBust}`);
  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  return gwSrv.address().port;
}

function mockBridgeApp(applyCalls, applyResponse) {
  const app = express();
  app.use(express.json());
  app.get('/api/v1/role', (_req, res) => {
    res.json({ role: 'admin', may_approve_proposals: true });
  });
  app.get('/api/v1/hosted-context', (_req, res) => {
    res.status(404).json({ error: 'not hosted', code: 'NOT_FOUND' });
  });
  app.post('/api/v1/attachments/proposals/:proposal_id/apply-approved', (req, res) => {
    applyCalls.push({
      proposalId: req.params.proposal_id,
      auth: req.headers.authorization,
      vault: req.headers['x-vault-id'],
    });
    res.json({ applied: true, ...applyResponse, proposal_id: req.params.proposal_id });
  });
  app.post('/api/v1/attachments/link-proposals', (_req, res) => {
    res.status(201).json({ schema: 'knowtation.media_proposal/v0', proposal_id: 'proxy-hit' });
  });
  return app;
}

function enableLinkGate() {
  process.env.MEDIA_EXTERNAL_LINK_ENABLED = '1';
}

// ---------------------------------------------------------------------------

describe('SEC-SEAM-MEDIA-b — unit', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('mergeMediaApplyIntoApproveResponse merges success / failure / null', () => {
    const base = JSON.stringify({ proposal_id: 'p1', status: 'approved' });
    assert.equal(mergeMediaApplyIntoApproveResponse(base, null), base);

    const ok = JSON.parse(
      mergeMediaApplyIntoApproveResponse(base, {
        applied: true,
        payload: {
          applied: true,
          proposal_id: 'p1',
          proposal_kind: 'media_external_link',
          attachment_id: 'att_link_x',
        },
      }),
    );
    assert.equal(ok.media_index_applied, true);
    assert.equal(ok.media_apply.attachment_id, 'att_link_x');
    assert.equal(ok.media_apply_error, undefined);

    const fail = JSON.parse(
      mergeMediaApplyIntoApproveResponse(base, {
        applied: false,
        error: 'Connector not allowlisted',
        code: 'MEDIA_CONNECTOR_DENIED',
      }),
    );
    assert.equal(fail.media_index_applied, false);
    assert.equal(fail.media_apply_code, 'MEDIA_CONNECTOR_DENIED');
    assert.equal(fail.media_apply, undefined);

    assert.equal(
      mergeMediaApplyIntoApproveResponse('not-json', { applied: true, payload: {} }),
      'not-json',
    );
  });

  it('normalize: true for each recognition arm; false for notes/task; sets source media', () => {
    const kind = 'media_external_link';
    const byFm = normalizeCanisterProposalForMediaPrecheck({
      path: 'other/path.json',
      body: JSON.stringify({ proposal_kind: kind }),
      frontmatter: { [FM_PROPOSAL_SOURCE]: MEDIA_PROPOSAL_SOURCE, [FM_MEDIA_PROPOSAL_KIND]: kind },
    });
    assert.ok(byFm);
    assert.equal(byFm.source, MEDIA_PROPOSAL_SOURCE);
    assert.equal(byFm.media_meta.proposal_kind, kind);

    const bySource = normalizeCanisterProposalForMediaPrecheck({
      source: MEDIA_PROPOSAL_SOURCE,
      path: 'x',
      body: JSON.stringify({ proposal_kind: kind }),
      frontmatter: {},
    });
    assert.ok(bySource);
    assert.equal(bySource.source, MEDIA_PROPOSAL_SOURCE);

    const byPath = normalizeCanisterProposalForMediaPrecheck({
      path: 'meta/media/proposals/abc.json',
      body: JSON.stringify({ proposal_kind: 'media_attach' }),
      frontmatter: { [FM_MEDIA_PROPOSAL_KIND]: 'media_attach' },
    });
    assert.ok(byPath);
    assert.equal(byPath.media_meta.proposal_kind, 'media_attach');

    assert.equal(
      normalizeCanisterProposalForMediaPrecheck({
        path: 'notes/plain.md',
        body: 'hi',
        frontmatter: { type: 'note' },
      }),
      null,
    );
    assert.equal(
      normalizeCanisterProposalForMediaPrecheck({
        source: 'task',
        path: 'meta/tasks/proposals/t1.json',
        body: JSON.stringify({ proposal_kind: 'task_create' }),
        frontmatter: { knowtation_proposal_source: 'task' },
      }),
      null,
    );
    assert.equal(
      normalizeCanisterProposalForMediaPrecheck({
        source: MEDIA_PROPOSAL_SOURCE,
        path: 'meta/media/proposals/x.json',
        body: '{}',
        frontmatter: {},
      }),
      null,
      'kind absent → fail-closed null',
    );
  });

  it('pointer stamp preferred over vault walk in shared precheck/reconcile', () => {
    const dir = path.join(tmpRoot, 'pointer');
    fs.mkdirSync(dir, { recursive: true });
    const vaultPath = path.join(dir, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    const notePath = 'lesson.md';
    fs.writeFileSync(path.join(vaultPath, notePath), `---\ntitle: Lesson\n---\n# Body\n`, 'utf8');
    const note = readNote(vaultPath, notePath);
    const baseStateId = noteStateIdFromParts(note.frontmatter ?? {}, note.body ?? '');
    const stamped = 'mist:stamped-pointer-xyz';
    const mistId = 'att_mist_deadbeefdeadbeefdeadbeefdeadbeef';

    const proposal = {
      vault_id: 'default',
      status: 'approved',
      source: MEDIA_PROPOSAL_SOURCE,
      base_state_id: baseStateId,
      media_meta: {
        proposal_kind: 'media_attach',
        attachment_id: mistId,
        note_ref: `note:${notePath}`,
        media_pointer: stamped,
      },
      body: JSON.stringify({
        proposal_kind: 'media_attach',
        attachment_id: mistId,
        note_ref: `note:${notePath}`,
        media_pointer: stamped,
      }),
    };

    const pre = precheckApprovedMediaProposal(dir, proposal, { vaultPath, vaultConfig: {} });
    assert.equal(pre.ok, true, JSON.stringify(pre));
    assert.equal(pre.mediaPointer, stamped);
    reconcileApprovedMediaProposal(dir, pre);

    const after = readNote(vaultPath, notePath);
    const atts = after.frontmatter?.attachments;
    const asList = Array.isArray(atts)
      ? atts
      : typeof atts === 'string'
        ? atts.split(',').map((s) => s.trim())
        : [];
    assert.ok(asList.includes(stamped), `expected stamp in attachments, got ${JSON.stringify(atts)}`);
    assert.equal(resolveMediaPointerForAttach(vaultPath, {}, mistId), null);
  });

  it('hook returns null for non-approve paths and non-2xx approve', async () => {
    const ctxBase = {
      method: 'POST',
      pathOnly: '/api/v1/proposals/p1/approve',
      upstreamStatus: 200,
      canisterUrl: 'http://127.0.0.1:1',
      bridgeUrl: 'http://127.0.0.1:1',
      authorization: undefined,
      vaultId: 'default',
      effectiveUserId: 'u',
      actorUserId: 'u',
      canisterAuthHeaders: () => ({}),
    };
    assert.equal(await maybeApplyHostedMediaAfterApprove({ ...ctxBase, method: 'GET' }), null);
    assert.equal(
      await maybeApplyHostedMediaAfterApprove({
        ...ctxBase,
        pathOnly: '/api/v1/proposals/p1/discard',
      }),
      null,
    );
    assert.equal(
      await maybeApplyHostedMediaAfterApprove({ ...ctxBase, upstreamStatus: 403 }),
      null,
    );
    assert.equal(await maybeApplyHostedMediaAfterApprove({ ...ctxBase, bridgeUrl: '' }), null);
  });

  it('apply helper refuses non-media (400) and non-approved (409)', async (t) => {
    enableLinkGate();
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'unit-apply'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');

    const rows = new Map();
    rows.set('prop-note', plainNoteProposal('prop-note'));
    rows.set(
      'prop-pending',
      mediaLinkRow({ proposalId: 'prop-pending', status: 'proposed', consentId }),
    );
    rows.set('prop-ok', mediaLinkRow({ proposalId: 'prop-ok', status: 'approved', consentId }));

    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const nonMedia = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-note',
      vaultId: fx.vaultId,
    });
    assert.equal(nonMedia.ok, false);
    assert.equal(nonMedia.status, 400);

    const notApproved = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-pending',
      vaultId: fx.vaultId,
    });
    assert.equal(notApproved.ok, false);
    assert.equal(notApproved.status, 409);
    assert.equal(notApproved.code, 'CONFLICT');

    const applied = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-ok',
      vaultId: fx.vaultId,
    });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.payload.proposal_kind, 'media_external_link');
  });
});

describe('SEC-SEAM-MEDIA-b — integration', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('apply-approved media_external_link → external-ref listable; blob persisted', async (t) => {
    enableLinkGate();
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'int'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const opaqueRef = 'opaque-int-ref-001';
    const row = mediaLinkRow({
      proposalId: 'prop-int-link',
      consentId,
      opaqueRef,
    });
    const attachmentId = deriveLinkAttachmentId('gdrive', opaqueRef);

    const rows = new Map([['prop-int-link', row]]);
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const blobStore = fakeBlobStore();
    const result = await withMediaBlobSync({
      blobStore,
      dataDir: fx.dataDir,
      run: () =>
        applyApprovedMediaProposalFromCanister({
          dataDir: fx.dataDir,
          canisterUrl,
          headers: {},
          proposalId: 'prop-int-link',
          requireApproved: true,
          vaultId: fx.vaultId,
        }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.payload.attachment_id, attachmentId);

    const ref = getExternalRef(fx.dataDir, fx.vaultId, attachmentId);
    assert.ok(ref, 'external ref must be upserted');
    assert.equal(ref.opaque_ref, opaqueRef);

    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.dataDir,
      vaultId: fx.vaultId,
      visibleScopes: visible,
      source: 'connector_ref',
    });
    assert.equal(list.ok, true);
    assert.ok(
      list.payload.attachments.some((a) => a.attachment_id === attachmentId),
      'connector_ref must appear in attachment list',
    );

    assert.ok(
      blobStore.sets.includes(mediaBlobKey(MEDIA_EXTERNAL_REFS_FILENAME)),
      'external refs must persist to blob after apply',
    );
  });

  it('media_attach apply posts mutated note to canister with stamped pointer', async (t) => {
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'int-attach'));
    const notePath = fx.targetNotePath;
    const note = readNote(fx.vaultPath, notePath);
    const baseStateId = noteStateIdFromParts(note.frontmatter ?? {}, note.body ?? '');
    const pointer = fx.fileId; // att_file_* doubles as pointer for non-mist ids
    const proposalId = 'prop-int-attach';

    const noteRows = new Map([
      [notePath, { frontmatter: note.frontmatter ?? {}, body: note.body ?? '' }],
    ]);
    const rows = new Map([
      [
        proposalId,
        mediaAttachRow({
          proposalId,
          attachmentId: fx.fileId,
          noteRef: fx.targetNoteRef,
          baseStateId,
          mediaPointer: pointer,
        }),
      ],
    ]);
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows, noteRows));
    t.after(close);

    const result = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId,
      vaultId: fx.vaultId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.payload.proposal_kind, 'media_attach');

    const written = noteRows.get(notePath);
    assert.ok(written);
    assert.ok(Array.isArray(written.frontmatter.attachments));
    assert.ok(written.frontmatter.attachments.includes(pointer));
  });
});

describe('SEC-SEAM-MEDIA-b — e2e', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.NETLIFY;
    delete process.env.CANISTER_URL;
    delete process.env.SESSION_SECRET;
    delete process.env.BRIDGE_URL;
    delete process.env.HUB_ADMIN_USER_IDS;
  });

  it('admin approve media → media_index_applied true; non-media → no media fields; proxy hits bridge', async (t) => {
    const applyCalls = [];
    const rows = new Map();
    rows.set(
      'prop-media-e2e',
      mediaLinkRow({
        proposalId: 'prop-media-e2e',
        consentId: 'mic_0123456789abcdef',
      }),
    );
    rows.set('prop-note-e2e', plainNoteProposal('prop-note-e2e'));

    const { url: canisterUrl, close: closeCanister } = await startServer(mockCanisterApp(rows));
    t.after(closeCanister);

    const bridgeApp = mockBridgeApp(applyCalls, {
      proposal_kind: 'media_external_link',
      attachment_id: 'att_link_e2e',
      vault_id: 'default',
    });
    // Catch-all must NOT receive attachment proxies — register a marker.
    let catchAllHits = 0;
    bridgeApp.use((req, _res, next) => {
      if (req.path.startsWith('/api/v1/') && !req.path.includes('/attachments/')) {
        catchAllHits += 1;
      }
      next();
    });
    const { url: bridgeUrl, close: closeBridge } = await startServer(bridgeApp);
    t.after(closeBridge);

    const adminSub = ACTOR;
    const port = await bootGateway(t, {
      canisterUrl,
      bridgeUrl,
      adminSub,
      cacheBust: String(Date.now()),
    });

    const token = signTestJwt({
      sub: adminSub,
      actor_kind: 'human',
      session_bound: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const mediaApprove = await fetch(
      `http://127.0.0.1:${port}/api/v1/proposals/prop-media-e2e/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Vault-Id': 'default',
        },
        body: '{}',
      },
    );
    const mediaText = await mediaApprove.text();
    assert.equal(mediaApprove.status, 200, mediaText);
    const mediaBody = JSON.parse(mediaText);
    assert.equal(mediaBody.media_index_applied, true);
    assert.equal(mediaBody.media_apply.proposal_kind, 'media_external_link');
    assert.equal(applyCalls.length, 1);
    assert.equal(applyCalls[0].proposalId, 'prop-media-e2e');

    const noteApprove = await fetch(
      `http://127.0.0.1:${port}/api/v1/proposals/prop-note-e2e/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Vault-Id': 'default',
        },
        body: '{}',
      },
    );
    const noteText = await noteApprove.text();
    assert.equal(noteApprove.status, 200, noteText);
    const noteBody = JSON.parse(noteText);
    assert.equal(noteBody.media_index_applied, undefined);
    assert.equal(noteBody.media_apply, undefined);

    // Gateway proxy for link-proposals hits bridge (not canister catch-all).
    const proxyRes = await fetch(`http://127.0.0.1:${port}/api/v1/attachments/link-proposals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Vault-Id': 'default',
      },
      body: JSON.stringify({ intent: 'x' }),
    });
    assert.equal(proxyRes.status, 201);
    const proxyBody = await proxyRes.json();
    assert.equal(proxyBody.proposal_id, 'proxy-hit');
    assert.equal(catchAllHits, 0);
  });
});

describe('SEC-SEAM-MEDIA-b — stress', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  });

  it('≥50 sequential apply-approved calls; last external-link still listable', async (t) => {
    enableLinkGate();
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'stress'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const rows = new Map();
    const N = 50;
    for (let i = 0; i < N; i++) {
      const opaqueRef = `stress-ref-${String(i).padStart(3, '0')}`;
      const id = `prop-stress-${i}`;
      rows.set(id, mediaLinkRow({ proposalId: id, consentId, opaqueRef }));
    }
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    for (let i = 0; i < N; i++) {
      const result = await applyApprovedMediaProposalFromCanister({
        dataDir: fx.dataDir,
        canisterUrl,
        headers: {},
        proposalId: `prop-stress-${i}`,
        vaultId: fx.vaultId,
      });
      assert.equal(result.ok, true, `i=${i} ${JSON.stringify(result)}`);
    }

    const lastOpaque = `stress-ref-${String(N - 1).padStart(3, '0')}`;
    const lastId = deriveLinkAttachmentId('gdrive', lastOpaque);
    assert.ok(getExternalRef(fx.dataDir, fx.vaultId, lastId));

    const list = handleAttachmentListRequest({
      dataDir: fx.dataDir,
      vaultPath: fx.dataDir,
      vaultId: fx.vaultId,
      visibleScopes: visible,
      source: 'connector_ref',
    });
    assert.equal(list.ok, true);
    assert.ok(list.payload.attachments.some((a) => a.attachment_id === lastId));
  });
});

describe('SEC-SEAM-MEDIA-b — data-integrity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  });

  it('second apply → MEDIA_LINEAGE_CONFLICT without duplicate rows; expired consent refuses', async (t) => {
    enableLinkGate();
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'di'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const opaqueRef = 'di-opaque-unique';
    const proposalId = 'prop-di-link';
    const rows = new Map([
      [proposalId, mediaLinkRow({ proposalId, consentId, opaqueRef })],
    ]);
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const first = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId,
      vaultId: fx.vaultId,
    });
    assert.equal(first.ok, true);

    const second = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId,
      vaultId: fx.vaultId,
    });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'MEDIA_LINEAGE_CONFLICT');

    const store = loadExternalRefStore(fx.dataDir);
    const refs = store.vaults?.[fx.vaultId]?.refs ?? {};
    const attachmentId = deriveLinkAttachmentId('gdrive', opaqueRef);
    assert.equal(Object.keys(refs).filter((k) => k === attachmentId).length, 1);

    // Expired consent refuses precheck on a fresh proposal.
    const expiredConsent = 'mic_abcdef0123456789';
    const consentStore = loadMediaImportConsentStore(fx.dataDir);
    if (!consentStore.vaults[fx.vaultId]) consentStore.vaults[fx.vaultId] = { consents: {} };
    consentStore.vaults[fx.vaultId].consents[expiredConsent] = {
      connector_id: 'gdrive',
      scope: 'personal',
      granted_by: 'uid_hash:test',
      granted_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2020-01-02T00:00:00.000Z',
      status: 'active',
    };
    saveMediaImportConsentStore(fx.dataDir, consentStore);

    const expiredRow = mediaLinkRow({
      proposalId: 'prop-di-expired',
      consentId: expiredConsent,
      opaqueRef: 'di-opaque-expired',
    });
    rows.set('prop-di-expired', expiredRow);
    const expired = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-di-expired',
      vaultId: fx.vaultId,
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'MEDIA_IMPORT_CONSENT_REQUIRED');
  });

  it('blob merge: newest updated wins for external refs; revoked wins for consents', () => {
    const localRefs = JSON.stringify({
      schema: 'knowtation.attachment_external_ref/v0',
      vaults: {
        default: {
          refs: {
            att_a: { updated: '2026-01-02T00:00:00.000Z', opaque_ref: 'local' },
            att_b: { updated: '2026-01-01T00:00:00.000Z', opaque_ref: 'local-b' },
          },
        },
      },
    });
    const blobRefs = JSON.stringify({
      schema: 'knowtation.attachment_external_ref/v0',
      vaults: {
        default: {
          refs: {
            att_a: { updated: '2026-01-01T00:00:00.000Z', opaque_ref: 'blob' },
            att_c: { updated: '2026-01-03T00:00:00.000Z', opaque_ref: 'blob-c' },
          },
        },
      },
    });
    const mergedRefs = JSON.parse(mergeExternalRefStoreJson(localRefs, blobRefs));
    assert.equal(mergedRefs.vaults.default.refs.att_a.opaque_ref, 'local');
    assert.equal(mergedRefs.vaults.default.refs.att_b.opaque_ref, 'local-b');
    assert.equal(mergedRefs.vaults.default.refs.att_c.opaque_ref, 'blob-c');

    const localConsents = JSON.stringify({
      schema: 'knowtation.media_import_consent/v0',
      vaults: {
        default: {
          consents: {
            mic_1: { status: 'active', granted_at: '2026-01-02T00:00:00.000Z' },
            mic_2: { status: 'revoked', granted_at: '2026-01-01T00:00:00.000Z' },
          },
        },
      },
    });
    const blobConsents = JSON.stringify({
      schema: 'knowtation.media_import_consent/v0',
      vaults: {
        default: {
          consents: {
            mic_1: { status: 'revoked', granted_at: '2026-01-01T00:00:00.000Z' },
            mic_2: { status: 'active', granted_at: '2026-01-03T00:00:00.000Z' },
          },
        },
      },
    });
    const mergedConsents = JSON.parse(mergeImportConsentStoreJson(localConsents, blobConsents));
    assert.equal(mergedConsents.vaults.default.consents.mic_1.status, 'revoked');
    assert.equal(mergedConsents.vaults.default.consents.mic_2.status, 'revoked');
  });
});

describe('SEC-SEAM-MEDIA-b — performance', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  });

  it('single apply-approved + list p95 budget < 500ms (local fixture)', async (t) => {
    enableLinkGate();
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'perf'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const rows = new Map([
      ['prop-perf', mediaLinkRow({ proposalId: 'prop-perf', consentId, opaqueRef: 'perf-ref' })],
    ]);
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);

    const samples = [];
    for (let i = 0; i < 5; i++) {
      // Reset store between samples for fair single-apply timing.
      const storePath = path.join(fx.dataDir, 'hub_attachment_external_refs.json');
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      const t0 = performance.now();
      const result = await applyApprovedMediaProposalFromCanister({
        dataDir: fx.dataDir,
        canisterUrl,
        headers: {},
        proposalId: 'prop-perf',
        vaultId: fx.vaultId,
      });
      assert.equal(result.ok, true);
      handleAttachmentListRequest({
        dataDir: fx.dataDir,
        vaultPath: fx.dataDir,
        vaultId: fx.vaultId,
        visibleScopes: visible,
      });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
    // Documented bound: local mock canister + in-process apply < 500ms p95.
    assert.ok(p95 < 500, `p95=${p95}ms samples=${JSON.stringify(samples)}`);
  });
});

describe('SEC-SEAM-MEDIA-b — security', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    delete process.env.MEDIA_ATTACH_ENABLED;
  });

  it('(a) hook trigger ≡ S3.1 media normalize; source-scan forbids parallel SEAM lists', () => {
    const hosted = {
      path: 'meta/media/proposals/p1.json',
      body: JSON.stringify({ proposal_kind: 'media_external_link', scope: 'personal' }),
      frontmatter: {
        [FM_PROPOSAL_SOURCE]: MEDIA_PROPOSAL_SOURCE,
        [FM_MEDIA_PROPOSAL_KIND]: 'media_external_link',
      },
      external_ref: 'scooling.media:p1',
    };
    const normalized = normalizeCanisterProposalForMediaPrecheck(hosted);
    assert.ok(normalized);
    assert.equal(isSeamSurfaceProposal(hosted), true);
    assert.equal(isSeamSurfaceProposal({ path: 'notes/x.md', frontmatter: {}, body: '' }), false);

    // Source-scan: no new SEAM_* kind/intent arrays in media modules.
    const mediaHostedSrc = readRepo('lib/attachments/media-hosted-proposal.mjs');
    const mediaHookSrc = readRepo('hub/gateway/media-approve-hosted.mjs');
    const seamSrc = readRepo('lib/hub-proposal-personal-self-apply.mjs');
    assert.ok(!/SEAM_[A-Z_]*KINDS?\s*=/.test(mediaHostedSrc));
    assert.ok(!/SEAM_[A-Z_]*INTENTS?\s*=/.test(mediaHostedSrc));
    assert.ok(!/SEAM_[A-Z_]*KINDS?\s*=/.test(mediaHookSrc));
    assert.ok(
      seamSrc.includes('normalizeCanisterProposalForMediaPrecheck'),
      'S3.1 must call the same normalize',
    );
    assert.ok(
      mediaHookSrc.includes('normalizeCanisterProposalForMediaPrecheck'),
      'hook classify must call the same normalize',
    );
  });

  it('(b) apply-approved with status proposed → 409', async (t) => {
    enableLinkGate();
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'sec-409'));
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const rows = new Map([
      [
        'prop-sec-pending',
        mediaLinkRow({ proposalId: 'prop-sec-pending', status: 'proposed', consentId }),
      ],
    ]);
    const { url: canisterUrl, close } = await startServer(mockCanisterApp(rows));
    t.after(close);
    const result = await applyApprovedMediaProposalFromCanister({
      dataDir: fx.dataDir,
      canisterUrl,
      headers: {},
      proposalId: 'prop-sec-pending',
      vaultId: fx.vaultId,
    });
    assert.equal(result.status, 409);
    assert.equal(result.code, 'CONFLICT');
  });

  it('(d) opaque_ref never fetched — no http(s) client in media apply path source', () => {
    const applySrc = readRepo('lib/attachments/media-hosted-proposal.mjs');
    const writeSrc = readRepo('lib/attachments/attachment-write.mjs');
    // Apply path must not dereference opaque_ref via fetch to arbitrary URLs.
    // Allowed fetches: canister proposals/notes only (relative to canisterUrl).
    assert.ok(!/opaque_ref[\s\S]{0,80}fetch\(/.test(applySrc));
    assert.ok(!/fetch\([\s\S]{0,80}opaque_ref/.test(writeSrc));
    assert.ok(!/https?:\/\/\$\{/.test(writeSrc.match(/reconcileApprovedMediaProposal[\s\S]{0,800}/)?.[0] ?? ''));
  });

  it('(e) gates-off propose still 403', async () => {
    delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'sec-gate'));
    // Consent grant itself is gated; propose must refuse at the gate before consent.
    const result = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      cliScopes: ['personal', 'project', 'org'],
      body: sampleLinkProposeBody({ consent_id: 'mic_0123456789abcdef' }),
      intent: 'should refuse',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, 'MEDIA_EXTERNAL_LINK_DISABLED');
  });

  it('T5 fingerprint evaluates hosted frontmatter rows after normalize', () => {
    const hosted = {
      proposal_id: 'p-t5',
      path: 'meta/media/proposals/p-t5.json',
      body: JSON.stringify({
        proposal_kind: 'media_external_link',
        scope: 'personal',
      }),
      frontmatter: {
        [FM_PROPOSAL_SOURCE]: MEDIA_PROPOSAL_SOURCE,
        [FM_MEDIA_PROPOSAL_KIND]: 'media_external_link',
      },
      external_ref: 'scooling.media:p-t5',
    };
    assert.equal(matchesScoolingMediaFingerprint(hosted), true);
  });
});
