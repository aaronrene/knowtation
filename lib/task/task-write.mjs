/**
 * Task + task-loop write proposal facade (Phase 2G-d-b).
 *
 * Typed facade over `/proposals` (SD-4): validate payload → check scope×role write
 * authority → create proposal with server-stamped `proposal_kind` + `task_meta` →
 * existing evaluation/approve/apply. Index mutations happen only at approve→apply via
 * {@link reconcileApprovedTaskProposal}.
 *
 * @see docs/TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md
 */

import fs from 'fs';
import path from 'path';

import { fnv1a64Hex, stableStringify } from '../note-state-id.mjs';
import { loadFlowStore, saveFlowStore } from '../flow/flow-store.mjs';
import { resolveFlowWriteAuthority } from '../flow/flow-scope.mjs';
import { resolveHandlerVisibleScopes } from '../flow/flow-handlers.mjs';
import {
  validateTaskRecord,
  getTask,
  taskForClient,
  TASK_ID_RE,
  TASK_KINDS,
  TASK_STATUSES,
  UID_HASH_REF_RE,
  SAFE_ARTIFACT_REF_RE,
  ARTIFACT_LINK_KINDS,
  MAX_ARTIFACT_LINKS,
} from './task-store.mjs';
import {
  validateTaskLoopRecord,
  getTaskLoop,
  taskLoopForClient,
  LOOP_ID_RE,
  LOOP_STATUSES,
} from './task-loop-store.mjs';

export const TASK_STATE_ID_PREFIX = 'taskst1_';
export const LOOP_STATE_ID_PREFIX = 'loopst1_';
export const TASK_WRITE_POLICY_FILE = 'hub_task_write_policy.json';
export const TASK_PROPOSAL_SCHEMA = 'knowtation.task_proposal/v0';
export const TASK_INSTANCE_PROPOSAL_SCHEMA = 'knowtation.task_instance_proposal/v0';
export const TASK_PROPOSAL_SOURCE = 'task';
export const TASK_REVIEW_QUEUE = 'task-writes';

/** @typedef {'personal'|'project'|'org'} TaskScope */
/** @typedef {typeof TASK_STATUSES[number]} TaskStatus */

