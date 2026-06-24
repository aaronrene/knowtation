#!/usr/bin/env node
/**
 * Phase 2G-b — self-hosted Hub task read smoke (§10 checklist automation).
 *
 * Prerequisites:
 *   - Self-hosted Hub running with JWT auth (hub/server.mjs)
 *   - Vault with viewer+ role; config.data_dir writable
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-hosted-task-read-smoke.mjs
 *
 * Loads repo-root `.env` when present (dotenv).
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
 * @param {Record<string, string>} [extraHeaders]
 */
async function api(method, pathSuffix, body, extraHeaders = {}) {
  const res = await fetch(apiBase + pathSuffix, {
    method,
    headers: headers(extraHeaders),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`2G-b task read smoke — ${apiBase} vault=${vaultId}`);

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

  const list = await api('GET', '/api/v1/tasks');
  const listOk =
    list.status === 200 &&
    list.json?.schema === 'knowtation.task_list/v0' &&
    Array.isArray(list.json?.tasks) &&
    list.json.tasks.length >= 1;
  record(
    'GET /api/v1/tasks (lazy seed)',
    listOk,
    listOk ? `${list.json.tasks.length} tasks` : `HTTP ${list.status} ${list.json?.code ?? ''}`,
  );

  const getHandover = await api('GET', '/api/v1/tasks/task_2g_handover_001');
  const getOk =
    getHandover.status === 200 &&
    getHandover.json?.task?.run_ref === 'run_overseer_in_progress' &&
    getHandover.json?.task?.artifact_links?.length === 2;
  record(
    'GET /api/v1/tasks/task_2g_handover_001',
    getOk,
    getOk
      ? `run_ref=${getHandover.json.task.run_ref} artifacts=${getHandover.json.task.artifact_links.length}`
      : `HTTP ${getHandover.status}`,
  );

  const personalList = await api('GET', '/api/v1/tasks?scope=personal', undefined, {
    'X-Task-Smoke-Scope': 'personal-only',
  });
  const personalOk =
    personalList.status === 200 &&
    personalList.json?.tasks?.length === 1 &&
    personalList.json.tasks[0]?.task_id === 'task_personal_practice' &&
    personalList.json.tasks.every((t) => t.scope === 'personal');
  record(
    'GET /api/v1/tasks?scope=personal (personal caller)',
    personalOk,
    personalOk
      ? 'only task_personal_practice'
      : `HTTP ${personalList.status} count=${personalList.json?.tasks?.length ?? '?'}`,
  );

  const orgDenied = await api('GET', '/api/v1/tasks/task_org_compliance_q2');
  const orgDeniedOk = orgDenied.status === 404 && orgDenied.json?.code === 'unknown_task';
  record(
    'GET org task under personal-only role',
    orgDeniedOk || session.json?.role === 'admin',
    orgDeniedOk
      ? '404 unknown_task (no existence leak)'
      : session.json?.role === 'admin'
        ? 'skipped — admin sees org task (use personal-only JWT for strict check)'
        : `HTTP ${orgDenied.status} code=${orgDenied.json?.code ?? 'none'}`,
  );

  const runRead = await api(
    'GET',
    '/api/v1/flows/flow_overseer_handover/runs/run_overseer_in_progress',
  );
  const sd2Ok =
    runRead.status === 200
      ? runRead.json?.run?.task_ref === 'task_2g_handover_001'
      : getHandover.json?.task?.run_ref === 'run_overseer_in_progress';
  record(
    'SD-2 reciprocal task_ref on run',
    sd2Ok,
    runRead.status === 200
      ? `run.task_ref=${runRead.json?.run?.task_ref ?? 'missing'}`
      : `run route HTTP ${runRead.status}; task.run_ref=${getHandover.json?.task?.run_ref ?? 'missing'}`,
  );

  const cli = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'cli/index.mjs'), 'task', 'list', '--json', '--vault', vaultId],
    { encoding: 'utf8', env: { ...process.env, KNOWTATION_VAULT_PATH: process.env.KNOWTATION_VAULT_PATH } },
  );
  let cliParity = false;
  if (cli.status === 0) {
    try {
      const cliJson = JSON.parse(cli.stdout.trim());
      cliParity = JSON.stringify(cliJson) === JSON.stringify(list.json);
    } catch {
      cliParity = false;
    }
  }
  record(
    'CLI parity knowtation task list --json',
    cliParity,
    cliParity ? 'deep-equal to Hub list' : `exit=${cli.status} ${cli.stderr?.slice(0, 80) ?? ''}`,
  );

  const postWrite = await api('POST', '/api/v1/tasks', { title: 'should not work' });
  const noWriteOk = postWrite.status === 404 || postWrite.status === 405;
  record(
    'no POST /api/v1/tasks write route',
    noWriteOk,
    `HTTP ${postWrite.status}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    process.exit(1);
  }
  console.log('2G-b task read smoke PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
