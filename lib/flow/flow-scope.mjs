/**
 * Flow workspace scope resolution (Phase 7A-10b).
 *
 * Maps verified identity + role + optional data_dir grants to the server-resolved
 * `visibleScopes` set fed into the Flow store. Deny-by-default: absent resolution
 * yields `{ personal }` only.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §4
 */

import fs from 'fs';
import path from 'path';

/** @typedef {'personal'|'project'|'org'} FlowScope */

export const FLOW_SCOPES = /** @type {const} */ (['personal', 'project', 'org']);

const FLOW_SCOPE_FILE = 'hub_flow_workspace_scope.json';

/** @type {Record<FlowScope, number>} */
export const SCOPE_RANK = { personal: 0, project: 1, org: 2 };

/**
 * @param {string} dataDir
 * @returns {Record<string, Record<string, { scopes?: string[], ambiguous?: boolean }>>}
 */
export function readFlowWorkspaceScope(dataDir) {
  if (!dataDir) return {};
  const filePath = path.join(dataDir, FLOW_SCOPE_FILE);
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    return data;
  } catch {
    return {};
  }
}

/**
 * Role-derived baseline visible scopes (deny-by-default).
 *
 * @param {string|undefined|null} role
 * @returns {Set<FlowScope>}
 */
export function visibleScopesForRole(role) {
  const r = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (r === 'admin') return new Set(['personal', 'project', 'org']);
  if (r === 'editor') return new Set(['personal', 'project']);
  return new Set(['personal']);
}

/**
 * Resolve the caller's authorized Flow workspace scopes.
 *
 * @param {{ dataDir?: string, userId?: string, vaultId?: string, role?: string, cliScopes?: FlowScope[] }} ctx
 * @returns {{ visibleScopes: Set<FlowScope>, ambiguous: boolean }}
 */
export function resolveFlowVisibleScopes(ctx) {
  if (Array.isArray(ctx.cliScopes) && ctx.cliScopes.length > 0) {
    const scopes = ctx.cliScopes.filter((s) => FLOW_SCOPES.includes(s));
    if (scopes.length === 0) {
      return { visibleScopes: new Set(['personal']), ambiguous: false };
    }
    return { visibleScopes: new Set(scopes), ambiguous: false };
  }

  const userId = typeof ctx.userId === 'string' ? ctx.userId.trim() : '';
  const vaultId = typeof ctx.vaultId === 'string' ? ctx.vaultId.trim() : 'default';
  const map = readFlowWorkspaceScope(ctx.dataDir ?? '');
  const entry = userId && map[userId]?.[vaultId];

  if (entry?.ambiguous === true) {
    return { visibleScopes: new Set(['personal']), ambiguous: true };
  }

  let visible = visibleScopesForRole(ctx.role);
  if (entry && Array.isArray(entry.scopes) && entry.scopes.length > 0) {
    const granted = entry.scopes.filter((s) => FLOW_SCOPES.includes(s));
    if (granted.length > 0) {
      visible = new Set(granted);
    }
  }

  return { visibleScopes: visible, ambiguous: false };
}

/**
 * Highest authorized scope (for effective_scope when not narrowed).
 *
 * @param {Set<FlowScope>} visibleScopes
 * @returns {FlowScope}
 */
export function highestFlowScope(visibleScopes) {
  let best = /** @type {FlowScope} */ ('personal');
  for (const scope of visibleScopes) {
    if (SCOPE_RANK[scope] > SCOPE_RANK[best]) best = scope;
  }
  return best;
}

/**
 * Resolve **write** authority for a target Flow scope (Phase 7A-L1b).
 *
 * Write authority is a second, stricter gate than read visibility
 * (FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1 §2): the actor must hold the target
 * scope in their server-resolved authorized set. Deny-by-default — the client
 * never supplies its own write tier. `personal` is granted to any authenticated
 * writer whose authorized set includes `personal`; `project` requires the
 * editor-tier grant; `org` requires the admin-tier grant. The authorized set is
 * exactly the role/grant-derived `visibleScopes`, so `visibleScopes.has(target)`
 * encodes the role gate without trusting any client-asserted tier.
 *
 * @param {Set<FlowScope>} visibleScopes - server-resolved authorized scopes.
 * @param {FlowScope} targetScope - the scope the draft/bundle wants to write.
 * @returns {{ ok: true } | { ok: false, status: number, error: string, code: string }}
 */
export function resolveFlowWriteAuthority(visibleScopes, targetScope) {
  if (!FLOW_SCOPES.includes(targetScope)) {
    return { ok: false, status: 400, error: 'Invalid scope', code: 'FLOW_DRAFT_INVALID' };
  }
  if (!(visibleScopes instanceof Set) || !visibleScopes.has(targetScope)) {
    return {
      ok: false,
      status: 403,
      error: 'Flow write scope not authorized',
      code: 'FLOW_SCOPE_DENIED',
    };
  }
  return { ok: true };
}

/**
 * Validate an optional scope query param against authorized scopes.
 *
 * @param {Set<FlowScope>} visibleScopes
 * @param {string|undefined|null} requestedScope
 * @returns {{ ok: true, effectiveScope: FlowScope, filterScopes: Set<FlowScope> } | { ok: false, status: number, error: string, code: string }}
 */
export function resolveFlowScopeQuery(visibleScopes, requestedScope) {
  const trimmed = typeof requestedScope === 'string' ? requestedScope.trim() : '';
  if (trimmed) {
    if (!FLOW_SCOPES.includes(/** @type {FlowScope} */ (trimmed))) {
      return { ok: false, status: 400, error: 'Invalid scope', code: 'BAD_REQUEST' };
    }
    if (!visibleScopes.has(/** @type {FlowScope} */ (trimmed))) {
      return {
        ok: false,
        status: 403,
        error: 'Flow scope not authorized',
        code: 'FLOW_SCOPE_DENIED',
      };
    }
    return {
      ok: true,
      effectiveScope: /** @type {FlowScope} */ (trimmed),
      filterScopes: new Set([/** @type {FlowScope} */ (trimmed)]),
    };
  }

  return {
    ok: true,
    effectiveScope: highestFlowScope(visibleScopes),
    filterScopes: visibleScopes,
  };
}
