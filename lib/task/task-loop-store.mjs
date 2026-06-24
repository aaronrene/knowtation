/**
 * Local file-backed Task Loop store (Phase 2G-c-b — read-only list/get).
 *
 * Task loops and orchestrator graphs persist in `hub_flow_store.json` vault buckets.
 * Idempotent starter seed on first read.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md
 */

import fs from 'fs';
import path from 'path';
import { getRepoRoot } from '../repo-root.mjs';
import { loadFlowStore, saveFlowStore } from '../flow/flow-store.mjs';
import { highestFlowScope } from '../flow/flow-scope.mjs';
import {
  TASK_KINDS,
  UID_HASH_REF_RE,
  SAFE_ARTIFACT_REF_RE,
  validateTaskRecord,
} from './task-store.mjs';

export const STARTER_TASK_LOOPS_DIRNAME = 'task-loops/starter';
export const STARTER_ORCHESTRATOR_GRAPHS_DIRNAME = 'orchestrator-graphs/starter';
export const STARTER_LOOP_INSTANCES_DIRNAME = 'task-loops/starter/instances';

export const MAX_TASK_LOOP_SUMMARIES = 200;

export const LOOP_ID_RE = /^loop_[a-z0-9_]{1,48}$/;
export const OCCURRENCE_KEY_RE = /^[A-Za-z0-9._:-]{1,64}$/;
export const GRAPH_ID_RE = /^graph_[a-z0-9_]{1,48}$/;

export const LOOP_STATUSES = /** @type {const} */ (['active', 'paused', 'cancelled']);

export const BOUNDARY_POLICIES = /** @type {const} */ ([
  'observe_only',
  'draft_only',
  'propose_only',
  'execute_with_consent',
]);

export const COMPOSITION_TIERS = /** @type {const} */ (['personal_safe']);

export const RECURRENCE_KINDS = /** @type {const} */ ([
  'cron',
  'interval',
  'manual',
  'on_wake',
]);

export const HANDOFF_TRIGGERS = /** @type {const} */ (['on_pass', 'on_trigger', 'on_conflict']);

/** @typedef {'personal'|'project'|'org'} TaskLoopScope */

/**
 * @typedef {Object} StoredTaskLoop
 * @property {'knowtation.task_loop/v0'} schema
 * @property {string} loop_id
 * @property {typeof TASK_KINDS[number]} kind
 * @property {TaskLoopScope} scope
 * @property {typeof LOOP_STATUSES[number]} status
 * @property {string} title
 * @property {string} workspace_id
 * @property {object} recurrence
 * @property {string} timezone
 * @property {string|null} [flow_id]
 * @property {typeof BOUNDARY_POLICIES[number]} boundary_policy
 * @property {{ kind: string, ref: string }[]} memory_links
 * @property {string[]} [handoff_refs]
 * @property {string|null} [until_at]
 * @property {string} created
 * @property {string} updated
 * @property {boolean} truncated
 */

/**
 * @typedef {Object} StoredOrchestratorGraph
 * @property {'knowtation.orchestrator_graph/v0'} schema
 * @property {string} graph_id
 * @property {TaskLoopScope} scope
 * @property {string} workspace_id
 * @property {string} title
 * @property {string[]} nodes
 * @property {{ from: string, to: string, trigger: typeof HANDOFF_TRIGGERS[number] }[]} edges
 * @property {typeof COMPOSITION_TIERS[number]} composition_tier
 * @property {string} created
 * @property {string} updated
 */

/**
 * @param {unknown} scope
 * @returns {scope is TaskLoopScope}
 */