/** @type {Record<TaskStatus, TaskStatus[]>} */
const VALID_STATUS_TRANSITIONS = {
  pending: ['in_progress', 'blocked', 'cancelled', 'done'],
  in_progress: ['blocked', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

const PENDING_INSTANCE_STATUSES = /** @type {const} */ (['pending', 'in_progress', 'blocked']);

/**
 * Canonical task subset for optimistic concurrency (excludes created/updated/truncated).
 *
 * @param {Record<string, unknown>} task
 * @returns {Record<string, unknown>}
 */
function canonicalTaskForState(task) {
  return {
    schema: 'knowtation.task/v0',
    task_id: task.task_id,
    kind: task.kind,
    scope: task.scope,
    status: task.status,
    title: task.title,
    workspace_id: task.workspace_id,
    due_at: task.due_at ?? null,
    assignee_ref: task.assignee_ref ?? null,
    assigner_ref: task.assigner_ref ?? null,
    run_ref: task.run_ref ?? null,
    loop_ref: task.loop_ref ?? null,
    occurrence_key: task.occurrence_key ?? null,
    occurrence_at: task.occurrence_at ?? null,
    series_status_snapshot: task.series_status_snapshot ?? null,
    skip_reason: task.skip_reason ?? null,
    artifact_links: Array.isArray(task.artifact_links) ? task.artifact_links : [],
  };
}

/**
 * Canonical loop subset for optimistic concurrency.
 *
 * @param {Record<string, unknown>} loop
 * @returns {Record<string, unknown>}
 */
function canonicalLoopForState(loop) {
  return {
    schema: 'knowtation.task_loop/v0',
    loop_id: loop.loop_id,
    kind: loop.kind,
    scope: loop.scope,
    status: loop.status,
    title: loop.title,
    workspace_id: loop.workspace_id,
    recurrence: loop.recurrence,
    timezone: loop.timezone,
    flow_id: loop.flow_id ?? null,
    boundary_policy: loop.boundary_policy,
    memory_links: Array.isArray(loop.memory_links) ? loop.memory_links : [],
    handoff_refs: Array.isArray(loop.handoff_refs) ? loop.handoff_refs : [],
    until_at: loop.until_at ?? null,
  };
}

/**
 * @param {Record<string, unknown>} task
 * @returns {string}
 */
export function taskStateId(task) {
  const payload = stableStringify(canonicalTaskForState(task || {}));
  return TASK_STATE_ID_PREFIX + fnv1a64Hex(Buffer.from(payload, 'utf8'));
}

/**
 * @param {Record<string, unknown>} loop
 * @returns {string}
 */
export function loopStateId(loop) {
  const payload = stableStringify(canonicalLoopForState(loop || {}));
  return LOOP_STATE_ID_PREFIX + fnv1a64Hex(Buffer.from(payload, 'utf8'));
}

/** @returns {string} */
export function absentTaskStateId() {
  return TASK_STATE_ID_PREFIX + fnv1a64Hex(Buffer.from([0x00]));
}

/** @returns {string} */
export function absentLoopStateId() {
  return LOOP_STATE_ID_PREFIX + fnv1a64Hex(Buffer.from([0x00]));
}

/** @param {unknown} v */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * @param {string} dataDir
 * @returns {{ task_writes_enabled?: boolean, task_writes_forbidden?: boolean, forbid_auto_done?: boolean }}
 */
export function readTaskWritePolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, TASK_WRITE_POLICY_FILE);
  try {
    if (!fs.existsSync(fp)) return {};
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return {};
    const out = {};
    if (typeof j.task_writes_enabled === 'boolean') {
      out.task_writes_enabled = j.task_writes_enabled;
    }
    if (typeof j.task_writes_forbidden === 'boolean') {
      out.task_writes_forbidden = j.task_writes_forbidden;
    }
    if (typeof j.forbid_auto_done === 'boolean') {
      out.forbid_auto_done = j.forbid_auto_done;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getTaskWritesEnabled(dataDir) {
  const fromEnv = envTriState(process.env.TASK_WRITES_ENABLED);
  if (fromEnv !== null) return fromEnv;
  return readTaskWritePolicyFile(dataDir).task_writes_enabled === true;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getTaskWritesForbidden(dataDir) {
  const fromEnv = envTriState(process.env.TASK_WRITES_FORBIDDEN);
  if (fromEnv !== null) return fromEnv;
  return readTaskWritePolicyFile(dataDir).task_writes_forbidden === true;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getForbidAutoDone(dataDir) {
  return readTaskWritePolicyFile(dataDir).forbid_auto_done === true;
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} [error]
 */
function refuse(status, code, error) {
  return { ok: false, status, error: error ?? code, code };
}

/**
 * @param {Set<TaskScope>} visibleScopes
 * @param {TaskScope} targetScope
 * @param {string} [taskKind]
 * @returns {{ ok: true } | { ok: false, status: number, error: string, code: string }}
 */
export function resolveTaskWriteAuthority(visibleScopes, targetScope, taskKind) {
  const authority = resolveFlowWriteAuthority(visibleScopes, targetScope);
  if (!authority.ok) {
    return {
      ok: false,
      status: authority.status,
      error: authority.error === 'Flow write scope not authorized'
        ? 'Task write scope not authorized'
        : authority.error,
      code: authority.code === 'FLOW_SCOPE_DENIED' ? 'TASK_SCOPE_DENIED' : authority.code,
    };
  }
  if (
    taskKind === 'assignment' &&
    (targetScope === 'project' || targetScope === 'org')
  ) {
    return refuse(
      403,
      'TASK_CLASSROOM_AUTHORITY_REQUIRED',
      'Classroom assignment authority required (Phase 2C)',
    );
  }
  return { ok: true };
}

/**
 * @param {object} input
 * @returns {{ visibleScopes: Set<TaskScope>, ambiguous: boolean }}
 */
function resolveWriteScopes(input) {
  return resolveHandlerVisibleScopes(input);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {Set<TaskScope>} visibleScopes
 * @param {string} taskId
 * @param {string} [starterDir]
 * @returns {import('./task-store.mjs').StoredTask|null}
 */
function getVisibleTask(dataDir, vaultId, visibleScopes, taskId, starterDir) {
  return getTask(dataDir, vaultId, taskId, { visibleScopes, starterDir });
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {Set<TaskScope>} visibleScopes
 * @param {string} loopId
 * @param {object} [seedOptions]
 * @returns {import('./task-loop-store.mjs').StoredTaskLoop|null}
 */
function getVisibleLoop(dataDir, vaultId, visibleScopes, loopId, seedOptions = {}) {
  return getTaskLoop(dataDir, vaultId, loopId, { visibleScopes, ...seedOptions });
}

/**
 * @param {string} loopId
 * @param {string} occurrenceKey
 * @returns {{ ok: true, taskId: string } | { ok: false }}
 */
export function computeMaterializeTaskId(loopId, occurrenceKey) {
  const loopToken = loopId.replace(/^loop_/, '').replace(/[^a-z0-9_]/g, '_').slice(0, 20);
  const occToken = occurrenceKey
    .replace(/[^A-Za-z0-9._:-]/g, '_')
    .replace(/:/g, '_')
    .replace(/\./g, '_')
    .replace(/-/g, '_')
    .toLowerCase()
    .slice(0, 24);
  const taskId = `task_${loopToken}_${occToken}`;
  if (!TASK_ID_RE.test(taskId)) {
    return { ok: false };
  }
  return { ok: true, taskId };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} loopId
 * @returns {Set<string>}
 */
function existingOccurrenceKeys(dataDir, vaultId, loopId) {
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  const keys = new Set();
  if (!vault) return keys;
  for (const task of vault.tasks ?? []) {
    if (task.loop_ref === loopId && task.occurrence_key) {
      keys.add(task.occurrence_key);
    }
  }
  return keys;
}

/**
 * Lazy next occurrence key (OD-3 subset — manual + interval week).
 *
 * @param {object} loop
 * @param {Set<string>} existingKeys
 * @returns {string}
 */
export function computeLazyOccurrenceKey(loop, existingKeys) {
  const recurrence = loop.recurrence;
  if (recurrence?.kind === 'interval' && recurrence.unit === 'week') {
    const anchor = recurrence.anchor_at ? new Date(recurrence.anchor_at) : new Date();
    const year = anchor.getUTCFullYear();
    const week = isoWeekNumber(anchor);
    let candidate = `${year}-W${String(week).padStart(2, '0')}`;
    let offset = 0;
    while (existingKeys.has(candidate)) {
      offset += 1;
      candidate = `${year}-W${String(week + offset).padStart(2, '0')}`;
    }
    return candidate;
  }
  if (recurrence?.kind === 'manual') {
    let n = 1;
    while (existingKeys.has(`manual-${n}`)) n += 1;
    return `manual-${n}`;
  }
  let n = 1;
  while (existingKeys.has(`lazy-${n}`)) n += 1;
  return `lazy-${n}`;
}

/**
 * @param {Date} date
 * @returns {number}
 */
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Gate + intent check shared by all propose handlers.
 *
 * @param {object} input
 * @returns {{ ok: true, intent: string, visibleScopes: Set<TaskScope> } | ReturnType<typeof refuse>}
 */
function commonProposeGate(input) {
  if (getTaskWritesForbidden(input.dataDir)) {
    return refuse(403, 'TASK_WRITES_DISABLED', 'Task writes forbidden by policy');
  }
  if (!getTaskWritesEnabled(input.dataDir)) {
    return refuse(403, 'TASK_WRITES_DISABLED', 'Task writes are disabled');
  }
  if (typeof input.createProposal !== 'function') {
    return refuse(500, 'RUNTIME_ERROR', 'createProposal is required');
  }
  const intent = typeof input.intent === 'string' ? input.intent.trim() : '';
  if (!intent) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'intent is required');
  }
  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'TASK_SCOPE_AMBIGUOUS', 'Ambiguous task scope');
  }
  return { ok: true, intent, visibleScopes: resolved.visibleScopes };
}

/**
 * @param {string} proposalId
 * @returns {string}
 */
function taskProposalMirrorPath(proposalId) {
  return `meta/tasks/proposals/${proposalId}.json`;
}

/**
 * One-time task propose — task_create | task_status_update | task_assign | task_artifact_link.
 *
 * @param {object} input
 * @returns {{ ok: true, payload: object } | ReturnType<typeof refuse>}
 */
export function handleTaskProposeRequest(input) {
  const gate = commonProposeGate(input);
  if (!gate.ok) return gate;

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const proposalKindRaw =
    typeof input.proposalKind === 'string'
      ? input.proposalKind.trim()
      : typeof body.proposal_kind === 'string'
        ? body.proposal_kind.trim()
        : '';

  if (proposalKindRaw === 'task_create') {
    return handleTaskCreatePropose(input, gate.intent, gate.visibleScopes);
  }
  if (proposalKindRaw === 'task_status_update') {
    return handleTaskStatusUpdatePropose(input, gate.intent, gate.visibleScopes);
  }
  if (proposalKindRaw === 'task_assign') {
    return handleTaskAssignPropose(input, gate.intent, gate.visibleScopes);
  }
  if (proposalKindRaw === 'task_artifact_link') {
    return handleTaskArtifactLinkPropose(input, gate.intent, gate.visibleScopes);
  }
  return refuse(400, 'TASK_DRAFT_INVALID', 'proposal_kind must be task_create|task_status_update|task_assign|task_artifact_link');
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskCreatePropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const taskRaw = body.task && typeof body.task === 'object' ? body.task : body;
  if (!taskRaw || typeof taskRaw !== 'object') {
    return refuse(400, 'TASK_DRAFT_INVALID', 'task object is required');
  }
  if (taskRaw.loop_ref != null && taskRaw.loop_ref !== null) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'loop_ref must be absent at task_create — use task_instance_materialize');
  }
  if (taskRaw.occurrence_key != null && taskRaw.occurrence_key !== null) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'occurrence_key must be absent at task_create');
  }
  if (taskRaw.run_ref != null && taskRaw.run_ref !== null) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'run_ref must be null at task_create');
  }

  const now = new Date().toISOString();
  const draft = {
    ...taskRaw,
    schema: 'knowtation.task/v0',
    status: taskRaw.status ?? 'pending',
    artifact_links: Array.isArray(taskRaw.artifact_links) ? taskRaw.artifact_links : [],
    run_ref: null,
    loop_ref: null,
    occurrence_key: null,
    occurrence_at: null,
    series_status_snapshot: null,
    skip_reason: null,
    created: now,
    updated: now,
    truncated: false,
  };

  const validated = validateTaskRecord(draft);
  if (!validated.ok) {
    return refuse(400, 'TASK_DRAFT_INVALID', validated.reason);
  }
  const { task } = validated;

  const authority = resolveTaskWriteAuthority(visibleScopes, task.scope, task.kind);
  if (!authority.ok) return authority;

  const existing = getVisibleTask(input.dataDir, input.vaultId, visibleScopes, task.task_id, input.starterDir);
  if (existing) {
    return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task_id already exists in scope');
  }

  const proposalBaseStateId = absentTaskStateId();
  const proposalBody = JSON.stringify({ proposal_kind: 'task_create', task }, null, 2);

  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_proposal', task_id: task.task_id, proposal_kind: 'task_create' },
    intent,
    base_state_id: proposalBaseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task',
      proposal_kind: 'task_create',
      task_id: task.task_id,
      loop_id: null,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return {
    ok: true,
    payload: {
      schema: TASK_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      proposal_kind: 'task_create',
      task_id: task.task_id,
      loop_id: null,
      base_state_id: proposalBaseStateId,
      scope: task.scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: TASK_REVIEW_QUEUE,
    },
  };
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskStatusUpdatePropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : '';
  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';
  const newStatus = typeof body.status === 'string' ? body.status.trim() : '';
  const skipReason = body.skip_reason != null ? String(body.skip_reason).slice(0, 256) : null;

  if (!taskId || !TASK_ID_RE.test(taskId)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'task_id is required');
  }
  if (!baseStateId.startsWith(TASK_STATE_ID_PREFIX)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'base_state_id is required');
  }
  if (!TASK_STATUSES.includes(/** @type {TaskStatus} */ (newStatus))) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'invalid status');
  }

  const existing = getVisibleTask(input.dataDir, input.vaultId, visibleScopes, taskId, input.starterDir);
  if (!existing) {
    return refuse(404, 'unknown_task', 'unknown_task');
  }

  const authority = resolveTaskWriteAuthority(visibleScopes, existing.scope, existing.kind);
  if (!authority.ok) return authority;

  const canonical = taskForClient(existing);
  const serverStateId = taskStateId(canonical);
  if (serverStateId !== baseStateId) {
    return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task changed since proposal was based');
  }

  const allowed = VALID_STATUS_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(/** @type {TaskStatus} */ (newStatus))) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'invalid status transition');
  }
  if (newStatus === 'done' && getForbidAutoDone(input.dataDir)) {
    return refuse(403, 'TASK_SCOPE_DENIED', 'auto-complete to done forbidden by policy');
  }

  const patch = { status: newStatus, skip_reason: newStatus === 'cancelled' ? skipReason : null };
  const proposalBody = JSON.stringify(
    { proposal_kind: 'task_status_update', task_id: taskId, ...patch },
    null,
    2,
  );

  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_proposal', task_id: taskId, proposal_kind: 'task_status_update' },
    intent,
    base_state_id: baseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task',
      proposal_kind: 'task_status_update',
      task_id: taskId,
      loop_id: null,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return buildTaskProposalEnvelope(proposal.proposal_id, 'task_status_update', taskId, null, baseStateId, existing.scope);
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskAssignPropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : '';
  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';
  const assigneeRef = body.assignee_ref;
  const assignerRef = body.assigner_ref ?? null;

  if (!taskId || !baseStateId.startsWith(TASK_STATE_ID_PREFIX)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'task_id and base_state_id required');
  }
  if (assigneeRef != null && (typeof assigneeRef !== 'string' || !UID_HASH_REF_RE.test(assigneeRef))) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'assignee_ref must be uid_hash:<64-hex> or null');
  }

  const existing = getVisibleTask(input.dataDir, input.vaultId, visibleScopes, taskId, input.starterDir);
  if (!existing) return refuse(404, 'unknown_task', 'unknown_task');

  const authority = resolveTaskWriteAuthority(visibleScopes, existing.scope, existing.kind);
  if (!authority.ok) return authority;

  const serverStateId = taskStateId(taskForClient(existing));
  if (serverStateId !== baseStateId) {
    return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task changed since proposal was based');
  }

  const proposalBody = JSON.stringify(
    { proposal_kind: 'task_assign', task_id: taskId, assignee_ref: assigneeRef, assigner_ref: assignerRef },
    null,
    2,
  );

  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_proposal', task_id: taskId, proposal_kind: 'task_assign' },
    intent,
    base_state_id: baseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task',
      proposal_kind: 'task_assign',
      task_id: taskId,
      loop_id: null,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);
  return buildTaskProposalEnvelope(proposal.proposal_id, 'task_assign', taskId, null, baseStateId, existing.scope);
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskArtifactLinkPropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : '';
  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';
  const link = body.artifact_link ?? body.artifact;

  if (!taskId || !baseStateId.startsWith(TASK_STATE_ID_PREFIX)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'task_id and base_state_id required');
  }
  if (!link || typeof link !== 'object') {
    return refuse(400, 'TASK_DRAFT_INVALID', 'artifact_link is required');
  }
  const row = /** @type {Record<string, unknown>} */ (link);
  if (!ARTIFACT_LINK_KINDS.includes(/** @type {typeof ARTIFACT_LINK_KINDS[number]} */ (row.kind))) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'invalid artifact_link kind');
  }
  if (typeof row.ref !== 'string' || !SAFE_ARTIFACT_REF_RE.test(row.ref)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'invalid artifact_link ref');
  }

  const existing = getVisibleTask(input.dataDir, input.vaultId, visibleScopes, taskId, input.starterDir);
  if (!existing) return refuse(404, 'unknown_task', 'unknown_task');

  const authority = resolveTaskWriteAuthority(visibleScopes, existing.scope, existing.kind);
  if (!authority.ok) return authority;

  const serverStateId = taskStateId(taskForClient(existing));
  if (serverStateId !== baseStateId) {
    return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task changed since proposal was based');
  }

  const proposalBody = JSON.stringify(
    { proposal_kind: 'task_artifact_link', task_id: taskId, artifact_link: { kind: row.kind, ref: row.ref } },
    null,
    2,
  );

  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_proposal', task_id: taskId, proposal_kind: 'task_artifact_link' },
    intent,
    base_state_id: baseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task',
      proposal_kind: 'task_artifact_link',
      task_id: taskId,
      loop_id: null,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);
  return buildTaskProposalEnvelope(proposal.proposal_id, 'task_artifact_link', taskId, null, baseStateId, existing.scope);
}

