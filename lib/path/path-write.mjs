/**
 * Learning-path write facade (KN-WORK-PATH-LIST-b).
 *
 * Review-before-write propose + approve-time apply. Gated by PATH_WRITES_ENABLED
 * (env tri-state; default off). No policy file. Do not edit task-write.mjs.
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md
 */

import fs from 'fs';
import path from 'path';

import { resolveFlowWriteAuthority } from '../flow/flow-scope.mjs';
import { resolveHandlerVisibleScopes } from '../flow/flow-handlers.mjs';
import { loadFlowStore, saveFlowStore } from '../flow/flow-store.mjs';
import {
  PATH_ID_RE,
  WORKSPACE_ID_RE,
  PATH_EXTERNAL_REF_RE,
  PATH_SCOPES,
  PATH_UPDATE_STATUSES,
  validateLearningPathRecord,
  validateSteps,
  validateNotePath,
  hasControlChars,
  mintUniquePathId,
  getLearningPath,
  loadLearningPaths,
  ensureLearningPathBucket,
  MAX_TITLE,
  MAX_SUMMARY,
  MAX_GOAL,
  MAX_ACTIVE_DECISIONS,
} from './path-store.mjs';

export const PATH_PROPOSAL_SOURCE = 'learning_path';
export const PATH_REVIEW_QUEUE = 'learning-path';
export const PATH_PROPOSAL_SCHEMA = 'knowtation.learning_path_proposal/v0';
export const PATH_PROPOSAL_KINDS = /** @type {const} */ (['path_create', 'path_update', 'path_archive']);
export const DEFAULT_WORKSPACE_ID = 'ws-personal';

/** @typedef {typeof PATH_PROPOSAL_KINDS[number]} PathProposalKind */
/** @typedef {'personal'|'project'|'org'} PathScope */

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
 * PATH_WRITES_ENABLED: `1`/`true` on; unset/`false`/`0` off. No policy file.
 *
 * @returns {boolean}
 */
export function getPathWritesEnabled() {
  return envTriState(process.env.PATH_WRITES_ENABLED) === true;
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
 * @param {Set<PathScope>} visibleScopes
 * @param {PathScope} targetScope
 */
export function resolvePathWriteAuthority(visibleScopes, targetScope) {
  const authority = resolveFlowWriteAuthority(visibleScopes, targetScope);
  if (!authority.ok) {
    return {
      ok: false,
      status: authority.status,
      error:
        authority.code === 'FLOW_SCOPE_DENIED'
          ? 'Path write scope not authorized'
          : authority.error,
      code: authority.code === 'FLOW_SCOPE_DENIED' ? 'PATH_SCOPE_DENIED' : authority.code,
    };
  }
  return { ok: true };
}

/**
 * @param {string} proposalId
 */
export function pathProposalMirrorPath(proposalId) {
  return `meta/learning-paths/proposals/${proposalId}.json`;
}

/**
 * @param {object} input
 * @param {object} proposalInput
 */
async function createProposalRecord(input, proposalInput) {
  const withSession = {
    ...proposalInput,
    ...(typeof input.sessionBound === 'boolean' ? { session_bound: input.sessionBound } : {}),
  };
  return await Promise.resolve(input.createProposal(input.dataDir, withSession));
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
    all[idx].path = pathProposalMirrorPath(proposalId);
    fs.writeFileSync(fp, JSON.stringify(all, null, 2), 'utf8');
  }
}

/**
 * @param {unknown} raw
 */
function trimTextField(raw, max, required) {
  if (raw == null) {
    return required
      ? { ok: false, code: 'BAD_REQUEST', reason: 'required text field missing' }
      : { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', reason: 'text field must be a string' };
  }
  const value = raw.trim();
  if (required && !value) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'text field must be non-empty' };
  }
  if (value.length > max) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'text field exceeds max length' };
  }
  if (hasControlChars(value)) {
    return { ok: false, code: 'PATH_TEXT_INVALID', reason: 'text contains control characters' };
  }
  return { ok: true, value };
}

/**
 * @param {object} input
 */
function commonProposeGate(input) {
  if (!getPathWritesEnabled()) {
    return refuse(403, 'PATH_WRITES_DISABLED', 'Path writes are disabled');
  }
  if (typeof input.createProposal !== 'function') {
    return refuse(500, 'RUNTIME_ERROR', 'createProposal is required');
  }
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'PATH_SCOPE_AMBIGUOUS', 'Ambiguous path scope');
  }
  return { ok: true, visibleScopes: resolved.visibleScopes };
}

