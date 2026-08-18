/**
 * Shared learning-path list/get handlers — Hub REST (KN-WORK-PATH-LIST-b).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §4
 */

import {
  listLearningPaths,
  getLearningPath,
  learningPathForClient,
  pathGetEffectiveScope,
  PATH_ID_RE,
  WORKSPACE_ID_RE,
  PATH_STATUSES,
  MAX_LEARNING_PATH_SUMMARIES,
  LEARNING_PATH_GET_SCHEMA,
} from './path-store.mjs';
import { resolveFlowScopeQuery } from '../flow/flow-scope.mjs';
import { resolveHandlerVisibleScopes } from '../flow/flow-handlers.mjs';

/**
 * @typedef {import('../flow/flow-scope.mjs').FlowScope} FlowScope
 */

/**
 * Parse list limit: integer 1–200; invalid or absent → 200.
 *
 * @param {unknown} raw
 * @returns {number}
 */
export function parsePathListLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return MAX_LEARNING_PATH_SUMMARIES;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LEARNING_PATH_SUMMARIES) {
    return MAX_LEARNING_PATH_SUMMARIES;
  }
  return n;
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   scope?: string,
 *   workspace_id?: string,
 *   workspaceId?: string,
 *   status?: string,
 *   limit?: number|string,
 * }} input
 */
export function handlePathListRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous path scope',
      code: 'PATH_SCOPE_AMBIGUOUS',
    };
  }

  const scopeQuery = resolveFlowScopeQuery(resolved.visibleScopes, input.scope);
  if (!scopeQuery.ok) {
    const code =
      scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'PATH_SCOPE_DENIED' : scopeQuery.code;
    const error =
      scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'Path scope not authorized' : scopeQuery.error;
    return { ok: false, status: scopeQuery.status, error, code };
  }

  const status = typeof input.status === 'string' ? input.status.trim() : '';
  if (status && !PATH_STATUSES.includes(/** @type {typeof PATH_STATUSES[number]} */ (status))) {
    return { ok: false, status: 400, error: 'Invalid status', code: 'BAD_REQUEST' };
  }

  const workspaceId =
    typeof input.workspaceId === 'string'
      ? input.workspaceId
      : typeof input.workspace_id === 'string'
        ? input.workspace_id
        : undefined;
  if (workspaceId != null && String(workspaceId).trim() !== '') {
    const ws = String(workspaceId).trim();
    if (!WORKSPACE_ID_RE.test(ws)) {
      return { ok: false, status: 400, error: 'Invalid workspace_id', code: 'BAD_REQUEST' };
    }
  }

  const payload = listLearningPaths(input.dataDir, input.vaultId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: scopeQuery.filterScopes,
    effectiveScope: pathGetEffectiveScope(resolved.visibleScopes),
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : undefined,
    status: status || undefined,
    limit: parsePathListLimit(input.limit),
  });

  return { ok: true, payload };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   pathId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 * }} input
 */
export function handlePathGetRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous path scope',
      code: 'PATH_SCOPE_AMBIGUOUS',
    };
  }

  const pathId = typeof input.pathId === 'string' ? input.pathId.trim() : '';
  if (!PATH_ID_RE.test(pathId)) {
    return { ok: false, status: 404, error: 'PATH_NOT_FOUND', code: 'PATH_NOT_FOUND' };
  }

  const row = getLearningPath(input.dataDir, input.vaultId, pathId, {
    visibleScopes: resolved.visibleScopes,
  });
  if (!row) {
    return { ok: false, status: 404, error: 'PATH_NOT_FOUND', code: 'PATH_NOT_FOUND' };
  }

  return {
    ok: true,
    payload: {
      schema: LEARNING_PATH_GET_SCHEMA,
      vault_id: input.vaultId,
      effective_scope: pathGetEffectiveScope(resolved.visibleScopes),
      path: learningPathForClient(row),
    },
  };
}