/**
 * Loop series propose — task_loop_create | task_loop_pause | task_loop_cancel.
 *
 * @param {object} input
 * @returns {{ ok: true, payload: object } | ReturnType<typeof refuse>}
 */
export function handleTaskLoopProposeRequest(input) {
  const gate = commonProposeGate(input);
  if (!gate.ok) return gate;

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const proposalKindRaw =
    typeof input.proposalKind === 'string'
      ? input.proposalKind.trim()
      : typeof body.proposal_kind === 'string'
        ? body.proposal_kind.trim()
        : '';

  if (proposalKindRaw === 'task_loop_create') {
    return handleTaskLoopCreatePropose(input, gate.intent, gate.visibleScopes);
  }
  if (proposalKindRaw === 'task_loop_pause') {
    return handleTaskLoopPausePropose(input, gate.intent, gate.visibleScopes);
  }
  if (proposalKindRaw === 'task_loop_cancel') {
    return handleTaskLoopCancelPropose(input, gate.intent, gate.visibleScopes);
  }
  return refuse(400, 'TASK_DRAFT_INVALID', 'proposal_kind must be task_loop_create|task_loop_pause|task_loop_cancel');
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskLoopCreatePropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const loopRaw = body.loop && typeof body.loop === 'object' ? body.loop : body;
  if (!loopRaw || typeof loopRaw !== 'object') {
    return refuse(400, 'TASK_DRAFT_INVALID', 'loop object is required');
  }
  if (loopRaw.status && loopRaw.status !== 'active') {
    return refuse(400, 'TASK_DRAFT_INVALID', 'initial loop status must be active');
  }

  const now = new Date().toISOString();
  const draft = {
    ...loopRaw,
    schema: 'knowtation.task_loop/v0',
    status: 'active',
    memory_links: Array.isArray(loopRaw.memory_links) ? loopRaw.memory_links : [],
    created: now,
    updated: now,
    truncated: false,
  };

  const validated = validateTaskLoopRecord(draft);
  if (!validated.ok) {
    return refuse(400, 'TASK_DRAFT_INVALID', validated.reason);
  }
  const { loop } = validated;

  const authority = resolveTaskWriteAuthority(visibleScopes, loop.scope, loop.kind);
  if (!authority.ok) return authority;

  const existing = getVisibleLoop(input.dataDir, input.vaultId, visibleScopes, loop.loop_id, {
    starterDir: input.starterDir,
  });
  if (existing) {
    return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop_id already exists in scope');
  }

  const proposalBaseStateId = absentLoopStateId();
  const proposalBody = JSON.stringify({ proposal_kind: 'task_loop_create', loop }, null, 2);

  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_loop_proposal', loop_id: loop.loop_id, proposal_kind: 'task_loop_create' },
    intent,
    base_state_id: proposalBaseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task_loop',
      proposal_kind: 'task_loop_create',
      task_id: null,
      loop_id: loop.loop_id,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return {
    ok: true,
    payload: {
      schema: TASK_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      proposal_kind: 'task_loop_create',
      task_id: null,
      loop_id: loop.loop_id,
      base_state_id: proposalBaseStateId,
      scope: loop.scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: TASK_REVIEW_QUEUE,
    },
  };
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskLoopPausePropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const loopId = typeof body.loop_id === 'string' ? body.loop_id.trim() : '';
  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';

  if (!loopId || !LOOP_ID_RE.test(loopId) || !baseStateId.startsWith(LOOP_STATE_ID_PREFIX)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'loop_id and base_state_id required');
  }

  const existing = getVisibleLoop(input.dataDir, input.vaultId, visibleScopes, loopId, {
    starterDir: input.starterDir,
  });
  if (!existing) return refuse(404, 'unknown_task_loop', 'unknown_task_loop');

  const authority = resolveTaskWriteAuthority(visibleScopes, existing.scope, existing.kind);
  if (!authority.ok) return authority;

  const serverStateId = loopStateId(taskLoopForClient(existing));
  if (serverStateId !== baseStateId) {
    return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop changed since proposal was based');
  }
  if (existing.status !== 'active') {
    return refuse(409, 'TASK_LOOP_NOT_ACTIVE', 'loop is not active');
  }

  const proposalBody = JSON.stringify({ proposal_kind: 'task_loop_pause', loop_id: loopId }, null, 2);
  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_loop_proposal', loop_id: loopId, proposal_kind: 'task_loop_pause' },
    intent,
    base_state_id: baseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task_loop',
      proposal_kind: 'task_loop_pause',
      task_id: null,
      loop_id: loopId,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);
  return buildTaskProposalEnvelope(proposal.proposal_id, 'task_loop_pause', null, loopId, baseStateId, existing.scope);
}

