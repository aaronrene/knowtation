/**
 * Local file-backed Task store (Phase 2G-b — Option A calendar/flow parity).
 *
 * Tasks persist in the shared `hub_flow_store.json` vault bucket (`tasks[]`).
 * Read-only list/get in v0; idempotent starter seed on first read.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md
 */

import fs from 'fs';
import path from 'path';
import { getRepoRoot } from '../repo-root.mjs';
import {
  loadFlowStore,
  saveFlowStore,
  FLOW_RUN_ID_RE,
} from '../flow/flow-store.mjs';
import { highestFlowScope } from '../flow/flow-scope.mjs';

/** Loop instance field regexes — parity with task-loop-store.mjs (avoid circular import). */
const LOOP_ID_RE = /^loop_[a-z0-9_]{1,48}$/;
const OCCURRENCE_KEY_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const LOOP_STATUSES = /** @type {const} */ (['active', 'paused', 'cancelled']);

export const STARTER_TASKS_DIRNAME = 'tasks/starter';
export const MAX_TASK_SUMMARIES = 500;
export const MAX_ARTIFACT_LINKS = 32;

export const TASK_ID_RE = /^task_[a-z0-9_]{1,48}$/;
export const UID_HASH_REF_RE = /^uid_hash:[a-f0-9]{64}$/;
export const SAFE_ARTIFACT_REF_RE = /^[A-Za-z0-9._:#-]{1,256}$/;

export const TASK_KINDS = /** @type {const} */ ([
  'personal',
  'assignment',
  'mentor_checkin',
  'org_work_job',
]);

export const TASK_STATUSES = /** @type {const} */ ([
  'pending',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
]);

export const ARTIFACT_LINK_KINDS = /** @type {const} */ (['note', 'media', 'review_item']);

/** @typedef {'personal'|'project'|'org'} TaskScope */

/**
 * @typedef {Object} StoredTask
 * @property {'knowtation.task/v0'} schema
 * @property {string} task_id
 * @property {typeof TASK_KINDS[number]} kind
 * @property {TaskScope} scope
 * @property {typeof TASK_STATUSES[number]} status
 * @property {string} title
 * @property {string} workspace_id
 * @property {string|null} due_at
 * @property {string|null} [assignee_ref]
 * @property {string|null} [assigner_ref]
 * @property {string|null} [run_ref]
 * @property {string|null} [loop_ref]
 * @property {string|null} [occurrence_key]
 * @property {string|null} [occurrence_at]
 * @property {typeof LOOP_STATUSES[number]|null} [series_status_snapshot]
 * @property {string|null} [skip_reason]
 * @property {{ kind: string, ref: string }[]} artifact_links
 * @property {string} created
 * @property {string} updated
 * @property {boolean} truncated
 */

/**
 * @param {unknown} scope
 * @returns {scope is TaskScope}
 */
function isTaskScope(scope) {
  return scope === 'personal' || scope === 'project' || scope === 'org';
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isIso8601(value) {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * Validate a starter task record against §1 schema.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, task: StoredTask } | { ok: false, reason: string }}
 */
export function validateTaskRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'task must be an object' };
  }
  const task = /** @type {Record<string, unknown>} */ (raw);

  if (task.schema !== 'knowtation.task/v0') {
    return { ok: false, reason: 'schema must be knowtation.task/v0' };
  }
  if (typeof task.task_id !== 'string' || !TASK_ID_RE.test(task.task_id)) {
    return { ok: false, reason: 'invalid task_id' };
  }
  if (!TASK_KINDS.includes(/** @type {typeof TASK_KINDS[number]} */ (task.kind))) {
    return { ok: false, reason: 'invalid kind' };
  }
  if (!isTaskScope(task.scope)) {
    return { ok: false, reason: 'scope must be personal|project|org' };
  }
  if (!TASK_STATUSES.includes(/** @type {typeof TASK_STATUSES[number]} */ (task.status))) {
    return { ok: false, reason: 'invalid status' };
  }
  if (typeof task.title !== 'string' || !task.title.trim()) {
    return { ok: false, reason: 'title is required' };
  }
  if (typeof task.workspace_id !== 'string' || !task.workspace_id.trim()) {
    return { ok: false, reason: 'workspace_id is required' };
  }
  if (task.due_at !== null && !isIso8601(task.due_at)) {
    return { ok: false, reason: 'due_at must be ISO8601 UTC or null' };
  }
  if (task.assignee_ref != null && (typeof task.assignee_ref !== 'string' || !UID_HASH_REF_RE.test(task.assignee_ref))) {
    return { ok: false, reason: 'assignee_ref must be uid_hash:<64-hex> or null' };
  }
  if (task.assigner_ref != null && typeof task.assigner_ref !== 'string') {
    return { ok: false, reason: 'assigner_ref must be string or null' };
  }
  if (task.run_ref != null && (typeof task.run_ref !== 'string' || !FLOW_RUN_ID_RE.test(task.run_ref))) {
    return { ok: false, reason: 'invalid run_ref' };
  }
  if (task.loop_ref != null && (typeof task.loop_ref !== 'string' || !LOOP_ID_RE.test(task.loop_ref))) {
    return { ok: false, reason: 'invalid loop_ref' };
  }
  if (
    task.occurrence_key != null &&
    (typeof task.occurrence_key !== 'string' || !OCCURRENCE_KEY_RE.test(task.occurrence_key))
  ) {
    return { ok: false, reason: 'invalid occurrence_key' };
  }
  if (task.occurrence_at != null && task.occurrence_at !== null && !isIso8601(task.occurrence_at)) {
    return { ok: false, reason: 'occurrence_at must be ISO8601 or null' };
  }
  if (
    task.series_status_snapshot != null &&
    task.series_status_snapshot !== null &&
    !LOOP_STATUSES.includes(
      /** @type {typeof LOOP_STATUSES[number]} */ (task.series_status_snapshot),
    )
  ) {
    return { ok: false, reason: 'invalid series_status_snapshot' };
  }
  if (
    task.skip_reason != null &&
    task.skip_reason !== null &&
    (typeof task.skip_reason !== 'string' || task.skip_reason.length > 256)
  ) {
    return { ok: false, reason: 'invalid skip_reason' };
  }
  if (!Array.isArray(task.artifact_links)) {
    return { ok: false, reason: 'artifact_links must be an array' };
  }
  /** @type {{ kind: string, ref: string }[]} */
  const artifactLinks = [];
  for (const link of task.artifact_links) {
    if (!link || typeof link !== 'object') {
      return { ok: false, reason: 'each artifact_link must be an object' };
    }
    const row = /** @type {Record<string, unknown>} */ (link);
    if (!ARTIFACT_LINK_KINDS.includes(/** @type {typeof ARTIFACT_LINK_KINDS[number]} */ (row.kind))) {
      return { ok: false, reason: 'invalid artifact_link kind' };
    }
    if (typeof row.ref !== 'string' || !SAFE_ARTIFACT_REF_RE.test(row.ref)) {
      return { ok: false, reason: 'invalid artifact_link ref' };
    }
    if (Object.keys(row).some((k) => k !== 'kind' && k !== 'ref')) {
      return { ok: false, reason: 'artifact_links are pointer-only (kind, ref)' };
    }
    artifactLinks.push({ kind: row.kind, ref: row.ref });
  }
  if (!isIso8601(task.created)) {
    return { ok: false, reason: 'created must be ISO8601 UTC' };
  }
  if (!isIso8601(task.updated)) {
    return { ok: false, reason: 'updated must be ISO8601 UTC' };
  }
  if (typeof task.truncated !== 'boolean') {
    return { ok: false, reason: 'truncated must be boolean' };
  }

  return {
    ok: true,
    task: {
      schema: 'knowtation.task/v0',
      task_id: task.task_id,
      kind: /** @type {typeof TASK_KINDS[number]} */ (task.kind),
      scope: task.scope,
      status: /** @type {typeof TASK_STATUSES[number]} */ (task.status),
      title: task.title,
      workspace_id: task.workspace_id,
      due_at: task.due_at === null ? null : String(task.due_at),
      assignee_ref: task.assignee_ref == null ? null : String(task.assignee_ref),
      assigner_ref: task.assigner_ref == null ? null : String(task.assigner_ref),
      run_ref: task.run_ref == null ? null : String(task.run_ref),
      loop_ref: task.loop_ref == null ? null : String(task.loop_ref),
      occurrence_key: task.occurrence_key == null ? null : String(task.occurrence_key),
      occurrence_at: task.occurrence_at == null ? null : String(task.occurrence_at),
      series_status_snapshot:
        task.series_status_snapshot == null
          ? null
          : /** @type {typeof LOOP_STATUSES[number]} */ (task.series_status_snapshot),
      skip_reason: task.skip_reason == null ? null : String(task.skip_reason),
      artifact_links: artifactLinks,
      created: String(task.created),
      updated: String(task.updated),
      truncated: task.truncated,
    },
  };
}