function isTaskLoopScope(scope) {
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
 * @param {unknown} raw
 * @returns {{ ok: true, recurrence: object } | { ok: false, reason: string }}
 */
export function validateRecurrence(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'recurrence must be an object' };
  }
  const recurrence = /** @type {Record<string, unknown>} */ (raw);
  const kind = recurrence.kind;
  if (typeof kind !== 'string' || !RECURRENCE_KINDS.includes(/** @type {typeof RECURRENCE_KINDS[number]} */ (kind))) {
    return { ok: false, reason: 'invalid recurrence.kind' };
  }

  if (kind === 'cron') {
    if (typeof recurrence.expression !== 'string' || !recurrence.expression.trim()) {
      return { ok: false, reason: 'cron recurrence requires expression' };
    }
    if (typeof recurrence.anchor_tz !== 'string' || !recurrence.anchor_tz.trim()) {
      return { ok: false, reason: 'cron recurrence requires anchor_tz' };
    }
    return {
      ok: true,
      recurrence: {
        kind: 'cron',
        expression: recurrence.expression,
        anchor_tz: recurrence.anchor_tz,
      },
    };
  }

  if (kind === 'interval') {
    if (typeof recurrence.every !== 'number' || !Number.isInteger(recurrence.every) || recurrence.every < 1) {
      return { ok: false, reason: 'interval recurrence requires positive integer every' };
    }
    const unit = recurrence.unit;
    if (unit !== 'day' && unit !== 'week' && unit !== 'month') {
      return { ok: false, reason: 'interval unit must be day|week|month' };
    }
    if (!isIso8601(recurrence.anchor_at)) {
      return { ok: false, reason: 'interval recurrence requires anchor_at ISO8601' };
    }
    return {
      ok: true,
      recurrence: {
        kind: 'interval',
        every: recurrence.every,
        unit,
        anchor_at: String(recurrence.anchor_at),
      },
    };
  }

  if (kind === 'manual') {
    return { ok: true, recurrence: { kind: 'manual' } };
  }

  if (kind === 'on_wake') {
    const sourceLoopRef = recurrence.source_loop_ref;
    if (typeof sourceLoopRef !== 'string' || !LOOP_ID_RE.test(sourceLoopRef)) {
      return { ok: false, reason: 'on_wake recurrence requires valid source_loop_ref' };
    }
    return {
      ok: true,
      recurrence: { kind: 'on_wake', source_loop_ref: sourceLoopRef },
    };
  }

  return { ok: false, reason: 'unsupported recurrence kind' };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, loop: StoredTaskLoop } | { ok: false, reason: string }}
 */
export function validateTaskLoopRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'task_loop must be an object' };
  }
  const loop = /** @type {Record<string, unknown>} */ (raw);

  if (loop.schema !== 'knowtation.task_loop/v0') {
    return { ok: false, reason: 'schema must be knowtation.task_loop/v0' };
  }
  if (typeof loop.loop_id !== 'string' || !LOOP_ID_RE.test(loop.loop_id)) {
    return { ok: false, reason: 'invalid loop_id' };
  }
  if (!TASK_KINDS.includes(/** @type {typeof TASK_KINDS[number]} */ (loop.kind))) {
    return { ok: false, reason: 'invalid kind' };
  }
  if (!isTaskLoopScope(loop.scope)) {
    return { ok: false, reason: 'scope must be personal|project|org' };
  }
  if (!LOOP_STATUSES.includes(/** @type {typeof LOOP_STATUSES[number]} */ (loop.status))) {
    return { ok: false, reason: 'invalid status' };
  }
  if (typeof loop.title !== 'string' || !loop.title.trim()) {
    return { ok: false, reason: 'title is required' };
  }
  if (typeof loop.workspace_id !== 'string' || !loop.workspace_id.trim()) {
    return { ok: false, reason: 'workspace_id is required' };
  }

  const recurrenceResult = validateRecurrence(loop.recurrence);
  if (!recurrenceResult.ok) {
    return recurrenceResult;
  }

  if (typeof loop.timezone !== 'string' || !loop.timezone.trim()) {
    return { ok: false, reason: 'timezone is required' };
  }
  if (loop.flow_id != null && typeof loop.flow_id !== 'string') {
    return { ok: false, reason: 'flow_id must be string or null' };
  }
  if (
    !BOUNDARY_POLICIES.includes(
      /** @type {typeof BOUNDARY_POLICIES[number]} */ (loop.boundary_policy),
    )
  ) {
    return { ok: false, reason: 'invalid boundary_policy' };
  }
  if (!Array.isArray(loop.memory_links)) {
    return { ok: false, reason: 'memory_links must be an array' };
  }
  /** @type {{ kind: string, ref: string }[]} */
  const memoryLinks = [];
  for (const link of loop.memory_links) {
    if (!link || typeof link !== 'object') {
      return { ok: false, reason: 'each memory_link must be an object' };
    }
    const row = /** @type {Record<string, unknown>} */ (link);
    if (typeof row.kind !== 'string' || !row.kind.trim()) {
      return { ok: false, reason: 'memory_link kind required' };
    }
    if (typeof row.ref !== 'string' || !SAFE_ARTIFACT_REF_RE.test(row.ref)) {
      return { ok: false, reason: 'invalid memory_link ref' };
    }
    if (Object.keys(row).some((k) => k !== 'kind' && k !== 'ref')) {
      return { ok: false, reason: 'memory_links are pointer-only (kind, ref)' };
    }
    memoryLinks.push({ kind: row.kind, ref: row.ref });
  }

  /** @type {string[]} */
  const handoffRefs = [];
  if (loop.handoff_refs != null) {
    if (!Array.isArray(loop.handoff_refs)) {
      return { ok: false, reason: 'handoff_refs must be an array' };
    }
    for (const ref of loop.handoff_refs) {
      if (typeof ref !== 'string' || !GRAPH_ID_RE.test(ref)) {
        return { ok: false, reason: 'invalid handoff_refs entry' };
      }
      handoffRefs.push(ref);
    }
  }

  if (loop.until_at != null && loop.until_at !== null && !isIso8601(loop.until_at)) {
    return { ok: false, reason: 'until_at must be ISO8601 or null' };
  }
  if (!isIso8601(loop.created)) {
    return { ok: false, reason: 'created must be ISO8601 UTC' };
  }
  if (!isIso8601(loop.updated)) {
    return { ok: false, reason: 'updated must be ISO8601 UTC' };
  }
  if (typeof loop.truncated !== 'boolean') {
    return { ok: false, reason: 'truncated must be boolean' };
  }

  return {
    ok: true,
    loop: {
      schema: 'knowtation.task_loop/v0',
      loop_id: loop.loop_id,
      kind: /** @type {typeof TASK_KINDS[number]} */ (loop.kind),
      scope: loop.scope,
      status: /** @type {typeof LOOP_STATUSES[number]} */ (loop.status),
      title: loop.title,
      workspace_id: loop.workspace_id,
      recurrence: recurrenceResult.recurrence,
      timezone: loop.timezone,
      flow_id: loop.flow_id == null ? null : String(loop.flow_id),
      boundary_policy: /** @type {typeof BOUNDARY_POLICIES[number]} */ (loop.boundary_policy),
      memory_links: memoryLinks,
      handoff_refs: handoffRefs.length > 0 ? handoffRefs : undefined,
      until_at: loop.until_at == null ? null : String(loop.until_at),
      created: String(loop.created),
      updated: String(loop.updated),
      truncated: loop.truncated,
    },
  };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, graph: StoredOrchestratorGraph } | { ok: false, reason: string }}
 */
