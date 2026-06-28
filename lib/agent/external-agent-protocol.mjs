import fs from 'fs';
import { randomBytes } from 'crypto';
import { checkIdempotency, saveIdempotency, appendOperationalLog } from './external-agent-protocol-store.mjs';
import { loadFlowStore, saveFlowStore } from '../flow/flow-store.mjs';
import { 
  validateChain, 
  loadGrantsStore, 
  hashGrantBearer, 
  handleDelegationAuditAppendRequest 
} from './delegation.mjs';

export const DEFAULT_LEASE_TTL_SECONDS = 900;
export const MAX_LEASE_TTL_SECONDS = 3600;
export const PROVIDER_STALE_AFTER_DAYS = 30;
export const LEASE_SWEEPER_INTERVAL_SECONDS = 60;

/**
 * @param {unknown} v
 * @returns {boolean|null}
 */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * Gate: external agent protocol is off until Tier 3 flip (7D-L1).
 *
 * @returns {boolean}
 */
export function getExternalProtocolAuthorized() {
  const fromEnv = envTriState(process.env.EXTERNAL_PROTOCOL_AUTHORIZED);
  if (fromEnv !== null) return fromEnv;
  return false;
}

const PROTOCOL_ERRORS = {
  task_not_claimable: { status: 409, message: "Task is not in a claimable state" },
  task_already_claimed: { status: 409, message: "Task was claimed by another agent" },
  assignee_mismatch: { status: 403, message: "Caller is not the assignee of this task" },
  lease_expired: { status: 410, message: "Claim lease has expired" },
  delegation_revoked: { status: 403, message: "Delegation grant has been revoked" },
  delegation_chain_invalid: { status: 403, message: "Delegation chain failed validation" },
  delegation_task_pin_mismatch: { status: 403, message: "Grant does not pin this task" },
  boundary_violation_prevented: { status: 422, message: "Action would violate the task boundary policy" },
  rate_limited: { status: 429, message: "Rate limit exceeded" },
  vault_mismatch: { status: 403, message: "Vault identifier mismatch" },
  scope_ceiling_exceeded: { status: 403, message: "Scope ceiling exceeded for this provider kind" },
  idempotency_key_conflict: { status: 409, message: "Idempotency key conflicts with a prior mutation" },
  provider_session_stale: { status: 401, message: "Provider session is stale" },
  receipt_content_rejected: { status: 400, message: "Receipt content failed critical validation" },
  external_protocol_not_authorized: { status: 501, message: "External agent protocol is not enabled" },
  invalid_idempotency_key: { status: 400, message: "Idempotency key missing or invalid" },
  invalid_request: { status: 400, message: "Request body failed validation" }
};

const VALIDATE_CHAIN_MAP = {
  DELEGATION_DISABLED: 'external_protocol_not_authorized',
  DELEGATION_POLICY_FORBIDDEN: 'external_protocol_not_authorized',
  DELEGATION_IDENTITY_DENIED: 'assignee_mismatch',
  DELEGATION_GRANT_REVOKED: 'delegation_revoked',
  DELEGATION_GRANT_EXPIRED: 'lease_expired',
  DELEGATION_GRANT_EXHAUSTED: 'delegation_chain_invalid',
  DELEGATION_ACTOR_MISMATCH: 'assignee_mismatch',
  DELEGATION_PRINCIPAL_MISMATCH: 'delegation_chain_invalid',
  DELEGATION_CONSENT_REVOKED: 'delegation_revoked',
  DELEGATION_CONSENT_EXPIRED: 'delegation_revoked',
  DELEGATION_IDENTITY_SCOPE_DENIED: 'scope_ceiling_exceeded',
  DELEGATION_TASK_DENIED: 'delegation_task_pin_mismatch',
  DELEGATION_GRANT_FLOW_MISMATCH: 'delegation_chain_invalid',
  DELEGATION_CONSENT_REQUIRED: 'delegation_chain_invalid',
  DELEGATION_CHAIN_INVALID: 'delegation_chain_invalid',
  unknown_grant: 'delegation_chain_invalid',
  BAD_REQUEST: 'invalid_request'
};

const claimLocks = new Map();