/**
 * @param {StoredTask} task
 * @returns {object}
 */
export function taskSummaryForClient(task) {
  return {
    schema: 'knowtation.task/v0',
    task_id: task.task_id,
    kind: task.kind,
    scope: task.scope,
    status: task.status,
    title: task.title,
    workspace_id: task.workspace_id,
    due_at: task.due_at,
    run_ref: task.run_ref ?? null,
    loop_ref: task.loop_ref ?? null,
    occurrence_key: task.occurrence_key ?? null,
    truncated: task.truncated,
  };
}

/**
 * @param {StoredTask} task
 * @returns {StoredTask}
 */
export function taskForClient(task) {
  let links = task.artifact_links ?? [];
  let truncated = task.truncated;
  if (links.length > MAX_ARTIFACT_LINKS) {
    links = links.slice(0, MAX_ARTIFACT_LINKS);
    truncated = true;
  }
  return {
    schema: task.schema,
    task_id: task.task_id,
    kind: task.kind,
    scope: task.scope,
    status: task.status,
    title: task.title,
    workspace_id: task.workspace_id,
    due_at: task.due_at,
    assignee_ref: task.assignee_ref ?? null,
    assigner_ref: task.assigner_ref ?? null,
    run_ref: task.run_ref ?? null,
    loop_ref: task.loop_ref ?? null,
    occurrence_key: task.occurrence_key ?? null,
    occurrence_at: task.occurrence_at ?? null,
    series_status_snapshot: task.series_status_snapshot ?? null,
    skip_reason: task.skip_reason ?? null,
    artifact_links: links,
    created: task.created,
    updated: task.updated,
    truncated,
  };
}