export function validateOrchestratorGraphRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'orchestrator_graph must be an object' };
  }
  const graph = /** @type {Record<string, unknown>} */ (raw);

  if (graph.schema !== 'knowtation.orchestrator_graph/v0') {
    return { ok: false, reason: 'schema must be knowtation.orchestrator_graph/v0' };
  }
  if (typeof graph.graph_id !== 'string' || !GRAPH_ID_RE.test(graph.graph_id)) {
    return { ok: false, reason: 'invalid graph_id' };
  }
  if (!isTaskLoopScope(graph.scope)) {
    return { ok: false, reason: 'scope must be personal|project|org' };
  }
  if (typeof graph.workspace_id !== 'string' || !graph.workspace_id.trim()) {
    return { ok: false, reason: 'workspace_id is required' };
  }
  if (typeof graph.title !== 'string' || !graph.title.trim()) {
    return { ok: false, reason: 'title is required' };
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { ok: false, reason: 'nodes must be a non-empty array' };
  }
  for (const node of graph.nodes) {
    if (typeof node !== 'string' || !LOOP_ID_RE.test(node)) {
      return { ok: false, reason: 'each node must be a valid loop_id' };
    }
  }
  if (!Array.isArray(graph.edges)) {
    return { ok: false, reason: 'edges must be an array' };
  }
  /** @type {{ from: string, to: string, trigger: typeof HANDOFF_TRIGGERS[number] }[]} */
  const edges = [];
  for (const edge of graph.edges) {
    if (!edge || typeof edge !== 'object') {
      return { ok: false, reason: 'each edge must be an object' };
    }
    const row = /** @type {Record<string, unknown>} */ (edge);
    if (typeof row.from !== 'string' || !LOOP_ID_RE.test(row.from)) {
      return { ok: false, reason: 'edge.from must be valid loop_id' };
    }
    if (typeof row.to !== 'string' || !LOOP_ID_RE.test(row.to)) {
      return { ok: false, reason: 'edge.to must be valid loop_id' };
    }
    if (
      !HANDOFF_TRIGGERS.includes(
        /** @type {typeof HANDOFF_TRIGGERS[number]} */ (row.trigger),
      )
    ) {
      return { ok: false, reason: 'invalid edge.trigger' };
    }
    edges.push({
      from: row.from,
      to: row.to,
      trigger: /** @type {typeof HANDOFF_TRIGGERS[number]} */ (row.trigger),
    });
  }
  if (
    !COMPOSITION_TIERS.includes(
      /** @type {typeof COMPOSITION_TIERS[number]} */ (graph.composition_tier),
    )
  ) {
    return { ok: false, reason: 'invalid composition_tier' };
  }
  if (!isIso8601(graph.created)) {
    return { ok: false, reason: 'created must be ISO8601 UTC' };
  }
  if (!isIso8601(graph.updated)) {
    return { ok: false, reason: 'updated must be ISO8601 UTC' };
  }

  return {
    ok: true,
    graph: {
      schema: 'knowtation.orchestrator_graph/v0',
      graph_id: graph.graph_id,
      scope: graph.scope,
      workspace_id: graph.workspace_id,
      title: graph.title,
      nodes: [...graph.nodes],
      edges,
      composition_tier: /** @type {typeof COMPOSITION_TIERS[number]} */ (graph.composition_tier),
      created: String(graph.created),
      updated: String(graph.updated),
    },
  };
}

