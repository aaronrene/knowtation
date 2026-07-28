/**
 * Scope-aware REST authorization for Hub access tokens.
 *
 * Web-session JWTs (no `type: mcp_access`) identify the caller by `sub`; role/scopes are
 * derived elsewhere (`roleForSub` → `scopesForRole`). MCP OAuth access tokens carry an
 * explicit `scopes` claim and must not be elevated by role lookup (confused-deputy /
 * scope-elevation guard — docs/DURABLE-AGENT-AUTH-SPEC.md §8).
 *
 * SEC-KN-3 / Pass 2 P6: `resolveHostedActorRole` must cap mcp_access roles by token scopes
 * and must never apply the HUB_ADMIN_USER_IDS allowlist override to agent tokens.
 *
 * Phase C: `type: agent_access` uses the same no-allowlist posture plus propose-path rules
 * (docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md).
 */

import { agentScopesPermitMethod } from '../lib/agent-credential-core.mjs';

/**
 * HTTP methods that never mutate resource state.
 * @param {string} method
 * @returns {boolean}
 */
export function isSafeHttpMethod(method) {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * Whether a verified JWT payload is an MCP / agent access token.
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function isMcpAccessPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.type === 'mcp_access');
}

/**
 * Phase C — scoped REST agent access JWT (`type: agent_access`).
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function isAgentAccessPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.type === 'agent_access');
}

/**
 * SEC-SEAM-1 / S1 — classify a verified (or candidate) access-token payload.
 *
 * @param {object|null|undefined} payload
 * @returns {'session'|'mcp_access'|'agent_access'|'legacy_session'|'unknown'}
 */
export function resolveActorTokenClass(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  if (isMcpAccessPayload(payload)) return 'mcp_access';
  if (isAgentAccessPayload(payload)) return 'agent_access';
  if (payload.type === 'session') return 'session';
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (sub && payload.type == null) return 'legacy_session';
  return 'unknown';
}

/**
 * SEC-SEAM-1 / S1.3 — true only for mint-stamped learner sessions (`type: 'session'`).
 * `null` / non-object / legacy / mcp_access / unknown → false (V11).
 *
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function isSessionBoundActor(payload) {
  return resolveActorTokenClass(payload) === 'session';
}

/**
 * Map MCP access-token scopes to a Hub role. Never consults sub / admin allowlist.
 * Only explicit admin scopes elevate; vault:write alone stays member.
 *
 * @param {unknown} scopes
 * @returns {'admin'|'member'}
 */
export function roleFromMcpAccessScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes.map((s) => String(s)) : [];
  if (list.includes('admin') || list.includes('vault:admin')) return 'admin';
  return 'member';
}

/**
 * Resolve hosted proposal RBAC role from a verified access-token payload.
 *
 * - mcp_access: role is capped by `scopes` only (never roleForSub / allowlist).
 * - web session: `payload.role` or `roleForSub(sub)`.
 *
 * @param {object|null|undefined} payload
 * @param {(sub: string|null|undefined) => string} roleForSub
 * @returns {{ role: string, isMcpAccess: boolean }}
 */
export function roleFromVerifiedAccessPayload(payload, roleForSub) {
  if (!payload || typeof payload !== 'object') {
    return { role: 'member', isMcpAccess: false, isAgentAccess: false };
  }
  if (isMcpAccessPayload(payload)) {
    return { role: roleFromMcpAccessScopes(payload.scopes), isMcpAccess: true, isAgentAccess: false };
  }
  if (isAgentAccessPayload(payload)) {
    return { role: roleFromMcpAccessScopes(payload.scopes), isMcpAccess: false, isAgentAccess: true };
  }
  const fromClaim = typeof payload.role === 'string' && payload.role.trim() ? payload.role.trim() : '';
  const fromSub =
    typeof roleForSub === 'function' ? String(roleForSub(payload.sub) || '').trim() : '';
  return { role: fromClaim || fromSub || 'member', isMcpAccess: false, isAgentAccess: false };
}

/**
 * Whether HUB_ADMIN_USER_IDS may elevate this actor to admin.
 * Forbidden for mcp_access and agent_access (Pass 2 P6 / SEC-KN-3 / Phase C).
 *
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function mayApplyAdminAllowlistOverride(payload) {
  return !isMcpAccessPayload(payload) && !isAgentAccessPayload(payload);
}

/**
 * Pre-fix allowlist inheritance (Pass 2 P6) — used only by security-tier regression tests.
 * Elevates any actor whose sub is on the admin allowlist, including mcp_access.
 *
 * @param {string} role
 * @param {string|null|undefined} actorSub
 * @param {(sub: string|null|undefined) => string} roleForSub
 * @returns {string}
 */
export function applyAdminAllowlistOverrideLegacy(role, actorSub, roleForSub) {
  let next = role;
  if (actorSub && next !== 'admin' && roleForSub(actorSub) === 'admin') {
    next = 'admin';
  }
  return next;
}

/**
 * Whether an MCP access-token scope list permits the HTTP method on REST.
 * @param {string[]} scopes
 * @param {string} method
 * @returns {boolean}
 */
export function mcpScopesPermitMethod(scopes, method) {
  const list = Array.isArray(scopes) ? scopes : [];
  const hasWrite =
    list.includes('vault:write') || list.includes('vault:admin') || list.includes('admin');
  const hasRead =
    hasWrite || list.includes('vault:read');
  if (isSafeHttpMethod(method)) return hasRead;
  return hasWrite;
}

/**
 * Resolve `sub` from a verified access-token payload for a REST request method.
 * Returns null when the token is missing, invalid for identity, or (for mcp_access /
 * agent_access) insufficient for the method/path.
 *
 * @param {object|null|undefined} payload - decoded JWT payload (already verified)
 * @param {{ method?: string, path?: string }} [opts]
 * @returns {string|null}
 */
export function subFromVerifiedPayload(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) return null;
  if (payload.type === 'mcp_access') {
    if (!mcpScopesPermitMethod(payload.scopes, opts.method || 'GET')) return null;
    return sub;
  }
  if (payload.type === 'agent_access') {
    if (payload.aud !== 'knowtation-hub-rest') return null;
    if (payload.typ !== 'kt_agent_access') return null;
    if (!agentScopesPermitMethod(payload.scopes, opts.method || 'GET', opts.path || '')) {
      return null;
    }
  }
  return sub;
}

/**
 * Vault binding for agent_access (freeze §7.4).
 * @param {object|null|undefined} payload
 * @param {string} vaultId
 * @returns {boolean}
 */
export function assertAgentVaultAllowed(payload, vaultId) {
  if (!isAgentAccessPayload(payload)) return true;
  const ids = Array.isArray(payload.vault_ids) ? payload.vault_ids.map(String) : [];
  const vid = String(vaultId || 'default').trim() || 'default';
  return ids.includes(vid);
}

export { agentScopesPermitMethod };

/**
 * Whether durable MCP / native OAuth agent-auth endpoints may mount.
 * Offline-locked posture and Netlify serverless both leave them unmounted
 * (docs/DURABLE-AGENT-AUTH-SPEC.md §14).
 *
 * @param {{ sessionSecret?: string|null, netlify?: boolean, offlineLockedActive?: boolean }} opts
 * @returns {boolean}
 */
export function shouldMountDurableAgentAuth(opts = {}) {
  return Boolean(opts.sessionSecret) && !opts.netlify && !opts.offlineLockedActive;
}