/**
 * @param {object} input
 * @param {string} intent
 * @param {Set<TaskScope>} visibleScopes
 */
function handleTaskLoopCancelPropose(input, intent, visibleScopes) {
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const loopId = typeof body.loop_id === 'string' ? body.loop_id.trim() : '';
  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';

  if (!loopId || !baseStateId.startsWith(LOOP_STATE_ID_PREFIX)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'loop_id and base_state_id required');
  }

  const existing = getVisibleLoop(input.dataDir, input.vaultId, visibleScopes, loopId, {
    starterDir: input.starterDir,
  });
  if (!existing) return refuse(404, 'unknown_task_loop', 'unknown_task_loop');

  const authority = resolveTaskWriteAuthority(visibleScopes, existing.scope, existing.kind);
  if (!authority.ok) return authority;

  const serverStateId = loopStateId(taskLoopForClient(existing));
  if (serverStateId !== baseStateId) {
    return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop changed since proposal was based');
  }

  const proposalBody = JSON.stringify({ proposal_kind: 'task_loop_cancel', loop_id: loopId }, null, 2);
  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: { type: 'task_loop_proposal', loop_id: loopId, proposal_kind: 'task_loop_cancel' },
    intent,
    base_state_id: baseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task_loop',
      proposal_kind: 'task_loop_cancel',
      task_id: null,
      loop_id: loopId,
      occurrence_key: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);
  return buildTaskProposalEnvelope(proposal.proposal_id, 'task_loop_cancel', null, loopId, baseStateId, existing.scope);
}

