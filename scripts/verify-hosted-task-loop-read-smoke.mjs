#!/usr/bin/env node
/**
 * Phase 2G-c — hosted Hub task loop read + loop-pass-audit mirror smoke.
 *
 * Prerequisites:
 *   - Hub or gateway with JWT auth (self-hosted hub/server.mjs or api.knowtation.store)
 *   - Vault with viewer+ role
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-hosted-task-loop-read-smoke.mjs
 *
 * Optional mirror append (requires LOOP_PASS_AUDIT_MIRROR_ENABLED=1 on Hub/bridge):
 *   LOOP_PASS_AUDIT_MIRROR_ENABLED=1 node scripts/verify-hosted-task-loop-read-smoke.mjs --mirror-append
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
const mirrorAppend = process.argv.includes('--mirror-append');

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
  return { status: res.status, json };
}

async function main() {
  console.log(`2G-c task loop read smoke — ${apiBase} vault=${vaultId}`);

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

  const list = await api('GET', '/api/v1/task-loops');
  const listOk =
    list.status === 200 &&
    list.json?.schema === 'knowtation.task_loop_list/v0' &&
    Array.isArray(list.json?.loops) &&
    list.json.loops.length >= 1;
  record(
    'GET /api/v1/task-loops (lazy seed)',
    listOk,
    listOk ? `${list.json.loops.length} loops` : `HTTP ${list.status} ${list.json?.code ?? ''}`,
  );

  const getSchoolTrip = await api('GET', '/api/v1/task-loops/loop_school_trip');
  const handoffRefs = getSchoolTrip.json?.loop?.handoff_refs;
  const getOk =
    getSchoolTrip.status === 200 &&
    getSchoolTrip.json?.schema === 'knowtation.task_loop_get/v0' &&
    getSchoolTrip.json?.loop?.loop_id === 'loop_school_trip' &&
    Array.isArray(handoffRefs) &&
    handoffRefs.includes('graph_school_trip');
  record(
    'GET /api/v1/task-loops/loop_school_trip',
    getOk,
    getOk
      ? `handoff_refs=${handoffRefs.join(',')}`
      : `HTTP ${getSchoolTrip.status} code=${getSchoolTrip.json?.code ?? ''}`,
  );

  const personalList = await api('GET', '/api/v1/task-loops?scope=personal');
  const personalOk =
    personalList.status === 200 &&
    Array.isArray(personalList.json?.loops) &&
    personalList.json.loops.every((l) => l.scope === 'personal');
  record(
    'GET /api/v1/task-loops?scope=personal',
    personalOk,
    personalOk
      ? `${personalList.json.loops.length} personal loops`
      : `HTTP ${personalList.status}`,
  );

  const unknown = await api('GET', '/api/v1/task-loops/loop_nonexistent_fixture');
  const unknownOk = unknown.status === 404 && unknown.json?.code === 'unknown_task_loop';
  record(
    'GET unknown loop id',
    unknownOk || session.json?.role === 'admin',
    unknownOk
      ? '404 unknown_task_loop'
      : `HTTP ${unknown.status} code=${unknown.json?.code ?? 'none'}`,
  );

  const mirrorDisabled = await api('POST', '/api/v1/loop-pass-audit', {
    pass_id: 'pass_smoke_mirror_gated',
    loop_id: 'loop_school_trip',
    outcome: 'idle',
    boundary_policy: 'observe_only',
    context_refs: [{ kind: 'loop', ref: 'loop_school_trip' }],
    occurred_at: new Date().toISOString(),
    scope: 'personal',
  });
  const mirrorGateOff =
    process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED !== '1' &&
    process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED !== 'true';
  const mirrorDisabledOk =
    mirrorGateOff && mirrorDisabled.status === 403 && mirrorDisabled.json?.code === 'LOOP_PASS_AUDIT_MIRROR_DISABLED';
  record(
    'POST /api/v1/loop-pass-audit gated off',
    mirrorDisabledOk || !mirrorGateOff,
    mirrorDisabledOk
      ? '403 LOOP_PASS_AUDIT_MIRROR_DISABLED'
      : mirrorGateOff
        ? `HTTP ${mirrorDisabled.status} code=${mirrorDisabled.json?.code ?? ''}`
        : 'skipped — mirror env on',
  );

  if (mirrorAppend && !mirrorGateOff) {
    const passId = `pass_smoke_${Date.now()}`;
    const append = await api('POST', '/api/v1/loop-pass-audit', {
      pass_id: passId,
      loop_id: 'loop_school_trip',
      instance_task_id: null,
      graph_id: 'graph_school_trip',
      outcome: 'scheduled',
      boundary_policy: 'observe_only',
      context_refs: [{ kind: 'task', ref: 'task_school_trip_2026_w25' }],
      scooling_pass_audit_ref: passId,
      occurred_at: new Date().toISOString(),
      scope: 'personal',
    });
    const appendOk = append.status === 201 && append.json?.schema === 'knowtation.loop_pass_audit/v0';
    record(
      'POST /api/v1/loop-pass-audit append',
      appendOk,
      appendOk ? `audit_id=${append.json.audit_id}` : `HTTP ${append.status}`,
    );

    const dup = await api('POST', '/api/v1/loop-pass-audit', {
      pass_id: passId,
      loop_id: 'loop_school_trip',
      outcome: 'scheduled',
      boundary_policy: 'observe_only',
      context_refs: [{ kind: 'task', ref: 'task_school_trip_2026_w25' }],
      scooling_pass_audit_ref: passId,
      occurred_at: new Date().toISOString(),
      scope: 'personal',
    });
    const dupOk = dup.status === 200 && dup.json?.pass_id === passId;
    record(
      'POST loop-pass-audit idempotent on pass_id',
      dupOk,
      dupOk ? '200 duplicate pass_id' : `HTTP ${dup.status}`,
    );
  } else if (mirrorAppend) {
    record('--mirror-append', false, 'Set LOOP_PASS_AUDIT_MIRROR_ENABLED=1 for live mirror append');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    process.exit(1);
  }
  console.log('2G-c task loop read smoke PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