/**
 * Optional Scooling path external_ref. Malformed → PATH_EXTERNAL_REF_INVALID. Absence allowed.
 *
 * @param {object} body
 */
function resolvePathExternalRef(body) {
  if (!body || typeof body !== 'object') return { ok: true, externalRef: undefined };
  const raw = body.external_ref;
  if (raw == null) return { ok: true, externalRef: undefined };
  const s = String(raw).trim();
  if (!s) return { ok: true, externalRef: undefined };
  if (!PATH_EXTERNAL_REF_RE.test(s)) {
    return refuse(400, 'PATH_EXTERNAL_REF_INVALID', 'external_ref does not match scooling.path:…');
  }
  return { ok: true, externalRef: s };
}

/**
 * Propose path_create | path_update | path_archive. Missing kind defaults to path_create.
 *
 * @param {object} input
 */
export async function handlePathProposeRequest(input) {
  const gate = commonProposeGate(input);
  if (!gate.ok) return gate;

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const proposalKindRaw =
    typeof input.proposalKind === 'string'
      ? input.proposalKind.trim()
      : typeof body.proposal_kind === 'string'
        ? body.proposal_kind.trim()
        : '';
  const proposalKind = proposalKindRaw || 'path_create';
  if (!PATH_PROPOSAL_KINDS.includes(/** @type {PathProposalKind} */ (proposalKind))) {
    return refuse(400, 'BAD_REQUEST', 'proposal_kind must be path_create|path_update|path_archive');
  }

  if (proposalKind === 'path_create') {
    return await handlePathCreatePropose(input, gate.visibleScopes, body);
  }
  if (proposalKind === 'path_update') {
    return await handlePathUpdatePropose(input, gate.visibleScopes, body);
  }
  return await handlePathArchivePropose(input, gate.visibleScopes, body);
}

/**
 * @param {object} input
 * @param {Set<PathScope>} visibleScopes
 * @param {Record<string, unknown>} body
 */