/**
 * @param {StoredTaskLoop} loop
 * @returns {object}
 */
export function taskLoopSummaryForClient(loop) {
  return {
    schema: 'knowtation.task_loop/v0',
    loop_id: loop.loop_id,
    kind: loop.kind,
    scope: loop.scope,
    status: loop.status,
    title: loop.title,
    workspace_id: loop.workspace_id,
    recurrence_kind: loop.recurrence.kind,
    boundary_policy: loop.boundary_policy,
    truncated: loop.truncated,
  };
}

/**
 * @param {StoredTaskLoop} loop
 * @returns {StoredTaskLoop}
 */
export function taskLoopForClient(loop) {
  return { ...loop };
}

/**
 * @param {StoredOrchestratorGraph} graph
 * @returns {StoredOrchestratorGraph}
 */
export function orchestratorGraphForClient(graph) {
  return { ...graph };
}

/**
 * Ensure vault bucket arrays exist for loop store extensions.
 *
 * @param {import('../flow/flow-store.mjs').VaultFlowStore} vault
 */
function ensureLoopVaultBuckets(vault) {
  if (!Array.isArray(vault.task_loops)) {
    vault.task_loops = [];
  }
  if (!Array.isArray(vault.orchestrator_graphs)) {
    vault.orchestrator_graphs = [];
  }
}

/**
 * @param {import('../flow/flow-store.mjs').FlowStoreFile} store
 * @param {string} vaultId
 * @returns {import('../flow/flow-store.mjs').VaultFlowStore}
 */
function ensureVaultInStore(store, vaultId) {
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
  } else {
    ensureLoopVaultBuckets(store.vaults[vaultId]);
    if (!Array.isArray(store.vaults[vaultId].tasks)) {
      store.vaults[vaultId].tasks = [];
    }
  }
  return store.vaults[vaultId];
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {import('../flow/flow-store.mjs').VaultFlowStore}
 */
function getVaultWithLoopBuckets(dataDir, vaultId) {
  const store = loadFlowStore(dataDir);
  return ensureVaultInStore(store, vaultId);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string, onReject?: (name: string, reason: string) => void }} [options]
 */
