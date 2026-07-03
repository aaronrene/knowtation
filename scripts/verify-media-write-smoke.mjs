#!/usr/bin/env node
/**
 * Phase 2F-b-d-kn-b — self-hosted Hub media write smoke (propose only; approve via UI/test admin).
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-media-write-smoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

function resolveToken() {
  let t = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_JWT || '';
  const fp = (process.env.KNOWTATION_HUB_TOKEN_FILE || '').trim();
  if (!t && fp) {
    const expanded = fp.startsWith('~') ? path.join(process.env.HOME || '', fp.slice(1)) : fp;
    t = fs.readFileSync(expanded, 'utf8').trim();
  }
  return t;
}

const token = resolveToken();
const apiBase = (process.env.KNOWTATION_HUB_API || 'http://localhost:3000').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';

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

async function main() {
  console.log(`2F-b-d-kn-b media write smoke — ${apiBase} vault=${vaultId}`);

  if (!token) {
    record('auth', false, 'KNOWTATION_HUB_TOKEN (or _FILE) required');
    process.exit(1);
  }

  const session = await api('GET', '/api/v1/auth/session');
  if (session.status !== 200) {
    record('auth', false, `session HTTP ${session.status}`);
    process.exit(1);
  }
  record('auth', true, `session OK role=${session.json?.role ?? 'unknown'}`);

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

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
  console.log('2F-b-d-kn-b media write smoke PASS (propose-only; gates confirmed off)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
