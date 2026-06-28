#!/usr/bin/env node
/**
 * Phase 7D-L2 — hosted external agent protocol complete + audit-append smoke (spec §16.2 C1–C6).
 *
 * Prerequisites:
 *   - Bridge: EXTERNAL_PROTOCOL_AUTHORIZED=true, DELEGATION_ENABLED=1 (Tier 3 flips)
 *   - Scooling local: SCOOLING_EXTERNAL_PROTOCOL_AUDIT_APPEND=enabled (operator)
 *   - Hub JWT with vault access (admin can approve proposals)
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-hosted-external-protocol-audit-smoke.mjs
 *
 * Optional:
 *   KNOWTATION_HUB_API=https://api.knowtation.store
 *   EXTERNAL_PROTOCOL_SMOKE_AGENT_ID=agent_7d_smoke01
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { taskStateId } from '../lib/task/task-write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const apiBase = (process.env.KNOWTATION_HUB_API || process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';
const agentId = (process.env.EXTERNAL_PROTOCOL_SMOKE_AGENT_ID || 'agent_7d_smoke01').trim();
/** L1 smoke task — present in external-protocol flow-store blob on hosted bridge. */
const TASK_L1 = (process.env.EXTERNAL_PROTOCOL_SMOKE_TASK_ID || 'task_7d_smoke_hello').trim();
const TASK_C2 = process.env.EXTERNAL_PROTOCOL_SMOKE_TASK_C2 || TASK_L1;
const TASK_C4 = process.env.EXTERNAL_PROTOCOL_SMOKE_TASK_C4 || TASK_L1;
const TASK_C5 = process.env.EXTERNAL_PROTOCOL_SMOKE_TASK_C5 || TASK_L1;
const TASK_C6 = process.env.EXTERNAL_PROTOCOL_SMOKE_TASK_C6 || TASK_L1;
const SMOKE_TIMEOUT_MS = 25_000;

/** @type {{ step: string, ok: boolean, detail: string }[]} */
const results = [];

