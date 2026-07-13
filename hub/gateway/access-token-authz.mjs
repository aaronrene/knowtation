/**
 * Scope-aware REST authorization for Hub access tokens.
 *
 * Web-session JWTs (no `type: mcp_access`) identify the caller by `sub`; role/scopes are
 * derived elsewhere (`roleForSub` → `scopesForRole`). MCP OAuth access tokens carry an
 * explicit `scopes` claim and must not be elevated by role lookup (confused-deputy /
 * scope-elevation guard — docs/DURABLE-AGENT-AUTH-SPEC.md §8).
 */

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
 * Returns null when the token is missing, invalid for identity, or (for mcp_access)
 * insufficient for the method.
 *
 * @param {object|null|undefined} payload - decoded JWT payload (already verified)
 * @param {{ method?: string }} [opts]
 * @returns {string|null}
 */
export function subFromVerifiedPayload(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) return null;
  if (payload.type === 'mcp_access') {
    if (!mcpScopesPermitMethod(payload.scopes, opts.method || 'GET')) return null;
  }
  return sub;
}

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
