/**
 * Loop pass audit mirror store — append-only Knowtation adjunct (Phase 2G-e, OD-7).
 *
 * Scooling operational pass audit remains primary; this module mirrors pointer-only
 * entries for cross-vault queries. Gated by LOOP_PASS_AUDIT_MIRROR_ENABLED (default off).
 *
 * @see scooling/docs/LOOP-ORCHESTRATOR-DISPATCH-CONTRACT-2G-e.md — OD-7 mirror shape
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import {
  BOUNDARY_POLICIES,
  GRAPH_ID_RE,
  LOOP_ID_RE,
} from './task-loop-store.mjs';
import { TASK_ID_RE } from './task-store.mjs';

export const LOOP_PASS_AUDIT_FILE = 'hub_loop_pass_audit.json';
export const LOOP_PASS_AUDIT_POLICY_FILE = 'hub_loop_pass_audit_policy.json';
export const LOOP_PASS_AUDIT_SCHEMA = 'knowtation.loop_pass_audit/v0';
export const LOOP_PASS_AUDIT_ID_PREFIX = 'lpau_';

export const PASS_ID_RE = /^pass_[a-z0-9_]{1,48}$/;

export const LOOP_PASS_OUTCOMES = /** @type {const} */ ([
  'idle',
  'scheduled',
  'evaluating',
  'running_agent_run',
  'needs_human',
  'stopped_at_boundary',
]);

export const CONTEXT_REF_KINDS = /** @type {const} */ ([
  'task',
  'run',
  'loop',
  'calendar_event',
  'note',
]);