export async function withTaskLock(vaultId, taskId, fn) {
  const lockKey = `${vaultId}#${taskId}`;
  const prev = claimLocks.get(lockKey) ?? Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  claimLocks.set(lockKey, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    claimLocks.delete(lockKey);
  }
}

export function protocolError(code) {
  const err = PROTOCOL_ERRORS[code] || PROTOCOL_ERRORS.invalid_request;
  return { ok: false, status: err.status, code, error: err.message };
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, code: string, error: string }}
 */
function checkExternalProtocolGate() {
  if (!getExternalProtocolAuthorized()) {
    return protocolError('external_protocol_not_authorized');
  }
  return { ok: true };
}

function validateIdempotencyKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key);
}

function scrubPii(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, '[phone]')
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[cc]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]')
    .replace(/[A-Za-z0-9+/=]{256,}/g, '[blob]');
}

export function taskViewForExternalProtocol(task, dataFlowMode) {
  const isMin = dataFlowMode === 'minimized';
  const view = {
    task_id: task.task_id,
    loop_ref: task.loop_ref ?? null,
    occurrence_key: task.occurrence_key ?? null,
    title: task.title,
    intent: task.intent,
    boundary_policy: task.boundary_policy ?? 'observe_only',
    due_at: task.due_at ?? null,
    kind: task.kind,
    status: task.status,
    artifact_links: Array.isArray(task.artifact_links) 
      ? task.artifact_links.map(l => ({ kind: l.kind, ref: l.ref }))
      : []
  };
  return view;
}

export function resolveBearer(dataDir, vaultId, bearerToken) {
  if (!bearerToken) return null;
  const store = loadGrantsStore(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault || !Array.isArray(vault.grants)) return null;
  const hashed = hashGrantBearer(bearerToken);
  return vault.grants.find(g => g.grant_bearer_hash === hashed) || null;
}

/**
 * @param {ReturnType<typeof resolveBearer>} grant
 * @returns {{ ok: false, status: number, code: string, error: string } | null}
 */
function protocolErrorIfGrantRevoked(grant) {
  if (grant && grant.revoked_at) {
    return protocolError('delegation_revoked');
  }
  return null;
}

export async function handleClaimTask(input) {
  const gate = checkExternalProtocolGate();
  if (!gate.ok) return gate;

  const { dataDir, vaultId, taskId, bearerToken } = input;
  const body = input.body || {};
  if (!validateIdempotencyKey(body.idempotency_key)) {
    return protocolError('invalid_idempotency_key');
  }

  const grant = resolveBearer(dataDir, vaultId, bearerToken);
  if (!grant) return protocolError('delegation_chain_invalid');
  const revoked = protocolErrorIfGrantRevoked(grant);
  if (revoked) return revoked;

  const chain = validateChain({
    dataDir, 
    vaultId, 
    actorAgentId: grant.actor_agent_id, 
    principalRef: grant.principal_ref, 
    grantId: grant.grant_id, 
    taskRef: taskId,
    requireGrant: true
  });
  
  if (!chain.ok) {
    return protocolError(VALIDATE_CHAIN_MAP[chain.code] || 'delegation_chain_invalid');
  }
  
  const identity = chain.identity;
  if (identity.kind !== 'external_provider') return protocolError('assignee_mismatch');
  if (identity.status !== 'active') return protocolError('provider_session_stale');
  
  if (identity.scope_ceiling === 'org' && identity.provider !== 'self_hosted') {
    return protocolError('scope_ceiling_exceeded');
  }
  
  const idempotencyEntry = await checkIdempotency(dataDir, vaultId, taskId, 'claim', body.idempotency_key);
  if (idempotencyEntry) {
    if (idempotencyEntry.conflict) return protocolError('idempotency_key_conflict');
    return idempotencyEntry.response;
  }
  
  return await withTaskLock(vaultId, taskId, async () => {
    const doubleCheck = await checkIdempotency(dataDir, vaultId, taskId, 'claim', body.idempotency_key);
    if (doubleCheck) {
      if (doubleCheck.conflict) return protocolError('idempotency_key_conflict');
      return doubleCheck.response;
    }

    const store = loadFlowStore(dataDir);
    const vault = store.vaults?.[vaultId];
    if (!vault) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    const task = vault.tasks?.find(t => t.task_id === taskId);
    if (!task) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    
    if (task.status !== 'pending' && !(task.status === 'blocked' && task.principal_cleared_flag)) {
      if (task.status === 'in_progress') {
        if (task.assignee_ref !== grant.actor_agent_id && task.assignee_ref !== '*') {
          return protocolError('task_already_claimed');
        }
      }
      return protocolError('task_not_claimable');
    }
    
    if (task.assignee_ref !== grant.actor_agent_id && task.assignee_ref !== '*') {
      return protocolError('assignee_mismatch');
    }
    
    const passId = `extpass_${randomBytes(15).toString('base64url').replace(/=/g, '').toLowerCase().slice(0, 24)}`;
    
    const reqTtl = typeof body.lease_ttl_seconds === 'number' ? body.lease_ttl_seconds : DEFAULT_LEASE_TTL_SECONDS;
    const ttl = Math.min(reqTtl || DEFAULT_LEASE_TTL_SECONDS, MAX_LEASE_TTL_SECONDS);
    const leaseExpiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    
    task.status = 'in_progress';
    task.external_pass_id = passId;
    task.external_lease_expires_at = leaseExpiresAt;
    task.external_active_grant_id = grant.grant_id;
    task.updated = new Date().toISOString();
    
    saveFlowStore(dataDir, store);

    handleDelegationAuditAppendRequest({
      dataDir, vaultId,
      actorAgentId: grant.actor_agent_id,
      principalRef: grant.principal_ref,
      grantId: grant.grant_id,
      action: 'external_claim',
      evidenceRefs: [`task:${taskId}`],
      taskRef: taskId
    });
    
    const response = {
      ok: true,
      pass_id: passId,
      lease_expires_at: leaseExpiresAt,
      boundary_policy: task.boundary_policy || 'observe_only',
      allowed_actions: [], // Placeholder, maybe populated elsewhere
      task_view: taskViewForExternalProtocol(task, identity.data_flow_mode || 'minimized')
    };
    
    await saveIdempotency(dataDir, vaultId, taskId, 'claim', body.idempotency_key, {
       status: 200,
       body: response
    }, ttl + 60);
    
    return response;
  });
}

