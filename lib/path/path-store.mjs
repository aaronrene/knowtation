/**
 * Learning-path store — dedicated `learning_paths[]` on hub_flow_store.json (KN-WORK-PATH-LIST-b).
 *
 * No production starter seed. Empty list is honest. Reads are always authorized (JWT + vault +
 * scope); writes go through Review-before-write in path-write.mjs.
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md
 */

import { randomBytes } from 'crypto';
import { loadFlowStore, saveFlowStore } from '../flow/flow-store.mjs';
import { highestFlowScope } from '../flow/flow-scope.mjs';

export const LEARNING_PATH_SCHEMA = 'knowtation.learning_path/v0';
export const LEARNING_PATH_LIST_SCHEMA = 'knowtation.learning_path_list/v0';
export const LEARNING_PATH_GET_SCHEMA = 'knowtation.learning_path_get/v0';

export const PATH_ID_RE = /^path_[a-z0-9_]{1,48}$/;
export const WORKSPACE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
export const SOURCE_DOCUMENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const NOTE_PATH_RE = /^[A-Za-z0-9._/-]+\.md$/;
export const PATH_EXTERNAL_REF_RE = /^scooling\.path:[A-Za-z0-9._:-]{1,200}$/;

export const MAX_LEARNING_PATH_SUMMARIES = 200;
export const MAX_TITLE = 200;
export const MAX_SUMMARY = 2000;
export const MAX_GOAL = 180;
export const MAX_STEP_TITLE = 240;
export const MAX_STEP_OBJECTIVE = 240;
export const MAX_ACTIVE_DECISIONS = 240;
export const MAX_STEPS = 20;
export const MIN_STEPS = 1;
export const MAX_SOURCE_DOCUMENT_IDS = 16;
export const MAX_NOTE_PATH = 256;

export const PATH_SCOPES = /** @type {const} */ (['personal', 'project', 'org']);
export const PATH_STATUSES = /** @type {const} */ (['active', 'paused', 'archived']);
export const PATH_UPDATE_STATUSES = /** @type {const} */ (['active', 'paused']);

const CONTROL_CHAR_RE = /[\u0000-\u001F]/;

/** @typedef {'personal'|'project'|'org'} PathScope */
/** @typedef {'active'|'paused'|'archived'} PathStatus */

/**
 * @typedef {Object} StoredLearningPathStep
 * @property {string} title
 * @property {string} objective
 * @property {string[]} source_document_ids
 */

/**
 * @typedef {Object} StoredLearningPath
 * @property {'knowtation.learning_path/v0'} schema
 * @property {string} path_id
 * @property {PathScope} scope
 * @property {PathStatus} status
 * @property {string} title
 * @property {string} summary
 * @property {string} goal
 * @property {StoredLearningPathStep[]} steps
 * @property {number} current_step_index
 * @property {number} step_count
 * @property {string} next_step_title
 * @property {string} active_decisions
 * @property {string} workspace_id
 * @property {string|null} note_path
 * @property {string} [external_ref]
 * @property {string} created
 * @property {string} updated
 */

/**
 * @param {unknown} scope
 * @returns {scope is PathScope}
 */
export function isPathScope(scope) {
  return scope === 'personal' || scope === 'project' || scope === 'org';
}

/**
 * @param {unknown} status
 * @returns {status is PathStatus}
 */
export function isPathStatus(status) {
  return status === 'active' || status === 'paused' || status === 'archived';
}

/**
 * Server-minted path_id: `path_` + 16 lowercase hex from 8 random bytes.
 *
 * @returns {string}
 */
export function mintPathId() {
  return `path_${randomBytes(8).toString('hex')}`;
}

/**
 * Mint a path_id not already present in `existingIds`.
 *
 * @param {Iterable<string>} existingIds
 * @returns {string}
 */