const LOOP_SCOPES = new Set(['personal', 'project', 'org']);
const SAFE_POINTER_REF_RE = /^[A-Za-z0-9._:#-]{1,256}$/;

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
 * @param {string} dataDir
 * @returns {object}
 */
export function readLoopPassAuditPolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, LOOP_PASS_AUDIT_POLICY_FILE);
  try {
    if (!fs.existsSync(fp)) return {};
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @returns {{ ok: true } | { ok: false, status: number, code: string, error: string }}
 */
export function checkLoopPassAuditMirrorGate(dataDir) {
  const policy = readLoopPassAuditPolicyFile(dataDir);
  const fromPolicy = envTriState(policy.LOOP_PASS_AUDIT_MIRROR_ENABLED);
  const fromEnv = envTriState(process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED);
  const enabled = fromPolicy ?? fromEnv ?? false;
  if (!enabled) {
    return {
      ok: false,
      status: 403,
      code: 'LOOP_PASS_AUDIT_MIRROR_DISABLED',
      error: 'Loop pass audit mirror is disabled',
    };
  }
  return { ok: true };
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function randomToken(prefix) {
  return prefix + randomBytes(12).toString('hex');
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { entries: object[] }> }}
 */
export function loadLoopPassAuditStore(dataDir) {
  const fp = path.join(dataDir, LOOP_PASS_AUDIT_FILE);
  if (!fs.existsSync(fp)) {
    return { vaults: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!raw || typeof raw !== 'object') return { vaults: {} };
    if (!raw.vaults || typeof raw.vaults !== 'object') return { vaults: {} };
    return /** @type {{ vaults: Record<string, { entries: object[] }> }} */ (raw);
  } catch {
    return { vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { entries: object[] }> }} store
 */
export function saveLoopPassAuditStore(dataDir, store) {
  fs.mkdirSync(dataDir, { recursive: true });
  const fp = path.join(dataDir, LOOP_PASS_AUDIT_FILE);
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @param {unknown} record
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateLoopPassAuditRecord(record) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'entry must be an object' };
  }
  const r = /** @type {Record<string, unknown>} */ (record);
  if (r.schema !== LOOP_PASS_AUDIT_SCHEMA) {
    return { ok: false, error: 'invalid schema' };
  }
  const auditId = typeof r.audit_id === 'string' ? r.audit_id.trim() : '';
  if (!auditId.startsWith(LOOP_PASS_AUDIT_ID_PREFIX)) {
    return { ok: false, error: 'invalid audit_id' };
  }
  const passId = typeof r.pass_id === 'string' ? r.pass_id.trim() : '';
  if (!PASS_ID_RE.test(passId)) {
    return { ok: false, error: 'invalid pass_id' };
  }
  const loopId = typeof r.loop_id === 'string' ? r.loop_id.trim() : '';
  if (!LOOP_ID_RE.test(loopId)) {
    return { ok: false, error: 'invalid loop_id' };
  }
  const instanceTaskId =
    r.instance_task_id === null || r.instance_task_id === undefined
      ? null
      : typeof r.instance_task_id === 'string'
        ? r.instance_task_id.trim()
        : '';
  if (instanceTaskId !== null && !TASK_ID_RE.test(instanceTaskId)) {
    return { ok: false, error: 'invalid instance_task_id' };
  }
  const graphId =
    r.graph_id === null || r.graph_id === undefined
      ? null
      : typeof r.graph_id === 'string'
        ? r.graph_id.trim()
        : '';
  if (graphId !== null && !GRAPH_ID_RE.test(graphId)) {
    return { ok: false, error: 'invalid graph_id' };
  }
  const outcome = typeof r.outcome === 'string' ? r.outcome.trim() : '';
  if (!LOOP_PASS_OUTCOMES.includes(/** @type {typeof LOOP_PASS_OUTCOMES[number]} */ (outcome))) {
    return { ok: false, error: 'invalid outcome' };
  }
  const boundaryPolicy =
    typeof r.boundary_policy === 'string' ? r.boundary_policy.trim() : '';
  if (
    !BOUNDARY_POLICIES.includes(
      /** @type {typeof BOUNDARY_POLICIES[number]} */ (boundaryPolicy),
    )
  ) {
    return { ok: false, error: 'invalid boundary_policy' };
  }
  if (!Array.isArray(r.context_refs)) {
    return { ok: false, error: 'context_refs must be an array' };
  }
  if (r.context_refs.length > 32) {
    return { ok: false, error: 'context_refs too long' };
  }
  for (const ref of r.context_refs) {
    if (!ref || typeof ref !== 'object') {
      return { ok: false, error: 'invalid context_ref' };
    }
    const kind = typeof ref.kind === 'string' ? ref.kind.trim() : '';
    const refVal = typeof ref.ref === 'string' ? ref.ref.trim() : '';
    if (!CONTEXT_REF_KINDS.includes(/** @type {typeof CONTEXT_REF_KINDS[number]} */ (kind))) {
      return { ok: false, error: 'invalid context_ref kind' };
    }
    if (!SAFE_POINTER_REF_RE.test(refVal)) {
      return { ok: false, error: 'invalid context_ref ref' };
    }
  }
  const scoolingRef =
    typeof r.scooling_pass_audit_ref === 'string' ? r.scooling_pass_audit_ref.trim() : '';
  if (!PASS_ID_RE.test(scoolingRef)) {
    return { ok: false, error: 'invalid scooling_pass_audit_ref' };
  }
  const occurredAt = typeof r.occurred_at === 'string' ? r.occurred_at.trim() : '';
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return { ok: false, error: 'invalid occurred_at' };
  }
  const vaultId = typeof r.vault_id === 'string' ? r.vault_id.trim() : '';
  if (!vaultId) {
    return { ok: false, error: 'invalid vault_id' };
  }
  const scope = typeof r.scope === 'string' ? r.scope.trim() : '';
  if (!LOOP_SCOPES.has(scope)) {
    return { ok: false, error: 'invalid scope' };
  }
  return { ok: true };
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} error
 */
function refuse(status, code, error) {
  return { ok: false, status, error, code };
}

/**
 * Normalize request body (snake_case wire) to stored record fields.
 *
 * @param {object} body
 * @param {string} vaultId
 */