export function seedStarterTaskLoops(dataDir, vaultId, options = {}) {
  const starterDir =
    options.starterDir ?? path.join(getRepoRoot(), STARTER_TASK_LOOPS_DIRNAME);
  const onReject = options.onReject ?? ((name, reason) => {
    console.warn(`[task-loop-store] rejected loop ${name}: ${reason}`);
  });

  if (!fs.existsSync(starterDir)) {
    return { seeded: 0, skipped: 0 };
  }

  const store = loadFlowStore(dataDir);
  const vault = ensureVaultInStore(store, vaultId);

  let seeded = 0;
  let skipped = 0;

  const files = fs
    .readdirSync(starterDir)
    .filter((f) => f.startsWith('loop_') && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(starterDir, file), 'utf8'));
    } catch {
      onReject(file, 'invalid JSON');
      continue;
    }

    const validated = validateTaskLoopRecord(raw);
    if (!validated.ok) {
      onReject(file, validated.reason);
      continue;
    }

    const exists = vault.task_loops.some((l) => l.loop_id === validated.loop.loop_id);
    if (exists) {
      skipped += 1;
      continue;
    }

    vault.task_loops.push(validated.loop);
    seeded += 1;
  }

  if (seeded > 0) {
    saveFlowStore(dataDir, store);
  }

  return { seeded, skipped };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string, onReject?: (name: string, reason: string) => void }} [options]
 */
export function seedStarterOrchestratorGraphs(dataDir, vaultId, options = {}) {
  const starterDir =
    options.starterDir ?? path.join(getRepoRoot(), STARTER_ORCHESTRATOR_GRAPHS_DIRNAME);
  const onReject = options.onReject ?? ((name, reason) => {
    console.warn(`[task-loop-store] rejected graph ${name}: ${reason}`);
  });

  if (!fs.existsSync(starterDir)) {
    return { seeded: 0, skipped: 0 };
  }

  const store = loadFlowStore(dataDir);
  const vault = ensureVaultInStore(store, vaultId);

  let seeded = 0;
  let skipped = 0;

  const files = fs
    .readdirSync(starterDir)
    .filter((f) => f.startsWith('graph_') && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(starterDir, file), 'utf8'));
    } catch {
      onReject(file, 'invalid JSON');
      continue;
    }

    const validated = validateOrchestratorGraphRecord(raw);
    if (!validated.ok) {
      onReject(file, validated.reason);
      continue;
    }

    const exists = vault.orchestrator_graphs.some((g) => g.graph_id === validated.graph.graph_id);
    if (exists) {
      skipped += 1;
      continue;
    }

    vault.orchestrator_graphs.push(validated.graph);
    seeded += 1;
  }

  if (seeded > 0) {
    saveFlowStore(dataDir, store);
  }

  return { seeded, skipped };
}

/**
 * Seed loop instance tasks from task-loops/starter/instances/.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ instancesDir?: string, onReject?: (name: string, reason: string) => void }} [options]
 */
export function seedStarterLoopInstances(dataDir, vaultId, options = {}) {
  const instancesDir =
    options.instancesDir ?? path.join(getRepoRoot(), STARTER_LOOP_INSTANCES_DIRNAME);
  const onReject = options.onReject ?? ((name, reason) => {
    console.warn(`[task-loop-store] rejected instance ${name}: ${reason}`);
  });

  if (!fs.existsSync(instancesDir)) {
    return { seeded: 0, skipped: 0 };
  }

  const store = loadFlowStore(dataDir);
  const vault = ensureVaultInStore(store, vaultId);

  let seeded = 0;
  let skipped = 0;

  const files = fs
    .readdirSync(instancesDir)
    .filter((f) => f.startsWith('task_') && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(instancesDir, file), 'utf8'));
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
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string, instancesDir?: string, graphsDir?: string }} [options]
 */
function ensureLoopStarterSeed(dataDir, vaultId, options = {}) {
  const vault = getVaultWithLoopBuckets(dataDir, vaultId);
  if (vault.task_loops.length > 0) return;

  seedStarterTaskLoops(dataDir, vaultId, { starterDir: options.starterDir });
  seedStarterOrchestratorGraphs(dataDir, vaultId, { starterDir: options.graphsDir });
  seedStarterLoopInstances(dataDir, vaultId, { instancesDir: options.instancesDir });
}

/**
 * Compare loops for list ordering: loop_id asc.
 *
 * @param {StoredTaskLoop} a
 * @param {StoredTaskLoop} b
 */
function compareTaskLoopsForList(a, b) {
  return a.loop_id.localeCompare(b.loop_id);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   visibleScopes?: Set<TaskLoopScope>,
 *   filterScopes?: Set<TaskLoopScope>,
 *   effectiveScope: TaskLoopScope,
 *   workspaceId?: string,
 *   status?: string,
 *   kind?: string,
 *   limit?: number,
 *   starterDir?: string,
 *   graphsDir?: string,
 *   instancesDir?: string,
 * }} query
 */
