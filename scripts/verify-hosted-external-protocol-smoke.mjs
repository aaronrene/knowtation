#!/usr/bin/env node
/**
 * Phase 7D-L1 — hosted external agent protocol validate-only smoke (spec §16.1 E1–E6).
 *
 * Prerequisites:
 *   - Bridge: EXTERNAL_PROTOCOL_AUTHORIZED=true (Tier 3 flip)
 *   - Hub JWT with vault access (admin can approve proposals)
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-hosted-external-protocol-smoke.mjs
 *
 * Optional:
 *   KNOWTATION_HUB_API=https://api.knowtation.store
 *   EXTERNAL_PROTOCOL_SMOKE_AGENT_ID=agent_7d_smoke01
 *   EXTERNAL_PROTOCOL_SMOKE_TASK_ID=task_7d_smoke_hello
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const apiBase = (process.env.KNOWTATION_HUB_API || process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';
const agentId = (process.env.EXTERNAL_PROTOCOL_SMOKE_AGENT_ID || 'agent_7d_smoke01').trim();
const taskId = (process.env.EXTERNAL_PROTOCOL_SMOKE_TASK_ID || 'task_7d_smoke_hello').trim();
const SMOKE_TIMEOUT_MS = 20_000;

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
    label: '7D-L1 smoke external provider',
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

async function ensureConsent() {
  const consentBody = {
    delegate_agent_id: agentId,
    scope: 'personal',
    allowed_task_ids: [taskId],
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

async function ensureSmokeTask() {
  const get = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (get.status === 200 && get.json?.task) {
    return { ok: true, detail: `task ${taskId} exists status=${get.json.task.status}` };
  }

  const propose = await api('POST', '/api/v1/tasks/proposals', {
    proposal_kind: 'task_create',
    intent: '7D-L1 smoke task — say hello from the queue',
    task: {
      task_id: taskId,
      kind: 'personal',
      scope: 'personal',
      title: 'say hello from the queue',
      workspace_id: 'ws-personal',
      due_at: null,
      assignee_ref: agentId,
      assigner_ref: null,
      artifact_links: [],
    },
  });
  if (propose.status !== 201 || !propose.json?.proposal_id) {
    return {
      ok: false,
      detail: `task propose HTTP ${propose.status} ${propose.json?.code ?? propose.json?.error ?? ''}`,
    };
  }
  const approve = await api('POST', `/api/v1/proposals/${encodeURIComponent(propose.json.proposal_id)}/approve`);
  if (approve.status < 200 || approve.status >= 300) {
    return { ok: false, detail: `task approve HTTP ${approve.status}` };
  }
  const verify = await api('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  const applied =
    approve.json?.task_index_applied === true ||
    (verify.status === 200 && verify.json?.task?.task_id === taskId);
  if (!applied) {
    return {
      ok: false,
      detail: `task index not applied after approve: ${approve.json?.task_apply_error ?? verify.json?.code ?? 'unknown'}`,
    };
  }
  return { ok: true, detail: `created task ${taskId} assignee=${agentId}` };
}

async function mintGrant(consentId) {
  const mint = await api('POST', '/api/v1/delegation/grants', {
    consent_id: consentId,
    actor_agent_id: agentId,
    task_ref: taskId,
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

async function main() {
  console.log(`7D-L1 external protocol smoke — ${apiBase} vault=${vaultId}`);

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
    'E1 env protocol on',
    protocolOn,
    protocolOn
      ? `protocol reachable HTTP ${gateProbe.status} (not 501 gate-off)`
      : `HTTP 501 external_protocol_not_authorized — flip bridge EXTERNAL_PROTOCOL_AUTHORIZED`,
  );
  if (!protocolOn) {
    summarize();
    process.exit(1);
  }

  const identityStep = await ensureExternalProviderIdentity();
  record('setup identity', identityStep.ok, identityStep.detail);
  if (!identityStep.ok) {
    summarize();
    process.exit(1);
  }

  const taskStep = await ensureSmokeTask();
  record('setup task', taskStep.ok, taskStep.detail);
  if (!taskStep.ok) {
    summarize();
    process.exit(1);
  }

  const consentStep = await ensureConsent();
  record('setup consent', consentStep.ok, consentStep.detail);
  if (!consentStep.ok || !consentStep.consentId) {
    summarize();
    process.exit(1);
  }

  const grantStep = await mintGrant(consentStep.consentId);
  record('setup grant', grantStep.ok, grantStep.detail);
  if (!grantStep.ok || !grantStep.bearer) {
    summarize();
    process.exit(1);
  }

  const bearer = grantStep.bearer;

  const list = await apiWithDelegation(
    'GET',
    `/api/v1/agent-protocol/tasks?status=pending&actor_agent_id=${encodeURIComponent(agentId)}`,
    undefined,
    bearer,
  );
  const e2Ok =
    list.status === 200 &&
    Array.isArray(list.json?.tasks) &&
    list.json.tasks.some((t) => t.task_id === taskId);
  record(
    'E2 GET tasks',
    e2Ok,
    e2Ok ? `found ${taskId}` : `HTTP ${list.status} code=${list.json?.code ?? 'none'}`,
  );

  const claimBody = { idempotency_key: 'smoke_claim_7dl1_01', lease_ttl_seconds: 900 };
  const claim = await apiWithDelegation(
    'POST',
    `/api/v1/agent-protocol/tasks/${encodeURIComponent(taskId)}/claim`,
    claimBody,
    bearer,
  );
  const claimOk =
    claim.status === 200 &&
    typeof claim.json?.pass_id === 'string' &&
    typeof claim.json?.lease_expires_at === 'string';
  record(
    'E3 claim',
    claimOk,
    claimOk
      ? `pass_id=${claim.json.pass_id.slice(0, 12)}…`
      : `HTTP ${claim.status} code=${claim.json?.code ?? 'none'}`,
  );

  let e3Idempotent = false;
  if (claimOk) {
    const claimRetry = await apiWithDelegation(
      'POST',
      `/api/v1/agent-protocol/tasks/${encodeURIComponent(taskId)}/claim`,
      claimBody,
      bearer,
    );
    e3Idempotent =
      claimRetry.status === 200 && claimRetry.json?.pass_id === claim.json.pass_id;
    record(
      'E3 idempotent retry',
      e3Idempotent,
      e3Idempotent ? 'same pass_id' : `HTTP ${claimRetry.status} pass mismatch`,
    );
  }

  const passId = claim.json?.pass_id;
  const needs = passId
    ? await apiWithDelegation(
        'POST',
        `/api/v1/agent-protocol/tasks/${encodeURIComponent(taskId)}/needs-input`,
        {
          pass_id: passId,
          idempotency_key: 'smoke_needs_7dl1_01',
          blocking_question: 'Confirm this is the smoke task?',
          boundary_that_triggered: 'ambiguity',
        },
        bearer,
      )
    : { status: 0, json: {} };
  const e4Ok = needs.status === 200 && (needs.json?.status === 'blocked' || needs.json?.task_status === 'blocked');
  record(
    'E4 needs-input → blocked',
    e4Ok,
    e4Ok ? 'task blocked' : `HTTP ${needs.status} code=${needs.json?.code ?? 'none'}`,
  );

  const revokedMint = await mintGrant(consentStep.consentId);
  let e5Ok = false;
  if (revokedMint.ok && revokedMint.bearer && revokedMint.grantId) {
    const revoke = await api(
      'DELETE',
      `/api/v1/delegation/grants/${encodeURIComponent(revokedMint.grantId)}`,
    );
    if (revoke.status < 200 || revoke.status >= 300) {
      record(
        'E5 revoked grant',
        false,
        `revoke HTTP ${revoke.status} ${revoke.json?.code ?? ''}`,
      );
    } else {
      const revokedCall = await apiWithDelegation(
        'GET',
        `/api/v1/agent-protocol/tasks?status=pending&actor_agent_id=${encodeURIComponent(agentId)}`,
        undefined,
        revokedMint.bearer,
      );
      e5Ok = revokedCall.status === 403 && revokedCall.json?.code === 'delegation_revoked';
      record(
        'E5 revoked grant',
        e5Ok,
        e5Ok ? '403 delegation_revoked' : `HTTP ${revokedCall.status} code=${revokedCall.json?.code ?? 'none'}`,
      );
    }
  } else {
    record('E5 revoked grant', false, 'could not mint grant for revoke test');
  }

  const crossVault = await fetch(`${apiBase}/api/v1/agent-protocol/tasks?status=pending`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${resolveToken()}`,
      'X-Delegation-Bearer': bearer,
      'X-Vault-Id': 'unknown-vault-smoke-7dl1',
    },
    signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
  });
  const crossText = await crossVault.text();
  let crossJson = {};
  try {
    crossJson = crossText ? JSON.parse(crossText) : {};
  } catch {
    crossJson = {};
  }
  const e6Ok =
    crossVault.status === 403 &&
    (crossJson.code === 'vault_mismatch' || crossJson.code === 'FORBIDDEN');
  record(
    'E6 cross-vault',
    e6Ok,
    e6Ok ? `403 ${crossJson.code}` : `HTTP ${crossVault.status} code=${crossJson.code ?? 'none'}`,
  );

  summarize();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.step).join(', '));
  } else {
    console.log('7D-L1 validate-only smoke PASS (§16.1 E1–E6)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