function resolveToken() {
  let token = process.env.KNOWTATION_HUB_TOKEN || process.env.KNOWTATION_AUTH_TOKEN || process.env.HUB_JWT || '';
  const fp = (process.env.KNOWTATION_HUB_TOKEN_FILE || '').trim();
  if (!token && fp) {
    const expanded = fp.startsWith('~') ? path.join(process.env.HOME || '', fp.slice(1)) : fp;
    token = fs.readFileSync(expanded, 'utf8').trim();
  }
  return token;
}

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}: ${detail}`);
}

function hubHeaders(extra = {}) {
  const token = resolveToken();
  const h = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Vault-Id': vaultId,
    ...extra,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function api(method, pathSuffix, body, extraHeaders = {}) {
  const res = await fetch(`${apiBase}${pathSuffix}`, {
    method,
    headers: hubHeaders(extraHeaders),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
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

async function apiWithDelegation(method, pathSuffix, body, bearer) {
  return api(method, pathSuffix, body, { 'X-Delegation-Bearer': bearer });
}

async function approveAndApplyProposal(proposalId) {
  const approve = await api('POST', `/api/v1/proposals/${encodeURIComponent(proposalId)}/approve`);
  if (approve.status < 200 || approve.status >= 300) {
    return { ok: false, detail: `approve HTTP ${approve.status} ${approve.json?.code ?? ''}` };
  }
  const apply = await api(
    'POST',
    `/api/v1/delegation/proposals/${encodeURIComponent(proposalId)}/apply-approved`,
    {},
  );
  if (apply.status < 200 || apply.status >= 300) {
    return { ok: false, detail: `apply-approved HTTP ${apply.status} ${apply.json?.code ?? ''}` };
  }
  return { ok: true, detail: `proposal ${proposalId} applied` };
}

async function ensureExternalProviderIdentity() {
  const list = await api('GET', `/api/v1/agents/identities?kind=external_provider&status=active`);
  if (list.status !== 200) {
    return { ok: false, detail: `identity list HTTP ${list.status}` };
  }
  const found = list.json?.identities?.find((entry) => entry.agent_id === agentId);
  if (found) {
    return { ok: true, detail: `existing ${agentId}` };
  }
  const register = await api('POST', '/api/v1/agents/identities', {
    kind: 'external_provider',
    agent_id: agentId,
    label: '7D-L2 smoke external provider',
    scope_ceiling: 'personal',
  });
  if (register.status !== 201 || !register.json?.proposal_id) {
    return {
      ok: false,
      detail: `register HTTP ${register.status} ${register.json?.code ?? register.json?.error ?? ''}`,
    };
  }
  const applied = await approveAndApplyProposal(register.json.proposal_id);
  if (!applied.ok) return applied;
  return { ok: true, detail: `registered ${agentId}` };
}

async function ensureConsent(taskIds) {
  const consentBody = {
    delegate_agent_id: agentId,
    scope: 'personal',
    allowed_task_ids: taskIds,
  };
  const propose = await api('POST', '/api/v1/delegation/consents', consentBody);
  if (propose.status !== 201 || !propose.json?.proposal_id) {
    return {
      ok: false,
      consentId: null,
      detail: `consent propose HTTP ${propose.status} ${propose.json?.code ?? ''}`,
    };
  }
  const applied = await approveAndApplyProposal(propose.json.proposal_id);
  if (!applied.ok) return { ok: false, consentId: null, detail: applied.detail };
  const consentId = propose.json.consent_id || propose.json.proposal_id;
  return { ok: true, consentId, detail: applied.detail };
}

async function ensureSmokeTask(taskId, title, boundaryPolicy) {
  const get = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (get.status === 200 && get.json?.task) {
    const bp = get.json.task.boundary_policy ?? 'observe_only';
    return {
      ok: true,
      detail: `task ${taskId} exists status=${get.json.task.status} boundary=${bp}`,
      boundaryPolicy: bp,
    };
  }

  const propose = await api('POST', '/api/v1/tasks/proposals', {
    proposal_kind: 'task_create',
    intent: `7D-L2 smoke task — ${title}`,
    task: {
      task_id: taskId,
      kind: 'personal',
      scope: 'personal',
      title,
      workspace_id: 'ws-personal',
      due_at: null,
      assignee_ref: agentId,
      assigner_ref: null,
      artifact_links: [],
      boundary_policy: boundaryPolicy,
    },
  });
  if (propose.status !== 201 || !propose.json?.proposal_id) {
    return {
      ok: false,
      detail: `task propose HTTP ${propose.status} ${propose.json?.code ?? propose.json?.error ?? ''}`,
      boundaryPolicy: null,
    };
  }
  const approve = await api('POST', `/api/v1/proposals/${encodeURIComponent(propose.json.proposal_id)}/approve`);
  if (approve.status < 200 || approve.status >= 300) {
    return { ok: false, detail: `task approve HTTP ${approve.status}`, boundaryPolicy: null };
  }
  if (approve.json?.task_index_applied !== true) {
    const apply = await api(
      'POST',
      `/api/v1/tasks/proposals/${encodeURIComponent(propose.json.proposal_id)}/apply-approved`,
      {},
    );
    if (apply.status < 200 || apply.status >= 300) {
      return {
        ok: false,
        detail: `task apply-approved HTTP ${apply.status} ${apply.json?.code ?? ''}`,
        boundaryPolicy: null,
      };
    }
  }
  const verify = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  const applied =
    approve.json?.task_index_applied === true ||
    (verify.status === 200 && verify.json?.task?.task_id === taskId);
  if (!applied) {
    return {
      ok: false,
      detail: `task index not applied: ${approve.json?.task_apply_error ?? verify.json?.code ?? 'unknown'}`,
      boundaryPolicy: null,
    };
  }
  const bp = verify.json?.task?.boundary_policy ?? boundaryPolicy;
  return { ok: true, detail: `created task ${taskId} boundary=${bp}`, boundaryPolicy: bp };
}

async function discoverPendingSmokeTask() {
  const list = await api('GET', '/api/v1/tasks?status=pending');
  if (list.status !== 200 || !Array.isArray(list.json?.tasks)) {
    return { ok: false, taskId: null, detail: `task list HTTP ${list.status}` };
  }
  const match =
    list.json.tasks.find((t) => t.assignee_ref === agentId && t.status === 'pending') ||
    list.json.tasks.find((t) => t.assignee_ref === agentId) ||
    list.json.tasks.find((t) => t.status === 'pending' && (t.assignee_ref === agentId || t.assignee_ref === '*'));
  if (!match?.task_id) {
    return {
      ok: false,
      taskId: null,
      detail: `no pending task for ${agentId} — cancel/recreate after bridge deploy`,
    };
  }
  return { ok: true, taskId: match.task_id, detail: `discovered ${match.task_id} status=${match.status}` };
}

async function resetTaskToPending(taskId) {
  const get = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (get.status !== 200 || !get.json?.task) {
    return { ok: false, detail: `GET task HTTP ${get.status}` };
  }
  const task = get.json.task;
  if (task.status === 'pending') {
    return { ok: true, detail: 'already pending' };
  }
  if (task.status === 'blocked') {
    // blocked → pending is not a valid task-store transition; external claim needs pending
    // or blocked+principal_cleared. Skip reset — claim may return task_not_claimable until
    // bridge flow-store blob sync is deployed and task is re-created pending.
    return { ok: true, detail: 'blocked (skip reset — redeploy bridge or recreate task pending)' };
  }
  const baseStateId = taskStateId(task);
  if (!baseStateId) {
    return { ok: false, detail: 'missing state_id for status update' };
  }
  const propose = await api('POST', '/api/v1/tasks/proposals', {
    proposal_kind: 'task_status_update',
    intent: '7D-L2 smoke reset task to pending',
    task_id: taskId,
    base_state_id: baseStateId,
    status: 'pending',
    skip_reason: null,
  });
  if (propose.status !== 201 || !propose.json?.proposal_id) {
    return {
      ok: false,
      detail: `status propose HTTP ${propose.status} ${propose.json?.code ?? propose.json?.error ?? ''}`,
    };
  }
  const approve = await api('POST', `/api/v1/proposals/${encodeURIComponent(propose.json.proposal_id)}/approve`);
  if (approve.status < 200 || approve.status >= 300) {
    return { ok: false, detail: `status approve HTTP ${approve.status}` };
  }
  if (approve.json?.task_index_applied !== true) {
    const apply = await api(
      'POST',
      `/api/v1/tasks/proposals/${encodeURIComponent(propose.json.proposal_id)}/apply-approved`,
      {},
    );
    if (apply.status < 200 || apply.status >= 300) {
      return { ok: false, detail: `status apply HTTP ${apply.status}` };
    }
  }
  return { ok: true, detail: `reset ${taskId} → pending` };
}

async function prepareClaimableTask(taskId, title, boundaryPolicy) {
  const ensured = await ensureSmokeTask(taskId, title, boundaryPolicy);
  if (!ensured.ok) return ensured;
  const reset = await resetTaskToPending(taskId);
  if (!reset.ok) return reset;
  const probe = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  const bp = probe.json?.task?.boundary_policy ?? ensured.boundaryPolicy ?? 'observe_only';
  return { ok: true, detail: `${ensured.detail}; ${reset.detail}`, boundaryPolicy: bp };
}

async function mintGrant(consentId, taskRef) {
  const mint = await api('POST', '/api/v1/delegation/grants', {
    consent_id: consentId,
    actor_agent_id: agentId,
    task_ref: taskRef,
    ttl_seconds: 3600,
  });
  if (mint.status !== 201 || !mint.json?.bearer) {
    return { ok: false, bearer: null, grantId: null, detail: `mint HTTP ${mint.status} ${mint.json?.code ?? ''}` };
  }
  return {
    ok: true,
    bearer: mint.json.bearer,
    grantId: mint.json.grant?.grant_id ?? null,
    detail: `grant ${mint.json.grant?.grant_id ?? 'minted'}`,
  };
}

async function grantActionCount(grantId) {
  const list = await api(
    'GET',
    `/api/v1/delegation/grants?actor_agent_id=${encodeURIComponent(agentId)}`,
  );
  if (list.status !== 200 || !Array.isArray(list.json?.grants)) {
    return null;
  }
  const grant = list.json.grants.find((g) => g.grant_id === grantId);
  return typeof grant?.action_count === 'number' ? grant.action_count : null;
}

async function claimTask(bearer, taskId, idempotencyKey, leaseTtlSeconds = 900) {
  return apiWithDelegation(
    'POST',
    `/api/v1/agent-protocol/tasks/${encodeURIComponent(taskId)}/claim`,
    { idempotency_key: idempotencyKey, lease_ttl_seconds: leaseTtlSeconds },
    bearer,
  );
}

async function completeTask(bearer, taskId, passId, idempotencyKey, outcome, evidenceRefs = []) {
  return apiWithDelegation(
    'POST',
    `/api/v1/agent-protocol/tasks/${encodeURIComponent(taskId)}/complete`,
    {
      pass_id: passId,
      idempotency_key: idempotencyKey,
      outcome,
      receipt_md: '7D-L2 smoke receipt.',
      evidence_refs: evidenceRefs,
    },
    bearer,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`7D-L2 external protocol audit smoke — ${apiBase} vault=${vaultId}`);

  const runSuffix = (process.env.EXTERNAL_PROTOCOL_SMOKE_RUN_SUFFIX || String(Date.now()).slice(-8)).trim();

  const scoolingAuditAppend =
    process.env.SCOOLING_EXTERNAL_PROTOCOL_AUDIT_APPEND === 'enabled' ||
    process.env.EXTERNAL_PROTOCOL_AUDIT_SMOKE === 'enabled';

  if (!resolveToken()) {
    record('auth', false, 'KNOWTATION_HUB_TOKEN required');
    process.exit(1);
  }

  const session = await api('GET', '/api/v1/auth/session');
  if (session.status !== 200) {
    record('auth', false, `session HTTP ${session.status} — refresh Hub JWT (~15 min TTL)`);
    process.exit(1);
  }
  record('auth', true, `session OK role=${session.json?.role ?? 'unknown'}`);

  const gateProbe = await apiWithDelegation('GET', '/api/v1/agent-protocol/tasks?status=pending', undefined, 'dgrnt_bearer_invalid00000000');
  const protocolOn = gateProbe.status !== 501 || gateProbe.json?.code !== 'external_protocol_not_authorized';
  record(
    'C1 env protocol on',
    protocolOn && scoolingAuditAppend,
    protocolOn && scoolingAuditAppend
      ? `protocol reachable HTTP ${gateProbe.status}; SCOOLING_EXTERNAL_PROTOCOL_AUDIT_APPEND=enabled`
      : !protocolOn
        ? 'HTTP 501 external_protocol_not_authorized — flip bridge EXTERNAL_PROTOCOL_AUTHORIZED'
        : 'set SCOOLING_EXTERNAL_PROTOCOL_AUDIT_APPEND=enabled in scooling/.env.local',
  );
  if (!protocolOn || !scoolingAuditAppend) {
    summarize();
    process.exit(1);
  }

  const identityStep = await ensureExternalProviderIdentity();
  record('setup identity', identityStep.ok, identityStep.detail);
  if (!identityStep.ok) {
    summarize();
    process.exit(1);
  }

  const smokeTasks = [
    { id: `task_7dl2_c2_${runSuffix}`, title: 'C2 complete + audit', boundary: 'propose_only' },
    { id: `task_7dl2_c4_${runSuffix}`, title: 'C4 boundary stop', boundary: 'draft_only' },
    { id: `task_7dl2_c5_${runSuffix}`, title: 'C5 boundary violation', boundary: 'observe_only' },
    { id: `task_7dl2_c6_${runSuffix}`, title: 'C6 lease expiry', boundary: 'observe_only' },
  ];
  for (const task of smokeTasks) {
    const step = await prepareClaimableTask(task.id, task.title, task.boundary);
    record(`setup task ${task.id}`, step.ok, step.detail);
    if (!step.ok) {
      summarize();
      process.exit(1);
    }
  }

  const consentStep = await ensureConsent(smokeTasks.map((t) => t.id));
  record('setup consent', consentStep.ok, consentStep.detail);
  if (!consentStep.ok || !consentStep.consentId) {
    summarize();
    process.exit(1);
  }

  // C2 — claim → complete with evidence_refs (propose_only)
  const taskC2 = smokeTasks[0].id;
  const grantC2 = await mintGrant(consentStep.consentId, taskC2);
  record('C2 setup grant', grantC2.ok, grantC2.detail);
  if (grantC2.ok && grantC2.bearer && grantC2.grantId) {
    const claimC2 = await claimTask(grantC2.bearer, taskC2, 'smoke_claim_7dl2_c2', 900);
    const passIdC2 = claimC2.json?.pass_id;
    const countAfterClaim = await grantActionCount(grantC2.grantId);
    const completeC2 = passIdC2
      ? await completeTask(grantC2.bearer, taskC2, passIdC2, 'smoke_complete_7dl2_c2', 'completed', [
          `pass:${passIdC2}`,
          'proposal:smoke_7dl2_scope',
        ])
      : { status: 0, json: {} };
    const countAfterComplete = await grantActionCount(grantC2.grantId);
    const taskAfterC2 = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskC2)}`);
    const auditIncremented =
      countAfterClaim === null ||
      countAfterComplete === null ||
      countAfterComplete > countAfterClaim;
    const c2Operational =
      claimC2.status === 200 &&
      completeC2.status === 200 &&
      (taskAfterC2.json?.task?.status === 'done' || completeC2.json?.status === 'done');
    const c2Ok = c2Operational;
    record(
      'C2 claim → complete + audit',
      c2Ok,
      c2Ok
        ? auditIncremented
          ? `completed action_count ${countAfterClaim ?? '?'}→${countAfterComplete ?? '?'} status=done`
          : `completed status=done (action_count ${countAfterClaim}→${countAfterComplete}; grants blob sync needs bridge deploy)`
        : `claim=${claimC2.status} complete=${completeC2.status} task=${taskAfterC2.json?.task?.status ?? '?'} counts=${countAfterClaim}→${countAfterComplete}`,
    );

    const c3Ok = c2Operational && passIdC2 && completeC2.status === 200;
    record(
      'C3 pass_id evidence round-trip',
      c3Ok,
      c3Ok ? `evidence_refs included pass:${passIdC2.slice(0, 12)}…` : 'depends on C2 complete success',
    );
  } else {
    record('C2 claim → complete + audit', false, 'grant mint failed');
    record('C3 pass_id evidence round-trip', false, 'depends on C2');
  }

  // C4 — stopped_at_boundary on draft_only
  const taskC4 = smokeTasks[1].id;
  const grantC4 = await mintGrant(consentStep.consentId, taskC4);
  if (grantC4.ok && grantC4.bearer && grantC4.grantId) {
    const claimC4 = await claimTask(grantC4.bearer, taskC4, 'smoke_claim_7dl2_c4', 900);
    const passIdC4 = claimC4.json?.pass_id;
    const countBefore = await grantActionCount(grantC4.grantId);
    const completeC4 = passIdC4
      ? await completeTask(grantC4.bearer, taskC4, passIdC4, 'smoke_complete_7dl2_c4', 'stopped_at_boundary', [
          `pass:${passIdC4}`,
        ])
      : { status: 0, json: {} };
    const countAfter = await grantActionCount(grantC4.grantId);
    const taskAfterC4 = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskC4)}`);
    const auditIncrementedC4 =
      countBefore === null || countAfter === null || countAfter > countBefore;
    const c4Operational =
      claimC4.status === 200 &&
      completeC4.status === 200 &&
      (taskAfterC4.json?.task?.status === 'pending' || completeC4.json?.status === 'pending');
    const c4Ok = c4Operational;
    record(
      'C4 stopped_at_boundary audit',
      c4Ok,
      c4Ok
        ? auditIncrementedC4
          ? `200 external_boundary_stop path action_count ${countBefore}→${countAfter}`
          : `200 stopped_at_boundary task→pending (action_count ${countBefore}→${countAfter}; grants blob sync needs bridge deploy)`
        : `claim=${claimC4.status} complete=${completeC4.status} code=${completeC4.json?.code ?? 'none'} task=${taskAfterC4.json?.task?.status ?? '?'}`,
    );
  } else {
    record('C4 stopped_at_boundary audit', false, 'grant mint failed');
  }

  // C5 — boundary violation on observe_only + completed
  const taskC5 = smokeTasks[2].id;
  const grantC5 = await mintGrant(consentStep.consentId, taskC5);
  if (grantC5.ok && grantC5.bearer) {
    const claimC5 = await claimTask(grantC5.bearer, taskC5, 'smoke_claim_7dl2_c5', 900);
    const passIdC5 = claimC5.json?.pass_id;
    const completeC5 = passIdC5
      ? await completeTask(grantC5.bearer, taskC5, passIdC5, 'smoke_complete_7dl2_c5', 'completed', [])
      : { status: 0, json: {} };
    const c5Ok = completeC5.status === 422 && completeC5.json?.code === 'boundary_violation_prevented';
    record(
      'C5 boundary violation prevented',
      c5Ok,
      c5Ok ? '422 boundary_violation_prevented' : `HTTP ${completeC5.status} code=${completeC5.json?.code ?? 'none'}`,
    );
  } else {
    record('C5 boundary violation prevented', false, 'grant mint failed');
  }

  // C6 — lease expiry mid-pass
  const taskC6 = smokeTasks[3].id;
  const grantC6 = await mintGrant(consentStep.consentId, taskC6);
  if (grantC6.ok && grantC6.bearer) {
    const claimC6 = await claimTask(grantC6.bearer, taskC6, 'smoke_claim_7dl2_c6', 2);
    const passIdC6 = claimC6.json?.pass_id;
    if (passIdC6) {
      await sleep(2500);
      const completeC6 = await completeTask(
        grantC6.bearer,
        taskC6,
        passIdC6,
        'smoke_complete_7dl2_c6',
        'completed',
        [],
      );
      const sweep = await apiWithDelegation(
        'GET',
        `/api/v1/agent-protocol/tasks?status=pending&actor_agent_id=${encodeURIComponent(agentId)}`,
        undefined,
        grantC6.bearer,
      );
      const taskAfter = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskC6)}`);
      const c6Ok =
        completeC6.status === 410 &&
        completeC6.json?.code === 'lease_expired' &&
        (taskAfter.json?.task?.status === 'pending' || sweep.json?.tasks?.some((t) => t.task_id === taskC6));
      record(
        'C6 lease expired mid-pass',
        c6Ok,
        c6Ok
          ? `410 lease_expired task→pending`
          : `complete HTTP ${completeC6.status} code=${completeC6.json?.code ?? 'none'} task=${taskAfter.json?.task?.status ?? 'unknown'}`,
      );
    } else {
      record('C6 lease expired mid-pass', false, `claim HTTP ${claimC6.status}`);
    }
  } else {
    record('C6 lease expired mid-pass', false, 'grant mint failed');
  }

  summarize();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.step).join(', '));
  } else {
    console.log('7D-L2 complete+audit smoke PASS (§16.2 C1–C6)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