export function listTaskLoops(dataDir, vaultId, query) {
  ensureLoopStarterSeed(dataDir, vaultId, {
    starterDir: query.starterDir,
    graphsDir: query.graphsDir,
    instancesDir: query.instancesDir,
  });

  const filterScopes = query.filterScopes ?? query.visibleScopes ?? new Set(['personal']);
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim()
      ? query.workspaceId.trim()
      : '';
  const statusFilter =
    typeof query.status === 'string' && query.status.trim() ? query.status.trim() : '';
  const kindFilter = typeof query.kind === 'string' && query.kind.trim() ? query.kind.trim() : '';

  let limit =
    typeof query.limit === 'number' ? query.limit : MAX_TASK_LOOP_SUMMARIES;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_TASK_LOOP_SUMMARIES;
  if (limit > MAX_TASK_LOOP_SUMMARIES) limit = MAX_TASK_LOOP_SUMMARIES;

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId] ?? { task_loops: [] };
  const loops = vault.task_loops ?? [];

  let candidates = loops.filter((loop) => {
    if (!filterScopes.has(loop.scope)) return false;
    if (workspaceId && loop.workspace_id !== workspaceId) return false;
    if (statusFilter && loop.status !== statusFilter) return false;
    if (kindFilter && loop.kind !== kindFilter) return false;
    return true;
  });

  candidates.sort(compareTaskLoopsForList);

  const totalMatching = candidates.length;
  let truncated = totalMatching > limit;
  if (candidates.length > limit) {
    candidates = candidates.slice(0, limit);
  }

  return {
    schema: 'knowtation.task_loop_list/v0',
    vault_id: vaultId,
    effective_scope: query.effectiveScope,
    loops: candidates.map((loop) => taskLoopSummaryForClient(loop)),
    truncated,
  };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} loopId
 * @param {{ visibleScopes?: Set<TaskLoopScope>, starterDir?: string, graphsDir?: string, instancesDir?: string }} query
 * @returns {StoredTaskLoop|null}
 */
export function getTaskLoop(dataDir, vaultId, loopId, query) {
  if (!LOOP_ID_RE.test(loopId)) {
    return null;
  }

  ensureLoopStarterSeed(dataDir, vaultId, {
    starterDir: query.starterDir,
    graphsDir: query.graphsDir,
    instancesDir: query.instancesDir,
  });

  const filterScopes = query.visibleScopes ?? new Set(['personal']);
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;

  const row = (vault.task_loops ?? []).find((l) => l.loop_id === loopId);
  if (!row) return null;
  if (!filterScopes.has(row.scope)) return null;
  return row;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} graphId
 * @param {{ visibleScopes?: Set<TaskLoopScope>, starterDir?: string, graphsDir?: string, instancesDir?: string }} query
 * @returns {StoredOrchestratorGraph|null}
 */
export function getOrchestratorGraph(dataDir, vaultId, graphId, query) {
  if (!GRAPH_ID_RE.test(graphId)) {
    return null;
  }

  ensureLoopStarterSeed(dataDir, vaultId, {
    starterDir: query.starterDir,
    graphsDir: query.graphsDir,
    instancesDir: query.instancesDir,
  });

  const filterScopes = query.visibleScopes ?? new Set(['personal']);
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;

  const row = (vault.orchestrator_graphs ?? []).find((g) => g.graph_id === graphId);
  if (!row) return null;
  if (!filterScopes.has(row.scope)) return null;
  return row;
}

/**
 * @param {Set<TaskLoopScope>} visibleScopes
 * @returns {TaskLoopScope}
 */
export function taskLoopGetEffectiveScope(visibleScopes) {
  return highestFlowScope(visibleScopes);
}

/**
 * Assert (loop_ref, occurrence_key) uniqueness within a vault — data-integrity helper.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {{ ok: true } | { ok: false, duplicate: string }}
 */
export function assertLoopOccurrenceUniqueness(dataDir, vaultId) {
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return { ok: true };

  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const task of vault.tasks ?? []) {
    const loopRef = task.loop_ref;
    const occurrenceKey = task.occurrence_key;
    if (loopRef == null || occurrenceKey == null) continue;
    const key = `${loopRef}::${occurrenceKey}`;
    if (seen.has(key)) {
      return { ok: false, duplicate: key };
    }
    seen.set(key, task.task_id);
  }
  return { ok: true };
}

export { UID_HASH_REF_RE };
