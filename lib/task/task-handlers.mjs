/**
 * Shared Task list/get handlers — CLI = MCP = Hub REST parity (Phase 2G-b).
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §3
 */

import {
  listTasks,
  getTask,
  taskForClient,
  taskGetEffectiveScope,
  TASK_ID_RE,
  MAX_TASK_SUMMARIES,
  TASK_STATUSES,
  TASK_KINDS,
} from './task-store.mjs';
import { resolveFlowScopeQuery } from '../flow/flow-scope.mjs';
import { resolveHandlerVisibleScopes } from '../flow/flow-handlers.mjs';

/**
 * @typedef {import('../flow/flow-scope.mjs').FlowScope} FlowScope
 */

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
 *   kind?: string,
 *   limit?: number,
 *   starterDir?: string,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleTaskListRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous task scope',
      code: 'TASK_SCOPE_AMBIGUOUS',
    };
  }

  const scopeQuery = resolveFlowScopeQuery(resolved.visibleScopes, input.scope);
  if (!scopeQuery.ok) {
    const code = scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'TASK_SCOPE_DENIED' : scopeQuery.code;
    const error =
      scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'Task scope not authorized' : scopeQuery.error;
    return { ok: false, status: scopeQuery.status, error, code };
  }

  const status = typeof input.status === 'string' ? input.status.trim() : '';
  if (status && !TASK_STATUSES.includes(/** @type {typeof TASK_STATUSES[number]} */ (status))) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid status',
      code: 'BAD_REQUEST',
    };
  }

  const kind = typeof input.kind === 'string' ? input.kind.trim() : '';
  if (kind && !TASK_KINDS.includes(/** @type {typeof TASK_KINDS[number]} */ (kind))) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid kind',
      code: 'BAD_REQUEST',
    };
  }

  let limit = input.limit;
  if (limit !== undefined && limit !== null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TASK_SUMMARIES) {
      return {
        ok: false,
        status: 400,
        error: `limit must be an integer between 1 and ${MAX_TASK_SUMMARIES}`,
        code: 'BAD_REQUEST',
      };
    }
  }

  const workspaceId =
    (typeof input.workspaceId === 'string' ? input.workspaceId : input.workspace_id) ?? undefined;

  const payload = listTasks(input.dataDir, input.vaultId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: scopeQuery.filterScopes,
    effectiveScope: scopeQuery.effectiveScope,
    workspaceId: typeof workspaceId === 'string' ? workspaceId.trim() : undefined,
    status: status || undefined,
    kind: kind || undefined,
    limit,
    starterDir: input.starterDir,
  });

  return { ok: true, payload };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   taskId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   starterDir?: string,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleTaskGetRequest(input) {
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  if (!taskId || !TASK_ID_RE.test(taskId)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid task id',
      code: 'BAD_REQUEST',
    };
  }

  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous task scope',
      code: 'TASK_SCOPE_AMBIGUOUS',
    };
  }

  const stored = getTask(input.dataDir, input.vaultId, taskId, {
    visibleScopes: resolved.visibleScopes,
    starterDir: input.starterDir,
  });

  if (!stored) {
    return {
      ok: false,
      status: 404,
      error: 'unknown_task',
      code: 'unknown_task',
    };
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.task_get/v0',
      vault_id: input.vaultId,
      effective_scope: taskGetEffectiveScope(resolved.visibleScopes),
      task: taskForClient(stored),
    },
  };
}

/**
 * Serialize payload for byte-identical parity (stable key order via JSON.stringify).
 *
 * @param {object} payload
 * @returns {string}
 */
export function serializeTaskPayload(payload) {
  return JSON.stringify(payload);
}