/**
 * Idempotently seed canonical starter tasks from tasks/starter/.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string, onReject?: (name: string, reason: string) => void }} [options]
 * @returns {{ seeded: number, skipped: number }}
 */
export function seedStarterTasks(dataDir, vaultId, options = {}) {
  const starterDir = options.starterDir ?? path.join(getRepoRoot(), STARTER_TASKS_DIRNAME);
  const onReject = options.onReject ?? ((name, reason) => {
    console.warn(`[task-store] rejected starter bundle ${name}: ${reason}`);
  });

  if (!fs.existsSync(starterDir)) {
    return { seeded: 0, skipped: 0 };
  }

  const store = loadFlowStore(dataDir);
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
  } else if (!Array.isArray(store.vaults[vaultId].tasks)) {
    store.vaults[vaultId].tasks = [];
  }
  const vault = store.vaults[vaultId];

  let seeded = 0;
  let skipped = 0;

  const files = fs.readdirSync(starterDir).filter((f) => f.startsWith('task_') && f.endsWith('.json')).sort();
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(starterDir, file), 'utf8'));
    } catch {
      onReject(file, 'invalid JSON');
      continue;
    }

    const validated = validateTaskRecord(raw);
    if (!validated.ok) {
      onReject(file, validated.reason);
      continue;
    }

    const { task } = validated;
    const exists = vault.tasks.some((t) => t.task_id === task.task_id);
    if (exists) {
      skipped += 1;
      continue;
    }

    vault.tasks.push(task);
    seeded += 1;
  }

  if (seeded > 0) {
    saveFlowStore(dataDir, store);
  }

  return { seeded, skipped };
}

/**
 * Seed SD-2 anchor run when absent (read-only; does not enable run writes).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {{ seeded: boolean }}
 */
export function seedSd2AnchorRun(dataDir, vaultId) {
  const store = loadFlowStore(dataDir);
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
  } else if (!Array.isArray(store.vaults[vaultId].tasks)) {
    store.vaults[vaultId].tasks = [];
  }
  const vault = store.vaults[vaultId];
  const runId = 'run_overseer_in_progress';
  const exists = vault.runs.some((r) => r.run_id === runId);
  if (exists) {
    return { seeded: false };
  }

  vault.runs.push({
    schema: 'knowtation.flow_run/v0',
    run_id: runId,
    flow_id: 'flow_overseer_handover',
    flow_version: '0.1.0',
    scope: 'project',
    status: 'in_progress',
    task_ref: 'task_2g_handover_001',
    step_states: [],
    started: '2026-06-19T09:00:00Z',
    provenance: {
      actor: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      harness: 'seed',
    },
  });
  saveFlowStore(dataDir, store);
  return { seeded: true };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string, seedSd2Run?: boolean }} [options]
 */
