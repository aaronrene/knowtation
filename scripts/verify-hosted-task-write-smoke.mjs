#!/usr/bin/env node
/**
 * Phase 2G-d — self-hosted Hub task write smoke (propose path; gates off by default).
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-hosted-task-write-smoke.mjs
 *
 * With writes enabled on Hub (staging Tier 3 only):
 *   TASK_WRITES_ENABLED=1 node scripts/verify-hosted-task-write-smoke.mjs --live-propose
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const livePropose = process.argv.includes('--live-propose');

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
  return { status: res.status, json };
}

async function main() {
  console.log(`2G-d task write smoke — ${apiBase} vault=${vaultId} livePropose=${livePropose}`);

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

  const disabled = await api('POST', '/api/v1/tasks/proposals', {
    proposal_kind: 'task_create',
    intent: 'smoke should refuse when gated off',
    task: {
      task_id: 'task_smoke_disabled',
      kind: 'personal',
      scope: 'personal',
      title: 'Smoke disabled',
      workspace_id: 'ws_personal',
      due_at: null,
      assignee_ref: null,
      assigner_ref: null,
      artifact_links: [],
    },
  });
  const disabledOk = disabled.status === 403 && disabled.json?.code === 'TASK_WRITES_DISABLED';
  record(
    'POST /api/v1/tasks/proposals gated off',
    disabledOk,
    disabledOk ? '403 TASK_WRITES_DISABLED' : `HTTP ${disabled.status} code=${disabled.json?.code ?? 'none'}`,
  );

  const loopDisabled = await api('POST', '/api/v1/task-loops/proposals', {
    proposal_kind: 'task_loop_create',
    intent: 'smoke loop refuse',
    loop: {
      loop_id: 'loop_smoke_disabled',
      kind: 'personal',
      scope: 'personal',
      title: 'Smoke loop',
      workspace_id: 'ws_personal',
      status: 'active',
      recurrence: { kind: 'manual' },
      timezone: 'UTC',
      boundary_policy: 'observe_only',
      memory_links: [],
    },
  });
  const loopDisabledOk = loopDisabled.status === 403 && loopDisabled.json?.code === 'TASK_WRITES_DISABLED';
  record(
    'POST /api/v1/task-loops/proposals gated off',
    loopDisabledOk,
    loopDisabledOk ? '403 TASK_WRITES_DISABLED' : `HTTP ${loopDisabled.status}`,
  );

  if (livePropose) {
    if (process.env.TASK_WRITES_ENABLED !== '1' && process.env.TASK_WRITES_ENABLED !== 'true') {
      record('--live-propose', false, 'Set TASK_WRITES_ENABLED=1 on Hub for live propose smoke');
    } else {
      const live = await api('POST', '/api/v1/tasks/proposals', {
        proposal_kind: 'task_create',
        intent: 'hosted smoke live propose',
        task: {
          task_id: `task_smoke_${Date.now()}`,
          kind: 'personal',
          scope: 'personal',
          title: 'Hosted smoke task',
          workspace_id: 'ws_personal',
          due_at: null,
          assignee_ref: null,
          assigner_ref: null,
          artifact_links: [],
        },
      });
      const liveOk = live.status === 201 && live.json?.schema === 'knowtation.task_proposal/v0';
      record(
        'live propose when TASK_WRITES_ENABLED',
        liveOk,
        liveOk ? `proposal_id=${live.json.proposal_id}` : `HTTP ${live.status} code=${live.json?.code ?? ''}`,
      );
    }
  } else {
    record('--live-propose skipped', true, 'default — gates off; pass disabled checks only');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
  console.log('2G-d task write smoke PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