export async function handleHeartbeatTask(input) {
  const gate = checkExternalProtocolGate();
  if (!gate.ok) return gate;

  const { dataDir, vaultId, taskId, bearerToken } = input;
  const body = input.body || {};
  if (!validateIdempotencyKey(body.idempotency_key)) {
    return protocolError('invalid_idempotency_key');
  }
  
  const grant = resolveBearer(dataDir, vaultId, bearerToken);
  if (!grant) return protocolError('delegation_chain_invalid');
  const revoked = protocolErrorIfGrantRevoked(grant);
  if (revoked) return revoked;

  const chain = validateChain({
    dataDir, 
    vaultId, 
    actorAgentId: grant.actor_agent_id, 
    principalRef: grant.principal_ref, 
    grantId: grant.grant_id, 
    taskRef: taskId,
    requireGrant: true
  });
  
  if (!chain.ok) {
    return protocolError(VALIDATE_CHAIN_MAP[chain.code] || 'delegation_chain_invalid');
  }
  
  const identity = chain.identity;
  if (identity.kind !== 'external_provider') return protocolError('assignee_mismatch');
  if (identity.status !== 'active') return protocolError('provider_session_stale');
  
  if (identity.scope_ceiling === 'org' && identity.provider !== 'self_hosted') {
    return protocolError('scope_ceiling_exceeded');
  }
  
  const idempotencyEntry = await checkIdempotency(dataDir, vaultId, taskId, 'heartbeat', body.idempotency_key);
  if (idempotencyEntry) {
    if (idempotencyEntry.conflict) return protocolError('idempotency_key_conflict');
    return idempotencyEntry.response;
  }
  
  return await withTaskLock(vaultId, taskId, async () => {
    const doubleCheck = await checkIdempotency(dataDir, vaultId, taskId, 'heartbeat', body.idempotency_key);
    if (doubleCheck) {
      if (doubleCheck.conflict) return protocolError('idempotency_key_conflict');
      return doubleCheck.response;
    }
    
    const store = loadFlowStore(dataDir);
    const vault = store.vaults?.[vaultId];
    if (!vault) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    const task = vault.tasks?.find(t => t.task_id === taskId);
    if (!task) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    
    if (task.external_pass_id !== body.pass_id) {
      return protocolError('assignee_mismatch');
    }
    
    if (!task.external_lease_expires_at || new Date(task.external_lease_expires_at).getTime() <= Date.now()) {
      return protocolError('lease_expired');
    }
    
    const reqTtl = typeof body.lease_ttl_seconds === 'number' ? body.lease_ttl_seconds : DEFAULT_LEASE_TTL_SECONDS;
    const extension = Math.min(reqTtl || DEFAULT_LEASE_TTL_SECONDS, MAX_LEASE_TTL_SECONDS);
    
    const currentLeaseExp = new Date(task.external_lease_expires_at).getTime();
    const newExp = Math.max(currentLeaseExp, Date.now()) + extension * 1000;
    
    task.external_lease_expires_at = new Date(newExp).toISOString();
    task.updated = new Date().toISOString();
    
    saveFlowStore(dataDir, store);
    
    const response = {
      ok: true,
      lease_expires_at: task.external_lease_expires_at,
      grant_still_valid: true
    };
    
    await saveIdempotency(dataDir, vaultId, taskId, 'heartbeat', body.idempotency_key, {
       status: 200,
       body: response
    }, extension + 60);
    
    return response;
  });
}

