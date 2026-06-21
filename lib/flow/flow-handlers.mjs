/**
 * Shared Flow list/get handlers — CLI = MCP = Hub REST parity (Phase 7A-10b).
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §7
 */

import { listFlows, getFlow, FLOW_ID_RE, SEMVER_RE, MAX_FLOW_SUMMARIES } from './flow-store.mjs';
import { resolveFlowScopeQuery, resolveFlowVisibleScopes } from './flow-scope.mjs';
import {
  HARNESS_VALUES,
  isHarnessActive,
  projectFlow,
  renderedContentHash,
  isProjectionStale,
  flowProjectionForClient,
  PROJECTION_GENERATOR_VERSION,
} from './projection-generator.mjs';
import {
  isAgentBundleHarnessActive,
  computeBundleAllowedTools,
  collectFlowExternalToolRefs,
  readVaultExternalAgentPolicy,
} from './external-agent.mjs';

/**
 * @typedef {import('./flow-scope.mjs').FlowScope} FlowScope
 */

/**
 * @param {{ dataDir: string, vaultId: string, userId?: string, role?: string, cliScopes?: FlowScope[], ambiguous?: boolean }} ctx
 * @returns {{ visibleScopes: Set<FlowScope>, ambiguous: boolean }}
 */
export function resolveHandlerVisibleScopes(ctx) {
  if (ctx.ambiguous === true) {
    return { visibleScopes: new Set(['personal']), ambiguous: true };
  }
  if (ctx.visibleScopes instanceof Set) {
    return { visibleScopes: ctx.visibleScopes, ambiguous: false };
  }
  return resolveFlowVisibleScopes({
    dataDir: ctx.dataDir,
    userId: ctx.userId,
    vaultId: ctx.vaultId,
    role: ctx.role,
    cliScopes: ctx.cliScopes,
  });
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
 *   tag?: string,
 *   limit?: number,
 *   starterDir?: string,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowListRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous flow scope',
      code: 'FLOW_SCOPE_AMBIGUOUS',
    };
  }

  const scopeQuery = resolveFlowScopeQuery(resolved.visibleScopes, input.scope);
  if (!scopeQuery.ok) {
    return scopeQuery;
  }

  let limit = input.limit;
  if (limit !== undefined && limit !== null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FLOW_SUMMARIES) {
      return {
        ok: false,
        status: 400,
        error: `limit must be an integer between 1 and ${MAX_FLOW_SUMMARIES}`,
        code: 'BAD_REQUEST',
      };
    }
  }

  const payload = listFlows(input.dataDir, input.vaultId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: scopeQuery.filterScopes,
    effectiveScope: scopeQuery.effectiveScope,
    tag: input.tag,
    limit,
    starterDir: input.starterDir,
  });

  return { ok: true, payload };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   flowId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   scope?: string,
 *   version?: string,
 *   starterDir?: string,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowGetRequest(input) {
  const flowId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
  if (!flowId || !FLOW_ID_RE.test(flowId)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid flow id',
      code: 'BAD_REQUEST',
    };
  }

  const version = typeof input.version === 'string' ? input.version.trim() : '';
  if (version && !SEMVER_RE.test(version)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid version',
      code: 'BAD_REQUEST',
    };
  }

  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous flow scope',
      code: 'FLOW_SCOPE_AMBIGUOUS',
    };
  }

  const payload = getFlow(input.dataDir, input.vaultId, flowId, {
    filterScopes: resolved.visibleScopes,
    version: version || undefined,
    starterDir: input.starterDir,
  });

  if (!payload) {
    return {
      ok: false,
      status: 404,
      error: 'unknown_flow',
      code: 'unknown_flow',
    };
  }

  return { ok: true, payload };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   flowId: string,
 *   harness: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   version?: string,
 *   starterDir?: string,
 *   generatedAt?: string,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowProjectRequest(input) {
  const flowId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
  if (!flowId || !FLOW_ID_RE.test(flowId)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid flow id',
      code: 'BAD_REQUEST',
    };
  }

  const harness = typeof input.harness === 'string' ? input.harness.trim() : '';
  if (!harness) {
    return {
      ok: false,
      status: 400,
      error: 'Missing harness',
      code: 'BAD_REQUEST',
    };
  }
  if (!HARNESS_VALUES.includes(/** @type {typeof HARNESS_VALUES[number]} */ (harness))) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid harness',
      code: 'BAD_REQUEST',
    };
  }
  const agentBundleEnabled = isAgentBundleHarnessActive(input.dataDir);
  if (!isHarnessActive(harness, { agentBundleEnabled })) {
    return {
      ok: false,
      status: 400,
      error: 'Harness not supported in v0',
      code: 'FLOW_HARNESS_UNSUPPORTED',
    };
  }

  const version = typeof input.version === 'string' ? input.version.trim() : '';
  if (version && !SEMVER_RE.test(version)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid version',
      code: 'BAD_REQUEST',
    };
  }

  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous flow scope',
      code: 'FLOW_SCOPE_AMBIGUOUS',
    };
  }

  const pinnedPayload = getFlow(input.dataDir, input.vaultId, flowId, {
    filterScopes: resolved.visibleScopes,
    version: version || undefined,
    starterDir: input.starterDir,
  });

  if (!pinnedPayload) {
    return {
      ok: false,
      status: 404,
      error: 'unknown_flow',
      code: 'unknown_flow',
    };
  }

  const latestPayload = getFlow(input.dataDir, input.vaultId, flowId, {
    filterScopes: resolved.visibleScopes,
    starterDir: input.starterDir,
  });

  const latestVersion = latestPayload?.flow?.version ?? pinnedPayload.flow.version;

  let allowedTools = [];
  if (harness === 'agent_bundle') {
    const vaultPolicy = readVaultExternalAgentPolicy(input.dataDir);
    const flowToolRefs = collectFlowExternalToolRefs(pinnedPayload.steps);
    allowedTools = computeBundleAllowedTools(flowToolRefs, vaultPolicy.allowedTools);
  }

  const projection = projectFlow(pinnedPayload.flow, pinnedPayload.steps, {
    harness: /** @type {import('./projection-generator.mjs').Harness} */ (harness),
    allowedTools,
  });

  const generatedAt =
    typeof input.generatedAt === 'string' && input.generatedAt.trim()
      ? input.generatedAt.trim()
      : new Date().toISOString();

  const payload = {
    schema: 'knowtation.flow_project/v0',
    vault_id: input.vaultId,
    projection: flowProjectionForClient(projection),
    staleness: {
      stale: isProjectionStale(projection.flow_version, latestVersion),
      projection_version: projection.flow_version,
      latest_version: latestVersion,
    },
    generator: {
      generator_version: PROJECTION_GENERATOR_VERSION,
      content_hash: renderedContentHash(projection.rendered),
      generated_at: generatedAt,
    },
  };

  return { ok: true, payload };
}

/**
 * Serialize payload for byte-identical parity (stable key order via JSON.stringify).
 *
 * @param {object} payload
 * @returns {string}
 */
export function serializeFlowPayload(payload) {
  return JSON.stringify(payload);
}

/**
 * Strip envelope-only generated_at for cross-surface deep equality.
 *
 * @param {object} payload
 * @returns {object}
 */
export function stripFlowProjectGeneratedAt(payload) {
  const copy = structuredClone(payload);
  if (copy?.generator && typeof copy.generator === 'object') {
    delete copy.generator.generated_at;
  }
  return copy;
}