export function mintUniquePathId(existingIds) {
  const seen = existingIds instanceof Set ? existingIds : new Set(existingIds);
  for (let i = 0; i < 32; i += 1) {
    const id = mintPathId();
    if (!seen.has(id) && PATH_ID_RE.test(id)) return id;
  }
  throw new Error('PATH_ID_MINT_EXHAUSTED');
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function hasControlChars(value) {
  return typeof value === 'string' && CONTROL_CHAR_RE.test(value);
}

/**
 * Vault-relative note pointer. Null when absent.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, note_path: string|null } | { ok: false, code: string, reason: string }}
 */
export function validateNotePath(raw) {
  if (raw == null || raw === '') {
    return { ok: true, note_path: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'PATH_NOTE_PATH_INVALID', reason: 'note_path must be a string or null' };
  }
  const notePath = raw.trim();
  if (!notePath) return { ok: true, note_path: null };
  if (notePath.length > MAX_NOTE_PATH) {
    return { ok: false, code: 'PATH_NOTE_PATH_INVALID', reason: 'note_path exceeds 256 chars' };
  }
  if (notePath.startsWith('/') || notePath.startsWith('~') || notePath.includes('\\')) {
    return { ok: false, code: 'PATH_NOTE_PATH_INVALID', reason: 'note_path must be vault-relative' };
  }
  if (notePath.includes('://') || /^[A-Za-z]:/.test(notePath)) {
    return { ok: false, code: 'PATH_NOTE_PATH_INVALID', reason: 'note_path must not be a URL or drive path' };
  }
  const segments = notePath.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.')) {
    return { ok: false, code: 'PATH_NOTE_PATH_INVALID', reason: 'note_path must not contain .. segments' };
  }
  if (!NOTE_PATH_RE.test(notePath)) {
    return { ok: false, code: 'PATH_NOTE_PATH_INVALID', reason: 'note_path must match vault-relative *.md' };
  }
  return { ok: true, note_path: notePath };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, steps: StoredLearningPathStep[] } | { ok: false, code: string, reason: string }}
 */
export function validateSteps(raw) {
  if (!Array.isArray(raw) || raw.length < MIN_STEPS || raw.length > MAX_STEPS) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      reason: 'steps must be an array of 1–20 items',
    };
  }
  /** @type {StoredLearningPathStep[]} */
  const steps = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return { ok: false, code: 'BAD_REQUEST', reason: 'each step must be an object' };
    }
    const row = /** @type {Record<string, unknown>} */ (item);
    if (typeof row.title !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', reason: 'step.title is required' };
    }
    const title = row.title.trim();
    if (!title || title.length > MAX_STEP_TITLE || hasControlChars(title)) {
      return {
        ok: false,
        code: hasControlChars(title) ? 'PATH_TEXT_INVALID' : 'BAD_REQUEST',
        reason: 'invalid step.title',
      };
    }
    if (typeof row.objective !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', reason: 'step.objective is required' };
    }
    const objective = row.objective.trim();
    if (!objective || objective.length > MAX_STEP_OBJECTIVE || hasControlChars(objective)) {
      return {
        ok: false,
        code: hasControlChars(objective) ? 'PATH_TEXT_INVALID' : 'BAD_REQUEST',
        reason: 'invalid step.objective',
      };
    }
    const idsRaw = row.source_document_ids;
    /** @type {string[]} */
    const sourceDocumentIds = [];
    if (idsRaw == null) {
      // omit → []
    } else if (!Array.isArray(idsRaw)) {
      return { ok: false, code: 'BAD_REQUEST', reason: 'source_document_ids must be an array' };
    } else {
      if (idsRaw.length > MAX_SOURCE_DOCUMENT_IDS) {
        return { ok: false, code: 'BAD_REQUEST', reason: 'source_document_ids exceeds 16 items' };
      }
      for (const id of idsRaw) {
        if (typeof id !== 'string' || !SOURCE_DOCUMENT_ID_RE.test(id)) {
          return { ok: false, code: 'BAD_REQUEST', reason: 'invalid source_document_id' };
        }
        sourceDocumentIds.push(id);
      }
    }
    steps.push({ title, objective, source_document_ids: sourceDocumentIds });
  }
  return { ok: true, steps };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, path: StoredLearningPath } | { ok: false, code: string, reason: string }}
 */
