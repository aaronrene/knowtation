/**
 * Shared Task Loop list/get handlers — CLI = MCP = Hub REST parity (Phase 2G-c-b).
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §4
 */

import {
  listTaskLoops,
  getTaskLoop,
  getOrchestratorGraph,
  taskLoopForClient,
  orchestratorGraphForClient,
  taskLoopGetEffectiveScope,
  LOOP_ID_RE,
  GRAPH_ID_RE,
  MAX_TASK_LOOP_SUMMARIES,
  LOOP_STATUSES,
} from './task-loop-store.mjs';
import { TASK_KINDS } from './task-store.mjs';
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
 *   graphsDir?: string,
 *   instancesDir?: string,
 * }} input
 */
export function handleTaskLoopListRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous task loop scope',
      code: 'TASK_LOOP_SCOPE_AMBIGUOUS',
    };
  }

  const scopeQuery = resolveFlowScopeQuery(resolved.visibleScopes, input.scope);
  if (!scopeQuery.ok) {
    const code =
      scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'TASK_LOOP_SCOPE_DENIED' : scopeQuery.code;
    const error =
      scopeQuery.code === 'FLOW_SCOPE_DENIED'
        ? 'Task loop scope not authorized'
        : scopeQuery.error;
    return { ok: false, status: scopeQuery.status, error, code };
  }

  const status = typeof input.status === 'string' ? input.status.trim() : '';
  if (status && !LOOP_STATUSES.includes(/** @type {typeof LOOP_STATUSES[number]} */ (status))) {
    return { ok: false, status: 400, error: 'Invalid status', code: 'BAD_REQUEST' };
  }

  const kind = typeof input.kind === 'string' ? input.kind.trim() : '';
  if (kind && !TASK_KINDS.includes(/** @type {typeof TASK_KINDS[number]} */ (kind))) {
    return { ok: false, status: 400, error: 'Invalid kind', code: 'BAD_REQUEST' };
  }

  let limit = typeof input.limit === 'number' ? input.limit : MAX_TASK_LOOP_SUMMARIES;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_TASK_LOOP_SUMMARIES;

  const workspaceId =
    typeof input.workspaceId === 'string'
      ? input.workspaceId
      : typeof input.workspace_id === 'string'
        ? input.workspace_id
        : undefined;

  const payload = listTaskLoops(input.dataDir, input.vaultId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: scopeQuery.filterScopes,
    effectiveScope: taskLoopGetEffectiveScope(resolved.visibleScopes),
    workspaceId,
    status: status || undefined,
    kind: kind || undefined,
    limit,
    starterDir: input.starterDir,
    graphsDir: input.graphsDir,
    instancesDir: input.instancesDir,
  });

  return { ok: true, payload };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   loopId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   starterDir?: string,
 *   graphsDir?: string,
 *   instancesDir?: string,
 * }} input
 */
export function handleTaskLoopGetRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous task loop scope',
      code: 'TASK_LOOP_SCOPE_AMBIGUOUS',
    };
  }

  const loopId = typeof input.loopId === 'string' ? input.loopId.trim() : '';
  if (!LOOP_ID_RE.test(loopId)) {
    return { ok: false, status: 400, error: 'Invalid loop id', code: 'BAD_REQUEST' };
  }

  const row = getTaskLoop(input.dataDir, input.vaultId, loopId, {
    visibleScopes: resolved.visibleScopes,
    starterDir: input.starterDir,
    graphsDir: input.graphsDir,
    instancesDir: input.instancesDir,
  });

  if (!row) {
    return { ok: false, status: 404, error: 'unknown_task_loop', code: 'unknown_task_loop' };
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.task_loop_get/v0',
      vault_id: input.vaultId,
      effective_scope: taskLoopGetEffectiveScope(resolved.visibleScopes),
      loop: taskLoopForClient(row),
    },
  };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   graphId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   starterDir?: string,
 *   graphsDir?: string,
 *   instancesDir?: string,
 * }} input
 */
export function handleOrchestratorGraphGetRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous orchestrator graph scope',
      code: 'ORCHESTRATOR_GRAPH_SCOPE_AMBIGUOUS',
    };
  }

  const graphId = typeof input.graphId === 'string' ? input.graphId.trim() : '';
  if (!GRAPH_ID_RE.test(graphId)) {
    return { ok: false, status: 400, error: 'Invalid graph id', code: 'BAD_REQUEST' };
  }

  const row = getOrchestratorGraph(input.dataDir, input.vaultId, graphId, {
    visibleScopes: resolved.visibleScopes,
    starterDir: input.starterDir,
    graphsDir: input.graphsDir,
    instancesDir: input.instancesDir,
  });

  if (!row) {
    return {
      ok: false,
      status: 404,
      error: 'unknown_orchestrator_graph',
      code: 'unknown_orchestrator_graph',
    };
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.orchestrator_graph_get/v0',
      vault_id: input.vaultId,
      effective_scope: taskLoopGetEffectiveScope(resolved.visibleScopes),
      graph: orchestratorGraphForClient(row),
    },
  };
}