/**
 * Materialize one loop occurrence task.
 *
 * @param {object} input
 * @returns {{ ok: true, payload: object } | ReturnType<typeof refuse>}
 */
export function handleTaskInstanceMaterializeRequest(input) {
  const gate = commonProposeGate(input);
  if (!gate.ok) return gate;

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const loopId = typeof body.loop_id === 'string' ? body.loop_id.trim() : typeof input.loopId === 'string' ? input.loopId.trim() : '';
  if (!loopId || !LOOP_ID_RE.test(loopId)) {
    return refuse(400, 'TASK_DRAFT_INVALID', 'loop_id is required');
  }

  const loop = getVisibleLoop(input.dataDir, input.vaultId, gate.visibleScopes, loopId, {
    starterDir: input.starterDir,
  });
  if (!loop) return refuse(404, 'unknown_task_loop', 'unknown_task_loop');

  const authority = resolveTaskWriteAuthority(gate.visibleScopes, loop.scope, loop.kind);
  if (!authority.ok) return authority;

  if (loop.status !== 'active') {
    return refuse(409, 'TASK_LOOP_NOT_ACTIVE', 'loop is not active — cannot materialize');
  }

  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';
  if (baseStateId) {
    const serverLoopStateId = loopStateId(taskLoopForClient(loop));
    if (serverLoopStateId !== baseStateId) {
      return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop changed since materialize was based');
    }
  }

  const existingKeys = existingOccurrenceKeys(input.dataDir, input.vaultId, loopId);
  let occurrenceKey =
    typeof body.occurrence_key === 'string' && body.occurrence_key.trim()
      ? body.occurrence_key.trim()
      : computeLazyOccurrenceKey(loop, existingKeys);

  if (existingKeys.has(occurrenceKey)) {
    return refuse(409, 'TASK_OCCURRENCE_EXISTS', 'occurrence already materialized');
  }

  const occurrenceAt =
    typeof body.occurrence_at === 'string' && body.occurrence_at.trim()
      ? body.occurrence_at.trim()
      : loop.recurrence?.kind === 'interval' && loop.recurrence.anchor_at
        ? loop.recurrence.anchor_at
        : new Date().toISOString();
  const dueAt =
    typeof body.due_at === 'string' && body.due_at.trim()
      ? body.due_at.trim()
      : occurrenceAt;
  const title =
    typeof body.title_override === 'string' && body.title_override.trim()
      ? body.title_override.trim()
      : loop.title;

  const taskIdResult = computeMaterializeTaskId(loopId, occurrenceKey);
  if (!taskIdResult.ok) {
    return refuse(400, 'TASK_MATERIALIZE_INVALID', 'computed task_id exceeds limits');
  }

  const now = new Date().toISOString();
  const instanceDraft = {
    schema: 'knowtation.task/v0',
    task_id: taskIdResult.taskId,
    kind: loop.kind,
    scope: loop.scope,
    status: 'pending',
    title,
    workspace_id: loop.workspace_id,
    due_at: dueAt,
    assignee_ref: null,
    assigner_ref: null,
    run_ref: null,
    loop_ref: loopId,
    occurrence_key: occurrenceKey,
    occurrence_at: occurrenceAt,
    series_status_snapshot: loop.status,
    skip_reason: null,
    artifact_links: [],
    created: now,
    updated: now,
    truncated: false,
  };

  const validated = validateTaskRecord(instanceDraft);
  if (!validated.ok) {
    return refuse(400, 'TASK_MATERIALIZE_INVALID', validated.reason);
  }

  const loopBaseStateId = baseStateId || loopStateId(taskLoopForClient(loop));
  const proposalBody = JSON.stringify(
    {
      proposal_kind: 'task_instance_materialize',
      loop_id: loopId,
      occurrence_key: occurrenceKey,
      task: validated.task,
    },
    null,
    2,
  );

  const proposal = input.createProposal(input.dataDir, {
    path: taskProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: {
      type: 'task_instance_proposal',
      loop_id: loopId,
      task_id: taskIdResult.taskId,
      proposal_kind: 'task_instance_materialize',
    },
    intent: gate.intent,
    base_state_id: loopBaseStateId,
    source: TASK_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: TASK_REVIEW_QUEUE,
    task_meta: {
      record_kind: 'task_instance',
      proposal_kind: 'task_instance_materialize',
      task_id: taskIdResult.taskId,
      loop_id: loopId,
      occurrence_key: occurrenceKey,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return {
    ok: true,
    payload: {
      schema: TASK_INSTANCE_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      proposal_kind: 'task_instance_materialize',
      loop_id: loopId,
      task_id: taskIdResult.taskId,
      occurrence_key: occurrenceKey,
      base_state_id: loopBaseStateId,
      scope: loop.scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: TASK_REVIEW_QUEUE,
    },
  };
}

/**
 * @param {string} dataDir
 * @param {string} proposalId
 */
function updateProposalPath(dataDir, proposalId) {
  const fp = path.join(dataDir, 'hub_proposals.json');
  if (!fs.existsSync(fp)) return;
  const all = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const idx = all.findIndex((p) => p.proposal_id === proposalId);
  if (idx >= 0) {
    all[idx].path = taskProposalMirrorPath(proposalId);
    fs.writeFileSync(fp, JSON.stringify(all, null, 2), 'utf8');
  }
}

/**
 * @param {string} proposalId
 * @param {string} proposalKind
 * @param {string|null} taskId
 * @param {string|null} loopId
 * @param {string} baseStateId
 * @param {TaskScope} scope
 */
function buildTaskProposalEnvelope(proposalId, proposalKind, taskId, loopId, baseStateId, scope) {
  return {
    ok: true,
    payload: {
      schema: TASK_PROPOSAL_SCHEMA,
      proposal_id: proposalId,
      proposal_kind: proposalKind,
      task_id: taskId,
      loop_id: loopId,
      base_state_id: baseStateId,
      scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: TASK_REVIEW_QUEUE,
    },
  };
}

/**
 * Approve-time authoritative re-check for task proposals.
 *
 * @param {string} dataDir
 * @param {object} proposal
 */
export function precheckApprovedTaskProposal(dataDir, proposal) {
  let parsed;
  try {
    parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
  } catch {
    return refuse(400, 'TASK_DRAFT_INVALID', 'task proposal body is not valid JSON');
  }

  const meta = proposal.task_meta && typeof proposal.task_meta === 'object' ? proposal.task_meta : {};
  const proposalKind = meta.proposal_kind || parsed.proposal_kind;
  const vaultId =
    typeof proposal.vault_id === 'string' && proposal.vault_id.trim() ? proposal.vault_id.trim() : 'default';
  const baseStateId = typeof proposal.base_state_id === 'string' ? proposal.base_state_id : '';

  const visibleScopes = new Set(['personal', 'project', 'org']);

  if (proposalKind === 'task_create') {
    const validated = validateTaskRecord(parsed.task);
    if (!validated.ok) return refuse(400, 'TASK_DRAFT_INVALID', validated.reason);
    const store = loadFlowStore(dataDir);
    const vault = store.vaults[vaultId];
    const exists = (vault?.tasks ?? []).some((t) => t.task_id === validated.task.task_id);
    if (exists) return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task_id already exists');
    return { ok: true, vaultId, proposalKind, parsed, task: validated.task };
  }

  if (proposalKind === 'task_status_update' || proposalKind === 'task_assign' || proposalKind === 'task_artifact_link') {
    const taskId = parsed.task_id;
    const existing = getTask(dataDir, vaultId, taskId, { visibleScopes });
    if (!existing) return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task disappeared before approve');
    const serverStateId = taskStateId(taskForClient(existing));
    if (serverStateId !== baseStateId) {
      return refuse(409, 'TASK_LINEAGE_CONFLICT', 'task changed since proposal was based');
    }
    return { ok: true, vaultId, proposalKind, parsed, existing };
  }

  if (proposalKind === 'task_loop_create') {
    const validated = validateTaskLoopRecord(parsed.loop);
    if (!validated.ok) return refuse(400, 'TASK_DRAFT_INVALID', validated.reason);
    const store = loadFlowStore(dataDir);
    const vault = store.vaults[vaultId];
    const exists = (vault?.task_loops ?? []).some((l) => l.loop_id === validated.loop.loop_id);
    if (exists) return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop_id already exists');
    return { ok: true, vaultId, proposalKind, parsed, loop: validated.loop };
  }

  if (proposalKind === 'task_loop_pause' || proposalKind === 'task_loop_cancel') {
    const loopId = parsed.loop_id;
    const existing = getTaskLoop(dataDir, vaultId, loopId, { visibleScopes });
    if (!existing) return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop disappeared before approve');
    const serverStateId = loopStateId(taskLoopForClient(existing));
    if (serverStateId !== baseStateId) {
      return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop changed since proposal was based');
    }
    return { ok: true, vaultId, proposalKind, parsed, existing };
  }

  if (proposalKind === 'task_instance_materialize') {
    const loopId = parsed.loop_id;
    const loop = getTaskLoop(dataDir, vaultId, loopId, { visibleScopes });
    if (!loop) return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop disappeared before approve');
    if (loop.status !== 'active') {
      return refuse(409, 'TASK_LOOP_NOT_ACTIVE', 'loop is not active');
    }
    const serverLoopStateId = loopStateId(taskLoopForClient(loop));
    if (baseStateId && serverLoopStateId !== baseStateId) {
      return refuse(409, 'TASK_LOOP_LINEAGE_CONFLICT', 'loop changed since materialize was based');
    }
    const keys = existingOccurrenceKeys(dataDir, vaultId, loopId);
    if (keys.has(parsed.occurrence_key)) {
      return refuse(409, 'TASK_OCCURRENCE_EXISTS', 'occurrence already materialized');
    }
    const validated = validateTaskRecord(parsed.task);
    if (!validated.ok) return refuse(400, 'TASK_MATERIALIZE_INVALID', validated.reason);
    return { ok: true, vaultId, proposalKind, parsed, task: validated.task, loop };
  }

  return refuse(400, 'TASK_DRAFT_INVALID', 'unknown task proposal_kind');
}

/**
 * Apply a pre-checked task proposal into hub_flow_store.json.
 *
 * @param {string} dataDir
 * @param {object} applyCtx - output of precheckApprovedTaskProposal when ok
 */
export function reconcileApprovedTaskProposal(dataDir, applyCtx) {
  const store = loadFlowStore(dataDir);
  const vaultId = applyCtx.vaultId;
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  }
  const vault = store.vaults[vaultId];
  if (!Array.isArray(vault.tasks)) vault.tasks = [];
  if (!Array.isArray(vault.task_loops)) vault.task_loops = [];

  const now = new Date().toISOString();
  const kind = applyCtx.proposalKind;

  if (kind === 'task_create' || kind === 'task_instance_materialize') {
    const task = { ...applyCtx.task, updated: now };
    if (kind === 'task_create') {
      task.created = now;
    }
    vault.tasks.push(task);
    saveFlowStore(dataDir, store);
    return { applied: true, task_id: task.task_id };
  }

  if (kind === 'task_status_update') {
    const idx = vault.tasks.findIndex((t) => t.task_id === applyCtx.parsed.task_id);
    if (idx < 0) throw new Error('task missing at apply');
    vault.tasks[idx] = {
      ...vault.tasks[idx],
      status: applyCtx.parsed.status,
      skip_reason: applyCtx.parsed.skip_reason ?? null,
      updated: now,
    };
    saveFlowStore(dataDir, store);
    return { applied: true, task_id: applyCtx.parsed.task_id };
  }

  if (kind === 'task_assign') {
    const idx = vault.tasks.findIndex((t) => t.task_id === applyCtx.parsed.task_id);
    if (idx < 0) throw new Error('task missing at apply');
    vault.tasks[idx] = {
      ...vault.tasks[idx],
      assignee_ref: applyCtx.parsed.assignee_ref ?? null,
      assigner_ref: applyCtx.parsed.assigner_ref ?? null,
      updated: now,
    };
    saveFlowStore(dataDir, store);
    return { applied: true, task_id: applyCtx.parsed.task_id };
  }

  if (kind === 'task_artifact_link') {
    const idx = vault.tasks.findIndex((t) => t.task_id === applyCtx.parsed.task_id);
    if (idx < 0) throw new Error('task missing at apply');
    const links = [...(vault.tasks[idx].artifact_links ?? [])];
    links.push(applyCtx.parsed.artifact_link);
    vault.tasks[idx] = {
      ...vault.tasks[idx],
      artifact_links: links.slice(0, MAX_ARTIFACT_LINKS),
      truncated: links.length > MAX_ARTIFACT_LINKS,
      updated: now,
    };
    saveFlowStore(dataDir, store);
    return { applied: true, task_id: applyCtx.parsed.task_id };
  }

  if (kind === 'task_loop_create') {
    const loop = { ...applyCtx.loop, created: now, updated: now };
    vault.task_loops.push(loop);
    saveFlowStore(dataDir, store);
    return { applied: true, loop_id: loop.loop_id };
  }

  if (kind === 'task_loop_pause') {
    const idx = vault.task_loops.findIndex((l) => l.loop_id === applyCtx.parsed.loop_id);
    if (idx < 0) throw new Error('loop missing at apply');
    vault.task_loops[idx] = { ...vault.task_loops[idx], status: 'paused', updated: now };
    saveFlowStore(dataDir, store);
    return { applied: true, loop_id: applyCtx.parsed.loop_id };
  }

  if (kind === 'task_loop_cancel') {
    const loopId = applyCtx.parsed.loop_id;
    const loopIdx = vault.task_loops.findIndex((l) => l.loop_id === loopId);
    if (loopIdx < 0) throw new Error('loop missing at apply');
    vault.task_loops[loopIdx] = { ...vault.task_loops[loopIdx], status: 'cancelled', updated: now };

    /** @type {string[]} */
    const cascadeTaskIds = [];
    for (let i = 0; i < vault.tasks.length; i += 1) {
      const task = vault.tasks[i];
      if (task.loop_ref !== loopId) continue;
      if (!PENDING_INSTANCE_STATUSES.includes(task.status)) continue;
      vault.tasks[i] = {
        ...task,
        status: 'cancelled',
        skip_reason: 'series_cancelled',
        updated: now,
      };
      cascadeTaskIds.push(task.task_id);
    }

    saveFlowStore(dataDir, store);
    return { applied: true, loop_id: loopId, cascade_task_ids: cascadeTaskIds };
  }

  throw new Error(`unsupported task proposal_kind at apply: ${kind}`);
}

export { TASK_ID_RE, LOOP_ID_RE, TASK_KINDS };