export async function handleCompleteTask(input) {
  const gate = checkExternalProtocolGate();
  if (!gate.ok) return gate;

  const { dataDir, vaultId, taskId, bearerToken } = input;
  const body = input.body || {};
  if (!validateIdempotencyKey(body.idempotency_key)) {
    return protocolError('invalid_idempotency_key');
  }
  
  const grant = resolveBearer(dataDir, vaultId, bearerToken);
  if (!grant) return protocolError('delegation_chain_invalid');
  const revoked = protocolErrorIfGrantRevoked(grant);
  if (revoked) return revoked;

  const chain = validateChain({
    dataDir, 
    vaultId, 
    actorAgentId: grant.actor_agent_id, 
    principalRef: grant.principal_ref, 
    grantId: grant.grant_id, 
    taskRef: taskId,
    requireGrant: true
  });
  
  if (!chain.ok) {
    return protocolError(VALIDATE_CHAIN_MAP[chain.code] || 'delegation_chain_invalid');
  }
  
  const identity = chain.identity;
  if (identity.kind !== 'external_provider') return protocolError('assignee_mismatch');
  if (identity.status !== 'active') return protocolError('provider_session_stale');
  
  if (identity.scope_ceiling === 'org' && identity.provider !== 'self_hosted') {
    return protocolError('scope_ceiling_exceeded');
  }
  
  const idempotencyEntry = await checkIdempotency(dataDir, vaultId, taskId, 'complete', body.idempotency_key);
  if (idempotencyEntry) {
    if (idempotencyEntry.conflict) return protocolError('idempotency_key_conflict');
    return idempotencyEntry.response;
  }
  
  return await withTaskLock(vaultId, taskId, async () => {
    const doubleCheck = await checkIdempotency(dataDir, vaultId, taskId, 'complete', body.idempotency_key);
    if (doubleCheck) {
      if (doubleCheck.conflict) return protocolError('idempotency_key_conflict');
      return doubleCheck.response;
    }
    
    const store = loadFlowStore(dataDir);
    const vault = store.vaults?.[vaultId];
    if (!vault) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    const task = vault.tasks?.find(t => t.task_id === taskId);
    if (!task) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    
    if (task.external_pass_id !== body.pass_id) {
      return protocolError('assignee_mismatch');
    }
    
    if (!task.external_lease_expires_at || new Date(task.external_lease_expires_at).getTime() <= Date.now()) {
      return protocolError('lease_expired');
    }
    
    const boundary = task.boundary_policy || 'observe_only';
    const outcome = body.outcome;
    const artifacts = Array.isArray(body.artifact_links) ? body.artifact_links : [];
    const evidence = Array.isArray(body.evidence_refs) ? body.evidence_refs : [];
    
    let violation = false;
    if (boundary === 'observe_only') {
      if (outcome === 'completed' || artifacts.length > 0) violation = true;
    } else if (boundary === 'draft_only') {
      if (outcome === 'completed') violation = true;
      if (artifacts.some(a => a.kind === 'media' || a.kind === 'review_item')) violation = true;
    } else if (boundary === 'propose_only') {
      const hasProposal = evidence.some(e => typeof e === 'string' && e.startsWith('proposal:'));
      if (outcome === 'completed' && (!hasProposal || artifacts.length > 0)) {
        if (!hasProposal || artifacts.length > 0) violation = true;
      }
    } else if (boundary === 'execute_with_consent') {
      if (outcome === 'completed') {
        const hasConsent = chain.grant?.execute_consent === true;
        if (!hasConsent) violation = true;
      }
    }
    
    if (violation) {
      return protocolError('boundary_violation_prevented');
    }
    
    if (typeof body.receipt_md === 'string') {
      task.external_receipt_md = scrubPii(body.receipt_md);
    }
    
    if (outcome === 'completed' || outcome === 'stopped_at_boundary') {
      task.status = outcome === 'completed' ? 'completed' : 'pending';
      if (outcome === 'stopped_at_boundary') {
         // Keep it pending or similar per boundary stop
      }
      task.external_pass_id = null;
      task.external_lease_expires_at = null;
      task.external_active_grant_id = null;
    }
    
    task.updated = new Date().toISOString();
    
    saveFlowStore(dataDir, store);
    
    const actionMap = {
      'completed': 'external_complete',
      'stopped_at_boundary': 'external_boundary_stop'
    };

    if (actionMap[outcome]) {
      handleDelegationAuditAppendRequest({
        dataDir, vaultId,
        actorAgentId: grant.actor_agent_id,
        principalRef: grant.principal_ref,
        grantId: grant.grant_id,
        action: actionMap[outcome],
        evidenceRefs: evidence.length > 0 ? evidence : [`task:${taskId}`],
        taskRef: taskId
      });
    }

    const response = {
      ok: true,
      task_id: taskId,
      status: task.status
    };
    
    await saveIdempotency(dataDir, vaultId, taskId, 'complete', body.idempotency_key, {
       status: 200,
       body: response
    }, 86400);
    
    return response;
  });
}

