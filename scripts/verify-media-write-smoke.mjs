#!/usr/bin/env node
/**
 * Phase 2F-b-d-kn-b/c/d — self-hosted Hub media write smoke (propose only; approve via UI/test admin).
 *
 * Default (gates off): verifies propose routes refuse with MEDIA_*_DISABLED.
 *
 * Live mode (--live-propose): when dev/staging policy file (or env) has gates on and connector
 * allowlist seeded:
 *   1. auth session
 *   2. POST import-consent (grant gdrive)
 *   3. POST link-proposals → 201 knowtation.media_proposal/v0
 *   4. POST attach-proposals → 201 when attach gate on (2F-b-d-kn-d); 403 when off (2F-b-d-kn-c)
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-media-write-smoke.mjs
 *
 * Live propose (after scripts/seed-media-write-staging.mjs + Hub restart):
 *   KNOWTATION_HUB_API=http://localhost:3333 \
 *     node scripts/verify-media-write-smoke.mjs --live-propose
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { loadConfig } from '../lib/config.mjs';
import {
  getMediaAttachEnabled,
  getMediaExternalLinkEnabled,
} from '../lib/attachments/attachment-write.mjs';
import { noteStateIdFromParts } from '../lib/note-state-id.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const livePropose = process.argv.includes('--live-propose');

function resolveDataDir() {
  const fromEnv = (process.env.KNOWTATION_DATA_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  const config = loadConfig(repoRoot);
  const dir = config?.data_dir || 'data/';
  return path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
}

function resolveToken() {
  let t =
    process.env.KNOWTATION_HUB_TOKEN ||
    process.env.HUB_JWT ||
    process.env.KNOWTATION_HUB_TOKEN_LOCAL ||
    '';
  const fp = (process.env.KNOWTATION_HUB_TOKEN_FILE || '').trim();
  if (!t && fp) {
    const expanded = fp.startsWith('~') ? path.join(process.env.HOME || '', fp.slice(1)) : fp;
    t = fs.readFileSync(expanded, 'utf8').trim();
  }
  return t;
}

const token = resolveToken();
const apiBase = (
  process.env.KNOWTATION_HUB_API ||
  process.env.KNOWTATION_HUB_URL ||
  process.env.KNOWTATION_HUB_URL_LOCAL ||
  'http://localhost:3000'
).replace(/\/$/, '');
const vaultId =
  process.env.KNOWTATION_HUB_VAULT_ID ||
  process.env.KNOWTATION_HUB_VAULT_ID_LOCAL ||
  'default';
const dataDir = resolveDataDir();

/** @type {{ step: string, ok: boolean, detail: string }[]} */
const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}: ${detail}`);
}

function headers(extra = {}) {
  const h = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Vault-Id': vaultId,
    ...extra,
  };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

async function api(method, pathSuffix, body) {
  const res = await fetch(apiBase + pathSuffix, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, text };
}

async function runGatedOffSmoke() {
  const linkOff = await api('POST', '/api/v1/attachments/link-proposals', {
    intent: 'smoke',
    scope: 'personal',
    connector_id: 'gdrive',
    opaque_ref: 'smoke-ref',
    consent_id: 'mic_0123456789abcdef',
  });
  const linkGateOk =
    linkOff.status === 403 && linkOff.json?.code === 'MEDIA_EXTERNAL_LINK_DISABLED';
  record('link gate off → MEDIA_EXTERNAL_LINK_DISABLED', linkGateOk, `HTTP ${linkOff.status}`);

  const attachOff = await api('POST', '/api/v1/attachments/attach-proposals', {
    intent: 'smoke',
    scope: 'personal',
    attachment_id: 'att_file_' + '0'.repeat(32),
    note_ref: 'note:notes/smoke.md',
    base_state_id: 'kn1_' + '0'.repeat(16),
  });
  const attachGateOk =
    attachOff.status === 403 && attachOff.json?.code === 'MEDIA_ATTACH_DISABLED';
  record('attach gate off → MEDIA_ATTACH_DISABLED', attachGateOk, `HTTP ${attachOff.status}`);

  const consentList = await api('GET', '/api/v1/attachments/import-consents');
  const listOk =
    consentList.status === 200 &&
    consentList.json?.schema === 'knowtation.media_import_consent_list/v0';
  record('GET import-consents (read always allowed)', listOk, `HTTP ${consentList.status}`);

  record('--live-propose skipped', true, 'default — gates off; pass disabled checks only');
}

/**
 * Discover an attachment_id and note target for live attach propose.
 * @returns {Promise<{ attachmentId: string, noteRef: string, baseStateId: string }|null>}
 */
async function discoverAttachTargets() {
  const configuredPath = (process.env.MEDIA_SMOKE_NOTE_PATH || '').trim();
  /** @type {string[]} */
  const notePathCandidates = [];
  if (configuredPath) {
    notePathCandidates.push(configuredPath.replace(/^note:/, ''));
  }
  notePathCandidates.push('inbox/note-VIDEO-URL_TEST.md', 'inbox/test-proposal.md');

  const notesList = await api('GET', '/api/v1/notes?limit=5');
  if (notesList.status === 200 && Array.isArray(notesList.json?.notes)) {
    for (const n of notesList.json.notes) {
      if (typeof n?.path === 'string' && !notePathCandidates.includes(n.path)) {
        notePathCandidates.push(n.path);
      }
    }
  }

  let noteRef = null;
  let baseStateId = null;
  for (const notePath of notePathCandidates) {
    const noteGet = await api('GET', `/api/v1/notes/${encodeURIComponent(notePath)}`);
    if (noteGet.status !== 200) continue;
    noteRef = notePath.startsWith('note:') ? notePath : `note:${notePath}`;
    baseStateId = noteStateIdFromParts(noteGet.json?.frontmatter ?? {}, noteGet.json?.body ?? '');
    break;
  }
  if (!noteRef || !baseStateId) return null;

  const attachList = await api('GET', '/api/v1/attachments?limit=20');
  const attachmentId = attachList.json?.attachments?.[0]?.attachment_id;
  if (!attachmentId) return null;

  return { attachmentId, noteRef, baseStateId };
}

async function runLiveProposeSmoke() {
  const attachGateOn = getMediaAttachEnabled(dataDir);
  const linkGateOn = getMediaExternalLinkEnabled(dataDir);
  record(
    'policy gates (data_dir)',
    linkGateOn,
    `link=${linkGateOn ? 'ON' : 'OFF'} attach=${attachGateOn ? 'ON' : 'OFF'} dir=${dataDir}`,
  );

  const smokeSuffix = String(Date.now());
  const opaqueRef = `smoke-${smokeSuffix}`;

  const consentGrant = await api('POST', '/api/v1/attachments/import-consents', {
    connector_id: 'gdrive',
    scope: 'personal',
    expires_at: null,
  });
  const consentOk =
    consentGrant.status === 201 &&
    consentGrant.json?.schema === 'knowtation.media_import_consent/v0' &&
    typeof consentGrant.json?.consent_id === 'string';
  record(
    'grant import consent (gdrive)',
    consentOk,
    consentOk
      ? `consent_id=${consentGrant.json.consent_id}`
      : `HTTP ${consentGrant.status} code=${consentGrant.json?.code ?? ''}`,
  );

  const consentId = consentOk ? consentGrant.json.consent_id : 'mic_0123456789abcdef';

  const linkLive = await api('POST', '/api/v1/attachments/link-proposals', {
    intent: '2F-b-d-kn-d smoke live link propose',
    scope: 'personal',
    connector_id: 'gdrive',
    opaque_ref: opaqueRef,
    consent_id: consentId,
    display_label: 'Smoke board',
  });
  const linkLiveOk =
    linkLive.status === 201 && linkLive.json?.schema === 'knowtation.media_proposal/v0';
  record(
    'live link propose',
    linkLiveOk,
    linkLiveOk
      ? `proposal_id=${linkLive.json.proposal_id} kind=${linkLive.json.proposal_kind}`
      : `HTTP ${linkLive.status} code=${linkLive.json?.code ?? ''}`,
  );

  if (attachGateOn) {
    const targets = await discoverAttachTargets();
    if (!targets) {
      record(
        'discover attach targets',
        false,
        'need ≥1 attachment in vault and readable note (set MEDIA_SMOKE_NOTE_PATH)',
      );
    } else {
      record(
        'discover attach targets',
        true,
        `attachment_id=${targets.attachmentId} note_ref=${targets.noteRef}`,
      );

      const attachLive = await api('POST', '/api/v1/attachments/attach-proposals', {
        intent: '2F-b-d-kn-d smoke live attach propose',
        scope: 'personal',
        attachment_id: targets.attachmentId,
        note_ref: targets.noteRef,
        base_state_id: targets.baseStateId,
      });
      const attachLiveOk =
        attachLive.status === 201 && attachLive.json?.schema === 'knowtation.media_proposal/v0';
      record(
        'live attach propose',
        attachLiveOk,
        attachLiveOk
          ? `proposal_id=${attachLive.json.proposal_id} kind=${attachLive.json.proposal_kind}`
          : `HTTP ${attachLive.status} code=${attachLive.json?.code ?? ''}`,
      );
    }
  } else {
    const attachLive = await api('POST', '/api/v1/attachments/attach-proposals', {
      intent: 'smoke attach must stay disabled',
      scope: 'personal',
      attachment_id: linkLive.json?.attachment_id ?? 'att_link_' + '0'.repeat(32),
      note_ref: 'note:notes/smoke.md',
      base_state_id: 'kn1_' + '0'.repeat(16),
    });
    const attachStillOff =
      attachLive.status === 403 && attachLive.json?.code === 'MEDIA_ATTACH_DISABLED';
    record(
      'attach gate still off → MEDIA_ATTACH_DISABLED',
      attachStillOff,
      attachStillOff
        ? '403 MEDIA_ATTACH_DISABLED'
        : `HTTP ${attachLive.status} code=${attachLive.json?.code ?? ''}`,
    );
  }

  const consentList = await api('GET', '/api/v1/attachments/import-consents');
  const listOk =
    consentList.status === 200 &&
    consentList.json?.schema === 'knowtation.media_import_consent_list/v0';
  record('GET import-consents (read always allowed)', listOk, `HTTP ${consentList.status}`);
}

async function verifyAuth() {
  const session = await api('GET', '/api/v1/auth/session');
  if (session.status === 200) {
    record('auth', true, `session OK role=${session.json?.role ?? 'unknown'}`);
    return true;
  }
  // Self-hosted hub (hub/server.mjs) has no /auth/session — probe import-consents read instead.
  const probe = await api('GET', '/api/v1/attachments/import-consents');
  if (probe.status === 200) {
    record('auth', true, 'self-hosted probe OK (import-consents HTTP 200)');
    return true;
  }
  record(
    'auth',
    false,
    `session HTTP ${session.status}; import-consents probe HTTP ${probe.status} — refresh Hub JWT`,
  );
  return false;
}

async function main() {
  console.log(
    `2F-b-d-kn media write smoke — ${apiBase} vault=${vaultId} livePropose=${livePropose}`,
  );

  if (!token) {
    record('auth', false, 'KNOWTATION_HUB_TOKEN (or _FILE) required');
    process.exit(1);
  }

  if (!(await verifyAuth())) process.exit(1);

  if (livePropose) {
    await runLiveProposeSmoke();
  } else {
    await runGatedOffSmoke();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);

  const attachOn = getMediaAttachEnabled(dataDir);
  console.log(
    livePropose
      ? attachOn
        ? '2F-b-d-kn-d media write smoke PASS (live link + attach propose)'
        : '2F-b-d-kn-c media write smoke PASS (live link propose; attach gate confirmed off)'
      : '2F-b-d-kn-b media write smoke PASS (propose-only; gates confirmed off)',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