export function validateLearningPathRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'BAD_REQUEST', reason: 'learning_path must be an object' };
  }
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (row.schema !== LEARNING_PATH_SCHEMA) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'schema must be knowtation.learning_path/v0' };
  }
  if (typeof row.path_id !== 'string' || !PATH_ID_RE.test(row.path_id)) {
    return { ok: false, code: 'PATH_NOT_FOUND', reason: 'invalid path_id' };
  }
  if (!isPathScope(row.scope)) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'scope must be personal|project|org' };
  }
  if (!isPathStatus(row.status)) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'status must be active|paused|archived' };
  }

  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!title || title.length > MAX_TITLE) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'title must be 1–200 chars' };
  }
  if (hasControlChars(title)) {
    return { ok: false, code: 'PATH_TEXT_INVALID', reason: 'title contains control characters' };
  }

  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  if (!summary || summary.length > MAX_SUMMARY) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'summary must be 1–2000 chars' };
  }
  if (hasControlChars(summary)) {
    return { ok: false, code: 'PATH_TEXT_INVALID', reason: 'summary contains control characters' };
  }

  const goal = typeof row.goal === 'string' ? row.goal.trim() : '';
  if (!goal || goal.length > MAX_GOAL) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'goal must be 1–180 chars' };
  }
  if (hasControlChars(goal)) {
    return { ok: false, code: 'PATH_TEXT_INVALID', reason: 'goal contains control characters' };
  }

  const stepsResult = validateSteps(row.steps);
  if (!stepsResult.ok) return stepsResult;
  const { steps } = stepsResult;

  if (
    typeof row.current_step_index !== 'number' ||
    !Number.isInteger(row.current_step_index) ||
    row.current_step_index < 0 ||
    row.current_step_index >= steps.length
  ) {
    return {
      ok: false,
      code: 'PATH_STEP_INDEX_INVALID',
      reason: 'current_step_index must be >= 0 and < steps.length',
    };
  }

  const activeDecisions =
    row.active_decisions == null ? '' : typeof row.active_decisions === 'string' ? row.active_decisions.trim() : null;
  if (activeDecisions == null || activeDecisions.length > MAX_ACTIVE_DECISIONS) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'active_decisions must be a string up to 240 chars' };
  }
  if (hasControlChars(activeDecisions)) {
    return { ok: false, code: 'PATH_TEXT_INVALID', reason: 'active_decisions contains control characters' };
  }

  if (typeof row.workspace_id !== 'string' || !WORKSPACE_ID_RE.test(row.workspace_id)) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'invalid workspace_id' };
  }

  const noteResult = validateNotePath(row.note_path);
  if (!noteResult.ok) return noteResult;

  if (typeof row.created !== 'string' || !row.created.trim()) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'created must be ISO8601' };
  }
  if (typeof row.updated !== 'string' || !row.updated.trim()) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'updated must be ISO8601' };
  }

  /** @type {StoredLearningPath} */
  const path = {
    schema: LEARNING_PATH_SCHEMA,
    path_id: row.path_id,
    scope: row.scope,
    status: row.status,
    title,
    summary,
    goal,
    steps,
    current_step_index: row.current_step_index,
    step_count: steps.length,
    next_step_title: steps[row.current_step_index].title,
    active_decisions: activeDecisions,
    workspace_id: row.workspace_id,
    note_path: noteResult.note_path,
    created: String(row.created),
    updated: String(row.updated),
  };
  if (typeof row.external_ref === 'string' && row.external_ref.trim()) {
    path.external_ref = row.external_ref.trim();
  }
  return { ok: true, path };
}

/**
 * List summary — no steps, summary, or note_path.
 *
 * @param {StoredLearningPath} path
 */
export function learningPathSummaryForClient(path) {
  return {
    schema: LEARNING_PATH_SCHEMA,
    path_id: path.path_id,
    scope: path.scope,
    status: path.status,
    title: path.title,
    goal: path.goal,
    current_step_index: path.current_step_index,
    step_count: path.step_count,
    next_step_title: path.next_step_title,
    active_decisions: path.active_decisions,
    workspace_id: path.workspace_id,
    updated: path.updated,
  };
}

/**
 * Full client projection including steps and note_path.
 *
 * @param {StoredLearningPath} path
 */
export function learningPathForClient(path) {
  return {
    schema: LEARNING_PATH_SCHEMA,
    path_id: path.path_id,
    scope: path.scope,
    status: path.status,
    title: path.title,
    summary: path.summary,
    goal: path.goal,
    steps: path.steps.map((s) => ({
      title: s.title,
      objective: s.objective,
      source_document_ids: Array.isArray(s.source_document_ids) ? [...s.source_document_ids] : [],
    })),
    current_step_index: path.current_step_index,
    step_count: path.step_count,
    next_step_title: path.next_step_title,
    active_decisions: path.active_decisions,
    workspace_id: path.workspace_id,
    note_path: path.note_path ?? null,
    created: path.created,
    updated: path.updated,
    ...(typeof path.external_ref === 'string' ? { external_ref: path.external_ref } : {}),
  };
}