function parseLoopPassAuditBody(body, vaultId) {
  const passId =
    typeof body.pass_id === 'string' && body.pass_id.trim()
      ? body.pass_id.trim()
      : typeof body.passId === 'string' && body.passId.trim()
        ? body.passId.trim()
        : '';
  const loopId =
    typeof body.loop_id === 'string' && body.loop_id.trim()
      ? body.loop_id.trim()
      : typeof body.loopId === 'string' && body.loopId.trim()
        ? body.loopId.trim()
        : '';
  const instanceRaw = body.instance_task_id ?? body.instanceTaskId;
  const instanceTaskId =
    instanceRaw === null || instanceRaw === undefined
      ? null
      : typeof instanceRaw === 'string'
        ? instanceRaw.trim()
        : '';
  const graphRaw = body.graph_id ?? body.graphId;
  const graphId =
    graphRaw === null || graphRaw === undefined
      ? null
      : typeof graphRaw === 'string'
        ? graphRaw.trim()
        : '';
  const outcome =
    typeof body.outcome === 'string' && body.outcome.trim() ? body.outcome.trim() : '';
  const boundaryPolicy =
    typeof body.boundary_policy === 'string' && body.boundary_policy.trim()
      ? body.boundary_policy.trim()
      : typeof body.boundaryPolicy === 'string' && body.boundaryPolicy.trim()
        ? body.boundaryPolicy.trim()
        : '';
  const contextRefs = Array.isArray(body.context_refs)
    ? body.context_refs
    : Array.isArray(body.contextRefs)
      ? body.contextRefs
      : [];
  const scoolingRef =
    typeof body.scooling_pass_audit_ref === 'string' && body.scooling_pass_audit_ref.trim()
      ? body.scooling_pass_audit_ref.trim()
      : typeof body.scoolingPassAuditRef === 'string' && body.scoolingPassAuditRef.trim()
        ? body.scoolingPassAuditRef.trim()
        : passId;
  const occurredAt =
    typeof body.occurred_at === 'string' && body.occurred_at.trim()
      ? body.occurred_at.trim()
      : typeof body.occurredAt === 'string' && body.occurredAt.trim()
        ? body.occurredAt.trim()
        : '';
  const scope =
    typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim() : 'personal';
  const auditId =
    typeof body.audit_id === 'string' && body.audit_id.trim()
      ? body.audit_id.trim()
      : typeof body.auditId === 'string' && body.auditId.trim()
        ? body.auditId.trim()
        : randomToken(LOOP_PASS_AUDIT_ID_PREFIX);

  return {
    schema: LOOP_PASS_AUDIT_SCHEMA,
    audit_id: auditId,
    pass_id: passId,
    loop_id: loopId,
    instance_task_id: instanceTaskId === '' ? null : instanceTaskId,
    graph_id: graphId === '' ? null : graphId,
    outcome,
    boundary_policy: boundaryPolicy,
    context_refs: contextRefs.map((ref) => {
      if (!ref || typeof ref !== 'object') return { kind: 'note', ref: 'invalid' };
      const row = /** @type {{ kind?: string, ref?: string }} */ (ref);
      return {
        kind: typeof row.kind === 'string' ? row.kind.trim() : '',
        ref: typeof row.ref === 'string' ? row.ref.trim() : '',
      };
    }),
    scooling_pass_audit_ref: scoolingRef,
    occurred_at: occurredAt,
    vault_id: vaultId,
    scope,
  };
}

/**
 * Append loop pass audit mirror entry (idempotent on pass_id per vault).
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   body: object,
 * }} input
 */
export function handleLoopPassAuditAppendRequest(input) {
  const gate = checkLoopPassAuditMirrorGate(input.dataDir);
  if (!gate.ok) return gate;

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const record = parseLoopPassAuditBody(body, input.vaultId);

  const validation = validateLoopPassAuditRecord(record);
  if (!validation.ok) {
    return refuse(400, 'BAD_REQUEST', validation.error);
  }

  const store = loadLoopPassAuditStore(input.dataDir);
  if (!store.vaults[input.vaultId]) {
    store.vaults[input.vaultId] = { entries: [] };
  }
  const entries = store.vaults[input.vaultId].entries;
  const existing = entries.find((e) => e && e.pass_id === record.pass_id);
  if (existing) {
    return { ok: true, payload: existing, idempotent: true };
  }

  entries.push(record);
  saveLoopPassAuditStore(input.dataDir, store);
  return { ok: true, payload: record, idempotent: false };
}