export async function handleNeedsInputTask(input) {
  const gate = checkExternalProtocolGate();
  if (!gate.ok) return gate;

  const { dataDir, vaultId, taskId, bearerToken } = input;
  const body = input.body || {};
  if (!validateIdempotencyKey(body.idempotency_key)) {
    return protocolError('invalid_idempotency_key');
  }
  
  const grant = resolveBearer(dataDir, vaultId, bearerToken);
  if (!grant) return protocolError('delegation_chain_invalid');
  const revoked = protocolErrorIfGrantRevoked(grant);
  if (revoked) return revoked;

  const chain = validateChain({
    dataDir, 
    vaultId, 
    actorAgentId: grant.actor_agent_id, 
    principalRef: grant.principal_ref, 
    grantId: grant.grant_id, 
    taskRef: taskId,
    requireGrant: true
  });
  
  if (!chain.ok) {
    return protocolError(VALIDATE_CHAIN_MAP[chain.code] || 'delegation_chain_invalid');
  }
  
  const identity = chain.identity;
  if (identity.kind !== 'external_provider') return protocolError('assignee_mismatch');
  if (identity.status !== 'active') return protocolError('provider_session_stale');
  
  if (identity.scope_ceiling === 'org' && identity.provider !== 'self_hosted') {
    return protocolError('scope_ceiling_exceeded');
  }
  
  const idempotencyEntry = await checkIdempotency(dataDir, vaultId, taskId, 'needs_input', body.idempotency_key);
  if (idempotencyEntry) {
    if (idempotencyEntry.conflict) return protocolError('idempotency_key_conflict');
    return idempotencyEntry.response;
  }
  
  return await withTaskLock(vaultId, taskId, async () => {
    const doubleCheck = await checkIdempotency(dataDir, vaultId, taskId, 'needs_input', body.idempotency_key);
    if (doubleCheck) {
      if (doubleCheck.conflict) return protocolError('idempotency_key_conflict');
      return doubleCheck.response;
    }
    
    const store = loadFlowStore(dataDir);
    const vault = store.vaults?.[vaultId];
    if (!vault) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    const task = vault.tasks?.find(t => t.task_id === taskId);
    if (!task) return { ok: false, status: 404, code: 'unknown_task', error: 'Task not found' };
    
    if (task.external_pass_id !== body.pass_id) {
      return protocolError('assignee_mismatch');
    }
    
    if (!task.external_lease_expires_at || new Date(task.external_lease_expires_at).getTime() <= Date.now()) {
      return protocolError('lease_expired');
    }
    
    task.status = 'blocked';
    task.external_pass_id = null;
    task.external_lease_expires_at = null;
    task.external_active_grant_id = null;
    
    task.updated = new Date().toISOString();
    
    saveFlowStore(dataDir, store);
    
    handleDelegationAuditAppendRequest({
      dataDir, vaultId,
      actorAgentId: grant.actor_agent_id,
      principalRef: grant.principal_ref,
      grantId: grant.grant_id,
      action: 'external_needs_input',
      evidenceRefs: [`task:${taskId}`],
      taskRef: taskId
    });

    const response = {
      ok: true,
      task_id: taskId,
      status: task.status
    };
    
    await saveIdempotency(dataDir, vaultId, taskId, 'needs_input', body.idempotency_key, {
       status: 200,
       body: response
    }, 86400);
    
    return response;
  });
}