/**
 * @param {import('../flow/flow-store.mjs').VaultFlowStore} vault
 */
export function ensureLearningPathBucket(vault) {
  if (!Array.isArray(vault.learning_paths)) {
    vault.learning_paths = [];
  }
}

/**
 * @param {import('../flow/flow-store.mjs').FlowStoreFile} store
 * @param {string} vaultId
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
      learning_paths: [],
    };
  } else {
    ensureLearningPathBucket(store.vaults[vaultId]);
  }
  return store.vaults[vaultId];
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {StoredLearningPath[]}
 */
export function loadLearningPaths(dataDir, vaultId) {
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return [];
  ensureLearningPathBucket(vault);
  return /** @type {StoredLearningPath[]} */ (vault.learning_paths);
}

/**
 * Upsert one path row (last-updated wins on the same path_id). Tests seed via this helper.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {StoredLearningPath} record
 * @returns {StoredLearningPath}
 */
export function upsertLearningPath(dataDir, vaultId, record) {
  const store = loadFlowStore(dataDir);
  const vault = ensureVaultInStore(store, vaultId);
  const idx = vault.learning_paths.findIndex((p) => p.path_id === record.path_id);
  if (idx >= 0) {
    vault.learning_paths[idx] = record;
  } else {
    vault.learning_paths.push(record);
  }
  saveFlowStore(dataDir, store);
  return record;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   visibleScopes?: Set<PathScope>,
 *   filterScopes?: Set<PathScope>,
 *   effectiveScope: PathScope,
 *   workspaceId?: string,
 *   status?: string,
 *   includeArchived?: boolean,
 *   limit?: number,
 * }} query
 */
export function listLearningPaths(dataDir, vaultId, query) {
  const filterScopes = query.filterScopes ?? query.visibleScopes ?? new Set(['personal']);
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim() ? query.workspaceId.trim() : '';
  const statusFilter =
    typeof query.status === 'string' && query.status.trim() ? query.status.trim() : '';

  let limit = typeof query.limit === 'number' ? query.limit : MAX_LEARNING_PATH_SUMMARIES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LEARNING_PATH_SUMMARIES) {
    limit = MAX_LEARNING_PATH_SUMMARIES;
  }

  const paths = loadLearningPaths(dataDir, vaultId);
  let candidates = paths.filter((row) => {
    if (!filterScopes.has(row.scope)) return false;
    if (workspaceId && row.workspace_id !== workspaceId) return false;
    if (statusFilter) {
      if (row.status !== statusFilter) return false;
    } else if (row.status === 'archived') {
      return false;
    }
    return true;
  });

  candidates.sort((a, b) => {
    const t = Date.parse(b.updated ?? 0) - Date.parse(a.updated ?? 0);
    if (t !== 0) return t;
    return a.path_id.localeCompare(b.path_id);
  });

  const truncated = candidates.length > limit;
  if (candidates.length > limit) {
    candidates = candidates.slice(0, limit);
  }

  return {
    schema: LEARNING_PATH_LIST_SCHEMA,
    vault_id: vaultId,
    effective_scope: query.effectiveScope,
    paths: candidates.map((row) => learningPathSummaryForClient(row)),
    truncated,
  };
}

/**
 * Get one path when visible; null for missing, invalid id, or out of scope (no leak).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} pathId
 * @param {{ visibleScopes?: Set<PathScope> }} query
 * @returns {StoredLearningPath|null}
 */
export function getLearningPath(dataDir, vaultId, pathId, query) {
  if (typeof pathId !== 'string' || !PATH_ID_RE.test(pathId)) {
    return null;
  }
  const filterScopes = query.visibleScopes ?? new Set(['personal']);
  const row = loadLearningPaths(dataDir, vaultId).find((p) => p.path_id === pathId);
  if (!row) return null;
  if (!filterScopes.has(row.scope)) return null;
  return row;
}

/**
 * @param {Set<PathScope>} visibleScopes
 * @returns {PathScope}
 */
export function pathGetEffectiveScope(visibleScopes) {
  return highestFlowScope(visibleScopes);
}