async function handlePathCreatePropose(input, visibleScopes, body) {
  if (body.path_id != null && String(body.path_id).trim() !== '') {
    return refuse(400, 'PATH_ID_NOT_ALLOWED', 'Client cannot supply path_id on path_create');
  }

  const ext = resolvePathExternalRef(body);
  if (!ext.ok) return ext;

  const title = trimTextField(body.title, MAX_TITLE, true);
  if (!title.ok) return refuse(400, title.code, title.reason);
  const summary = trimTextField(body.summary, MAX_SUMMARY, true);
  if (!summary.ok) return refuse(400, summary.code, summary.reason);
  const goal = trimTextField(body.goal, MAX_GOAL, true);
  if (!goal.ok) return refuse(400, goal.code, goal.reason);
  const activeDecisions = trimTextField(body.active_decisions, MAX_ACTIVE_DECISIONS, false);
  if (!activeDecisions.ok) return refuse(400, activeDecisions.code, activeDecisions.reason);

  const stepsResult = validateSteps(body.steps);
  if (!stepsResult.ok) return refuse(400, stepsResult.code, stepsResult.reason);

  let currentStepIndex = 0;
  if (body.current_step_index != null) {
    if (
      typeof body.current_step_index !== 'number' ||
      !Number.isInteger(body.current_step_index) ||
      body.current_step_index < 0 ||
      body.current_step_index >= stepsResult.steps.length
    ) {
      return refuse(400, 'PATH_STEP_INDEX_INVALID', 'current_step_index must be >= 0 and < steps.length');
    }
    currentStepIndex = body.current_step_index;
  }

  let scope = 'personal';
  if (body.scope != null && body.scope !== '') {
    if (!PATH_SCOPES.includes(/** @type {PathScope} */ (body.scope))) {
      return refuse(400, 'BAD_REQUEST', 'scope must be personal|project|org');
    }
    scope = /** @type {PathScope} */ (body.scope);
  }
  const authority = resolvePathWriteAuthority(visibleScopes, scope);
  if (!authority.ok) return authority;

  let workspaceId = DEFAULT_WORKSPACE_ID;
  if (body.workspace_id != null && String(body.workspace_id).trim() !== '') {
    const ws = String(body.workspace_id).trim();
    if (!WORKSPACE_ID_RE.test(ws)) {
      return refuse(400, 'BAD_REQUEST', 'invalid workspace_id');
    }
    workspaceId = ws;
  }

  const noteResult = validateNotePath(body.note_path);
  if (!noteResult.ok) return refuse(400, noteResult.code, noteResult.reason);

  const existingIds = loadLearningPaths(input.dataDir, input.vaultId).map((p) => p.path_id);
  const pathId = mintUniquePathId(existingIds);
  const now = new Date().toISOString();
  const draft = {
    schema: 'knowtation.learning_path/v0',
    path_id: pathId,
    scope,
    status: 'active',
    title: title.value,
    summary: summary.value,
    goal: goal.value,
    steps: stepsResult.steps,
    current_step_index: currentStepIndex,
    step_count: stepsResult.steps.length,
    next_step_title: stepsResult.steps[currentStepIndex].title,
    active_decisions: activeDecisions.value,
    workspace_id: workspaceId,
    note_path: noteResult.note_path,
    created: now,
    updated: now,
    ...(ext.externalRef ? { external_ref: ext.externalRef } : {}),
  };

  const validated = validateLearningPathRecord(draft);
  if (!validated.ok) return refuse(400, validated.code, validated.reason);

  const proposalBody = JSON.stringify(
    { proposal_kind: 'path_create', path: validated.path },
    null,
    2,
  );
  const intent =
    typeof input.intent === 'string' && input.intent.trim()
      ? input.intent.trim()
      : typeof body.intent === 'string' && body.intent.trim()
        ? body.intent.trim()
        : 'learning path create';

  const proposal = await createProposalRecord(input, {
    path: pathProposalMirrorPath('new'),
    body: proposalBody,
    frontmatter: {
      type: 'learning_path_proposal',
      path_id: pathId,
      proposal_kind: 'path_create',
    },
    intent,
    source: PATH_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: PATH_REVIEW_QUEUE,
    ...(ext.externalRef ? { external_ref: ext.externalRef } : {}),
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return {
    ok: true,
    payload: {
      schema: PATH_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      proposal_kind: 'path_create',
      path_id: pathId,
      scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: PATH_REVIEW_QUEUE,
    },
  };
}

/**
 * @param {object} input
 * @param {Set<PathScope>} visibleScopes
 * @param {Record<string, unknown>} body
 */
async function handlePathUpdatePropose(input, visibleScopes, body) {
  const pathId = typeof body.path_id === 'string' ? body.path_id.trim() : '';
  if (!pathId || !PATH_ID_RE.test(pathId)) {
    return refuse(404, 'PATH_NOT_FOUND', 'PATH_NOT_FOUND');
  }

  if (body.scope != null || body.workspace_id != null) {
    return refuse(400, 'PATH_SCOPE_IMMUTABLE', 'scope and workspace_id cannot change after create');
  }

  const existing = getLearningPath(input.dataDir, input.vaultId, pathId, { visibleScopes });
  if (!existing) {
    return refuse(404, 'PATH_NOT_FOUND', 'PATH_NOT_FOUND');
  }

  const authority = resolvePathWriteAuthority(visibleScopes, existing.scope);
  if (!authority.ok) return authority;

  if (body.status === 'archived') {
    return refuse(400, 'BAD_REQUEST', 'status=archived requires path_archive');
  }

  /** @type {Record<string, unknown>} */
  const patch = {};
  if (body.title != null) {
    const title = trimTextField(body.title, MAX_TITLE, true);
    if (!title.ok) return refuse(400, title.code, title.reason);
    patch.title = title.value;
  }
  if (body.summary != null) {
    const summary = trimTextField(body.summary, MAX_SUMMARY, true);
    if (!summary.ok) return refuse(400, summary.code, summary.reason);
    patch.summary = summary.value;
  }
  if (body.goal != null) {
    const goal = trimTextField(body.goal, MAX_GOAL, true);
    if (!goal.ok) return refuse(400, goal.code, goal.reason);
    patch.goal = goal.value;
  }
  if (body.active_decisions != null) {
    const ad = trimTextField(body.active_decisions, MAX_ACTIVE_DECISIONS, false);
    if (!ad.ok) return refuse(400, ad.code, ad.reason);
    patch.active_decisions = ad.value;
  }
  if (body.status != null) {
    if (!PATH_UPDATE_STATUSES.includes(/** @type {'active'|'paused'} */ (body.status))) {
      return refuse(400, 'BAD_REQUEST', 'status on update must be active|paused');
    }
    patch.status = body.status;
  }
  if (body.note_path !== undefined) {
    const noteResult = validateNotePath(body.note_path);
    if (!noteResult.ok) return refuse(400, noteResult.code, noteResult.reason);
    patch.note_path = noteResult.note_path;
  }

  let nextSteps = existing.steps;
  if (body.steps != null) {
    const stepsResult = validateSteps(body.steps);
    if (!stepsResult.ok) return refuse(400, stepsResult.code, stepsResult.reason);
    nextSteps = stepsResult.steps;
    patch.steps = nextSteps;
  }

  if (body.current_step_index != null) {
    if (
      typeof body.current_step_index !== 'number' ||
      !Number.isInteger(body.current_step_index) ||
      body.current_step_index < 0 ||
      body.current_step_index >= nextSteps.length
    ) {
      return refuse(400, 'PATH_STEP_INDEX_INVALID', 'current_step_index must be >= 0 and < steps.length');
    }
    patch.current_step_index = body.current_step_index;
  } else if (body.steps != null) {
    if (existing.current_step_index >= nextSteps.length) {
      return refuse(400, 'PATH_STEP_INDEX_INVALID', 'existing current_step_index no longer fits patched steps');
    }
  }

  const intent =
    typeof input.intent === 'string' && input.intent.trim()
      ? input.intent.trim()
      : typeof body.intent === 'string' && body.intent.trim()
        ? body.intent.trim()
        : 'learning path update';

  const proposalBody = JSON.stringify(
    { proposal_kind: 'path_update', path_id: pathId, scope: existing.scope, patch },
    null,
    2,
  );
  const proposal = await createProposalRecord(input, {
    path: pathProposalMirrorPath('new'),
    body: proposalBody,
    frontmatter: {
      type: 'learning_path_proposal',
      path_id: pathId,
      proposal_kind: 'path_update',
    },
    intent,
    source: PATH_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: PATH_REVIEW_QUEUE,
  });
  updateProposalPath(input.dataDir, proposal.proposal_id);
  return {
    ok: true,
    payload: {
      schema: PATH_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      proposal_kind: 'path_update',
      path_id: pathId,
      scope: existing.scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: PATH_REVIEW_QUEUE,
    },
  };
}

/**
 * @param {object} input
 * @param {Set<PathScope>} visibleScopes
 * @param {Record<string, unknown>} body
 */
async function handlePathArchivePropose(input, visibleScopes, body) {
  const pathId = typeof body.path_id === 'string' ? body.path_id.trim() : '';
  if (!pathId || !PATH_ID_RE.test(pathId)) {
    return refuse(404, 'PATH_NOT_FOUND', 'PATH_NOT_FOUND');
  }
  const existing = getLearningPath(input.dataDir, input.vaultId, pathId, { visibleScopes });
  if (!existing) {
    return refuse(404, 'PATH_NOT_FOUND', 'PATH_NOT_FOUND');
  }
  const authority = resolvePathWriteAuthority(visibleScopes, existing.scope);
  if (!authority.ok) return authority;

  const intent =
    typeof input.intent === 'string' && input.intent.trim()
      ? input.intent.trim()
      : typeof body.intent === 'string' && body.intent.trim()
        ? body.intent.trim()
        : 'learning path archive';

  const proposalBody = JSON.stringify(
    { proposal_kind: 'path_archive', path_id: pathId, scope: existing.scope },
    null,
    2,
  );
  const proposal = await createProposalRecord(input, {
    path: pathProposalMirrorPath('new'),
    body: proposalBody,
    frontmatter: {
      type: 'learning_path_proposal',
      path_id: pathId,
      proposal_kind: 'path_archive',
    },
    intent,
    source: PATH_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: PATH_REVIEW_QUEUE,
  });
  updateProposalPath(input.dataDir, proposal.proposal_id);
  return {
    ok: true,
    payload: {
      schema: PATH_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      proposal_kind: 'path_archive',
      path_id: pathId,
      scope: existing.scope,
      auto_approvable: false,
      status: 'proposed',
      review_queue: PATH_REVIEW_QUEUE,
    },
  };
}

/**
 * Approve-time re-check. No store write. Fail-closed.
 *
 * @param {string} dataDir
 * @param {object} proposal
 */
export function precheckApprovedPathProposal(dataDir, proposal) {
  if (!getPathWritesEnabled()) {
    return refuse(403, 'PATH_WRITES_DISABLED', 'Path writes are disabled');
  }
  let parsed;
  try {
    parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
  } catch {
    return refuse(400, 'BAD_REQUEST', 'path proposal body is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    return refuse(400, 'BAD_REQUEST', 'path proposal body is not an object');
  }

  const fm = proposal.frontmatter && typeof proposal.frontmatter === 'object' ? proposal.frontmatter : {};
  const proposalKind =
    (typeof parsed.proposal_kind === 'string' && parsed.proposal_kind.trim()) ||
    (typeof fm.proposal_kind === 'string' && fm.proposal_kind.trim()) ||
    '';
  if (!PATH_PROPOSAL_KINDS.includes(/** @type {PathProposalKind} */ (proposalKind))) {
    return refuse(400, 'BAD_REQUEST', 'unknown path proposal_kind');
  }

  const vaultId =
    typeof proposal.vault_id === 'string' && proposal.vault_id.trim() ? proposal.vault_id.trim() : 'default';
  const visibleScopes = new Set(['personal', 'project', 'org']);

  if (proposalKind === 'path_create') {
    const validated = validateLearningPathRecord(parsed.path);
    if (!validated.ok) return refuse(400, validated.code, validated.reason);
    return { ok: true, vaultId, proposalKind, parsed, path: validated.path };
  }

  if (proposalKind === 'path_update') {
    const pathId = typeof parsed.path_id === 'string' ? parsed.path_id.trim() : '';
    const existing = getLearningPath(dataDir, vaultId, pathId, { visibleScopes });
    if (!existing) return refuse(404, 'PATH_NOT_FOUND', 'PATH_NOT_FOUND');
    return { ok: true, vaultId, proposalKind, parsed, existing };
  }

  if (proposalKind === 'path_archive') {
    const pathId = typeof parsed.path_id === 'string' ? parsed.path_id.trim() : '';
    const existing = getLearningPath(dataDir, vaultId, pathId, { visibleScopes });
    if (!existing) return refuse(404, 'PATH_NOT_FOUND', 'PATH_NOT_FOUND');
    return { ok: true, vaultId, proposalKind, parsed, existing };
  }

  return refuse(400, 'BAD_REQUEST', 'unknown path proposal_kind');
}

/**
 * Apply a pre-checked path proposal into hub_flow_store.json learning_paths[].
 *
 * @param {string} dataDir
 * @param {object} applyCtx
 */
export function reconcileApprovedPathProposal(dataDir, applyCtx) {
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
      learning_paths: [],
    };
  }
  const vault = store.vaults[vaultId];
  ensureLearningPathBucket(vault);
  const now = new Date().toISOString();
  const kind = applyCtx.proposalKind;

  if (kind === 'path_create') {
    const record = { ...applyCtx.path, updated: now };
    const idx = vault.learning_paths.findIndex((p) => p.path_id === record.path_id);
    if (idx >= 0) {
      record.created = vault.learning_paths[idx].created;
      vault.learning_paths[idx] = record;
    } else {
      vault.learning_paths.push(record);
    }
    saveFlowStore(dataDir, store);
    return { applied: true, path_id: record.path_id };
  }

  if (kind === 'path_update') {
    const pathId = applyCtx.parsed.path_id;
    const idx = vault.learning_paths.findIndex((p) => p.path_id === pathId);
    if (idx < 0) throw new Error('path missing at apply');
    const existing = vault.learning_paths[idx];
    const patch = applyCtx.parsed.patch && typeof applyCtx.parsed.patch === 'object' ? applyCtx.parsed.patch : {};
    const nextSteps = Array.isArray(patch.steps) ? patch.steps : existing.steps;
    const nextIndex =
      typeof patch.current_step_index === 'number' ? patch.current_step_index : existing.current_step_index;
    const merged = {
      ...existing,
      ...patch,
      steps: nextSteps,
      current_step_index: nextIndex,
      step_count: nextSteps.length,
      next_step_title: nextSteps[nextIndex].title,
      updated: now,
    };
    vault.learning_paths[idx] = merged;
    saveFlowStore(dataDir, store);
    return { applied: true, path_id: pathId };
  }

  if (kind === 'path_archive') {
    const pathId = applyCtx.parsed.path_id;
    const idx = vault.learning_paths.findIndex((p) => p.path_id === pathId);
    if (idx < 0) throw new Error('path missing at apply');
    vault.learning_paths[idx] = {
      ...vault.learning_paths[idx],
      status: 'archived',
      updated: now,
    };
    saveFlowStore(dataDir, store);
    return { applied: true, path_id: pathId };
  }

  throw new Error(`unsupported path proposal_kind at apply: ${kind}`);
}

/**
 * Hosted/self-hosted apply-approved entry (gate + precheck + reconcile).
 *
 * @param {string} dataDir
 * @param {object} proposal
 */
export function applyApprovedPathProposal(dataDir, proposal) {
  const precheck = precheckApprovedPathProposal(dataDir, proposal);
  if (!precheck.ok) return precheck;
  const reconcile = reconcileApprovedPathProposal(dataDir, precheck);
  return {
    ok: true,
    payload: {
      applied: true,
      proposal_id: proposal.proposal_id ?? null,
      vault_id: precheck.vaultId,
      proposal_kind: precheck.proposalKind,
      path_id: reconcile.path_id,
    },
  };
}