function ensureStarterSeed(dataDir, vaultId, options = {}) {
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (vault && vault.tasks.length > 0) return;
  seedStarterTasks(dataDir, vaultId, { starterDir: options.starterDir });
  if (options.seedSd2Run !== false) {
    seedSd2AnchorRun(dataDir, vaultId);
  }
}

/**
 * Compare tasks for list ordering: due_at asc (nulls last), then task_id asc.
 *
 * @param {StoredTask} a
 * @param {StoredTask} b
 * @returns {number}
 */
function compareTasksForList(a, b) {
  const aDue = a.due_at;
  const bDue = b.due_at;
  if (aDue === null && bDue === null) {
    return a.task_id.localeCompare(b.task_id);
  }
  if (aDue === null) return 1;
  if (bDue === null) return -1;
  const t = Date.parse(aDue) - Date.parse(bDue);
  if (t !== 0) return t;
  return a.task_id.localeCompare(b.task_id);
}

/**
 * List scope-visible tasks (content-minimized summaries).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   visibleScopes?: Set<TaskScope>,
 *   filterScopes?: Set<TaskScope>,
 *   effectiveScope: TaskScope,
 *   workspaceId?: string,
 *   status?: string,
 *   kind?: string,
 *   loopRef?: string,
 *   occurrenceKey?: string,
 *   limit?: number,
 *   starterDir?: string,
 * }} query
 * @returns {{ schema: 'knowtation.task_list/v0', vault_id: string, effective_scope: TaskScope, tasks: object[], truncated: boolean }}
 */
export function listTasks(dataDir, vaultId, query) {
  ensureStarterSeed(dataDir, vaultId, { starterDir: query.starterDir });

  const visibleScopes = query.visibleScopes ?? query.filterScopes ?? new Set(['personal']);
  const filterScopes = query.filterScopes ?? visibleScopes;
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim() ? query.workspaceId.trim() : '';
  const statusFilter =
    typeof query.status === 'string' && query.status.trim() ? query.status.trim() : '';
  const kindFilter = typeof query.kind === 'string' && query.kind.trim() ? query.kind.trim() : '';
  const loopRefFilter =
    typeof query.loopRef === 'string' && query.loopRef.trim() ? query.loopRef.trim() : '';
  const occurrenceKeyFilter =
    typeof query.occurrenceKey === 'string' && query.occurrenceKey.trim()
      ? query.occurrenceKey.trim()
      : '';

  let limit = typeof query.limit === 'number' ? query.limit : MAX_TASK_SUMMARIES;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_TASK_SUMMARIES;
  if (limit > MAX_TASK_SUMMARIES) limit = MAX_TASK_SUMMARIES;

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId] ?? { tasks: [] };
  const tasks = vault.tasks ?? [];

  let candidates = tasks.filter((task) => {
    if (!filterScopes.has(task.scope)) return false;
    if (workspaceId && task.workspace_id !== workspaceId) return false;
    if (statusFilter && task.status !== statusFilter) return false;
    if (kindFilter && task.kind !== kindFilter) return false;
    if (loopRefFilter && (task.loop_ref ?? '') !== loopRefFilter) return false;
    if (occurrenceKeyFilter && (task.occurrence_key ?? '') !== occurrenceKeyFilter) return false;
    return true;
  });

  candidates.sort(compareTasksForList);

  const totalMatching = candidates.length;
  let truncated = totalMatching > limit;
  if (candidates.length > limit) {
    candidates = candidates.slice(0, limit);
  }

  return {
    schema: 'knowtation.task_list/v0',
    vault_id: vaultId,
    effective_scope: query.effectiveScope,
    tasks: candidates.map((task) => taskSummaryForClient(task)),
    truncated,
  };
}

/**
 * Get one task when readable in caller scope, or null (no existence leak).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} taskId
 * @param {{ visibleScopes?: Set<TaskScope>, starterDir?: string }} query
 * @returns {StoredTask|null}
 */
export function getTask(dataDir, vaultId, taskId, query) {
  if (!TASK_ID_RE.test(taskId)) {
    return null;
  }

  ensureStarterSeed(dataDir, vaultId, { starterDir: query.starterDir });

  const filterScopes = query.visibleScopes ?? new Set(['personal']);
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;

  const row = (vault.tasks ?? []).find((t) => t.task_id === taskId);
  if (!row) return null;
  if (!filterScopes.has(row.scope)) return null;
  return row;
}

/**
 * Resolve effective_scope for get responses (highest authorized scope).
 *
 * @param {Set<TaskScope>} visibleScopes
 * @returns {TaskScope}
 */
export function taskGetEffectiveScope(visibleScopes) {
  return highestFlowScope(visibleScopes);
}