export async function handleGetTasks(input) {
  const gate = checkExternalProtocolGate();
  if (!gate.ok) return gate;

  const { dataDir, vaultId, bearerToken } = input;
  
  const grant = resolveBearer(dataDir, vaultId, bearerToken);
  if (!grant) return protocolError('delegation_chain_invalid');
  const revoked = protocolErrorIfGrantRevoked(grant);
  if (revoked) return revoked;

  const chain = validateChain({
    dataDir, 
    vaultId, 
    actorAgentId: grant.actor_agent_id, 
    principalRef: grant.principal_ref, 
    grantId: grant.grant_id,
    requireGrant: true
  });
  
  if (!chain.ok) {
    return protocolError(VALIDATE_CHAIN_MAP[chain.code] || 'delegation_chain_invalid');
  }
  
  const identity = chain.identity;
  if (identity.kind !== 'external_provider') return protocolError('assignee_mismatch');
  if (identity.status !== 'active') return protocolError('provider_session_stale');
  
  if (identity.scope_ceiling === 'org' && identity.provider !== 'self_hosted') {
    return protocolError('scope_ceiling_exceeded');
  }

  const store = loadFlowStore(dataDir);
  const vault = store.vaults?.[vaultId];
  if (!vault || !Array.isArray(vault.tasks)) {
    return { ok: true, tasks: [] };
  }
  
  const tasks = vault.tasks.filter(t => {
    return (t.assignee_ref === identity.agent_id || t.assignee_ref === '*') && t.status !== 'completed';
  });
  
  const mode = identity.data_flow_mode || 'minimized';
  
  return {
    ok: true,
    tasks: tasks.map(t => taskViewForExternalProtocol(t, mode))
  };
}

export async function sweepExpiredLeases(dataDir) {
  const store = loadFlowStore(dataDir);
  let mutated = false;
  
  for (const [vaultId, vault] of Object.entries(store.vaults || {})) {
    if (!Array.isArray(vault.tasks)) continue;
    
    for (const task of vault.tasks) {
      if (task.status === 'in_progress' && task.external_lease_expires_at) {
        if (new Date(task.external_lease_expires_at).getTime() < Date.now()) {
          await withTaskLock(vaultId, task.task_id, async () => {
            // Re-fetch to avoid TOCTOU
            const innerStore = loadFlowStore(dataDir);
            const innerTask = innerStore.vaults?.[vaultId]?.tasks?.find(t => t.task_id === task.task_id);
            if (innerTask && innerTask.status === 'in_progress' && innerTask.external_lease_expires_at && new Date(innerTask.external_lease_expires_at).getTime() < Date.now()) {
              innerTask.status = 'pending';
              innerTask.external_pass_id = null;
              innerTask.external_lease_expires_at = null;
              
              const grantId = innerTask.external_active_grant_id;
              innerTask.external_active_grant_id = null;
              
              saveFlowStore(dataDir, innerStore);
              mutated = true;
              
              appendOperationalLog(dataDir, {
                kind: 'lease_expired',
                task_id: innerTask.task_id,
                grant_id: grantId,
                occurred_at: new Date().toISOString()
              });
            }
          });
        }
      }
    }
  }
  
  return mutated;
}
