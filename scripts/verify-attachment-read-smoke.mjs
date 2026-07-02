#!/usr/bin/env node
/**
 * Phase 2F-b-b — self-hosted Hub attachment read smoke (§10 checklist automation).
 *
 * Prerequisites:
 *   - Self-hosted Hub running with JWT auth (hub/server.mjs)
 *   - Vault with media file, mist frontmatter note, embedded URL note
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-attachment-read-smoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${step}: ${detail}`);
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

/**
 * @param {string} method
 * @param {string} pathSuffix
 * @param {object | undefined} body
 */
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

const LEAK_MARKERS = ['file://', '/Users/', 'token', 'X-Amz-', 'OCR'];

async function main() {
  console.log(`2F-b-b attachment read smoke — ${apiBase} vault=${vaultId}`);

  if (!token) {
    record('auth', false, 'KNOWTATION_HUB_TOKEN (or _FILE) required');
    process.exit(1);
  }

  const session = await api('GET', '/api/v1/auth/session');
  if (session.status !== 200) {
    record('auth', false, `session HTTP ${session.status} — refresh Hub JWT`);
    process.exit(1);
  }
  record('auth', true, `session OK role=${session.json?.role ?? 'unknown'}`);

  const list = await api('GET', '/api/v1/attachments');
  const listOk =
    list.status === 200 &&
    list.json?.schema === 'knowtation.attachment_list/v0' &&
    Array.isArray(list.json?.attachments) &&
    list.json.attachments.length >= 1;
  record(
    'GET /api/v1/attachments',
    listOk,
    listOk ? `${list.json.attachments.length} attachments` : `HTTP ${list.status}`,
  );

  const vaultFile = list.json?.attachments?.find((a) => a.source === 'vault_file');
  const fileGet = vaultFile
    ? await api('GET', `/api/v1/attachments/${encodeURIComponent(vaultFile.attachment_id)}`)
    : { status: 0, json: null };
  const fileGetOk =
    fileGet.status === 200 &&
    fileGet.json?.attachment?.storage_kind === 'vault_blob' &&
    Array.isArray(fileGet.json?.attachment?.linked_note_refs);
  record(
    'GET vault_file attachment',
    fileGetOk,
    fileGetOk ? vaultFile.attachment_id : `HTTP ${fileGet.status}`,
  );

  const embeddedList = await api('GET', '/api/v1/attachments?source=embedded_url');
  const embeddedOk =
    embeddedList.status === 200 &&
    embeddedList.json?.attachments?.length >= 1 &&
    embeddedList.json.attachments.every((a) => a.storage_kind === 'external_link') &&
    embeddedList.json.attachments.every((a) => !String(a.display_label).includes('://'));
  record(
    'GET ?source=embedded_url',
    embeddedOk,
    embeddedOk ? 'host-only labels' : `HTTP ${embeddedList.status}`,
  );

  const projectRow = list.json?.attachments?.find((a) => a.scope === 'project');
  if (projectRow && session.json?.role !== 'admin') {
    const personalDenied = await api(
      'GET',
      `/api/v1/attachments/${encodeURIComponent(projectRow.attachment_id)}`,
      undefined,
    );
    const deniedOk =
      personalDenied.status === 404 && personalDenied.json?.code === 'unknown_attachment';
    record('GET project attachment under personal role', deniedOk, `HTTP ${personalDenied.status}`);
  } else {
    record(
      'GET project attachment under personal role',
      true,
      projectRow ? 'skipped — admin role or no project row' : 'no project-scoped row in vault',
    );
  }

  const cli = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'cli/index.mjs'), 'attachment', 'list', '--json', '--vault', vaultId],
    { encoding: 'utf8', env: { ...process.env } },
  );
  let cliParity = false;
  if (cli.status === 0 && listOk) {
    try {
      const cliJson = JSON.parse(cli.stdout.trim());
      cliParity = JSON.stringify(cliJson) === JSON.stringify(list.json);
    } catch {
      cliParity = false;
    }
  }
  record(
    'CLI parity attachment list --json',
    cliParity,
    cliParity ? 'deep-equal to Hub list' : `exit=${cli.status}`,
  );

  const postWrite = await api('POST', '/api/v1/attachments', { display_label: 'nope' });
  const noWriteOk = postWrite.status === 404 || postWrite.status === 405;
  record('no POST /api/v1/attachments', noWriteOk, `HTTP ${postWrite.status}`);

  const bodies = [list.text, fileGet.text ?? '', embeddedList.text].join('\n');
  const leakHits = LEAK_MARKERS.filter((m) => bodies.includes(m));
  record('grep leak markers', leakHits.length === 0, leakHits.length ? leakHits.join(', ') : 'zero matches');

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    process.exit(1);
  }
  console.log('2F-b-b attachment read smoke PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
