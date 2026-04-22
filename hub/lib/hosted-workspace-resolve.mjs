/**
 * Hosted Hub: resolve which canister partition (X-User-Id) a JWT actor uses.
 * Shared by bridge (hosted-context, index/search/sync); workspace semantics in docs/MULTI-VAULT-AND-SCOPED-ACCESS.md.
 */

/** Roles that participate in workspace delegation (read owner's canister partition). Must match bridge VALID_ROLES. */
export const HOSTED_VALID_ROLES = new Set(['admin', 'editor', 'viewer', 'evaluator']);

/**
 * @param {object} p
 * @param {string} p.actorSub - JWT sub (e.g. google:123)
 * @param {string|null|undefined} p.workspaceOwnerId - bridge hub_workspace.owner_user_id
 * @param {Record<string, string>} p.storedRoles - hub_roles map
 * @param {Set<string>} p.adminUserIdsSet - HUB_ADMIN_USER_IDS
 * @returns {{ effective: string, delegate: boolean }}
 */
export function resolveEffectiveCanisterUser({ actorSub, workspaceOwnerId, storedRoles, adminUserIdsSet }) {
  if (!actorSub) return { effective: '', delegate: false };
  const owner =
    workspaceOwnerId && String(workspaceOwnerId).trim() ? String(workspaceOwnerId).trim() : null;
  if (!owner) return { effective: actorSub, delegate: false };
  if (actorSub === owner) return { effective: actorSub, delegate: false };
  const stored = storedRoles && storedRoles[actorSub];
  const inTeamRoles = Boolean(stored && HOSTED_VALID_ROLES.has(stored));
  const envAdmin = Boolean(adminUserIdsSet && adminUserIdsSet.has(actorSub));
  if (inTeamRoles || envAdmin) return { effective: owner, delegate: true };
  return { effective: actorSub, delegate: false };
}

/**
 * Same semantics as hub/hub_vault_access.mjs getAllowedVaultIds.
 * @param {Record<string, string[]>} accessMap
 * @param {string} userId
 * @returns {string[]}
 */
export function getAllowedVaultIdsFromAccessMap(accessMap, userId) {
  const access = accessMap && typeof accessMap === 'object' ? accessMap : {};
  const allowed = access[userId];
  return allowed && Array.isArray(allowed) && allowed.length > 0 ? [...allowed] : ['default'];
}

/**
 * Same semantics as hub/hub_scope.mjs getScopeForUserVault (object in memory, not file).
 * @param {Record<string, Record<string, { projects?: string[], folders?: string[] }>>} scopeMap
 * @param {string} userId
 * @param {string} vaultId
 * @returns {{ projects: string[], folders: string[] } | null}
 */
export function getScopeForUserVaultFromScopeMap(scopeMap, userId, vaultId) {
  const vid = vaultId && String(vaultId).trim() ? String(vaultId).trim() : 'default';
  const scope = scopeMap && typeof scopeMap === 'object' ? scopeMap : {};
  const userScope = scope[userId];
  if (!userScope || typeof userScope[vid] !== 'object') return null;
  const r = userScope[vid];
  const projects = Array.isArray(r.projects) ? r.projects : [];
  const folders = Array.isArray(r.folders) ? r.folders : [];
  if (projects.length === 0 && folders.length === 0) return null;
  return { projects, folders };
}

/**
 * Intersect canister vault ids with allowlist; preserve canister order.
 * @param {string[]} canisterIds
 * @param {string[]} allowedRaw
 * @returns {string[]}
 */
export function intersectVaultIds(canisterIds, allowedRaw) {
  const allow = new Set(allowedRaw && allowedRaw.length ? allowedRaw : ['default']);
  const list = Array.isArray(canisterIds) && canisterIds.length ? canisterIds : ['default'];
  return list.filter((id) => allow.has(id));
}

/**
 * Vault-access map restricts **delegating** team members. Users acting on their **own** canister
 * partition (owner or solo, not delegating) get every vault returned by the canister unless they
 * have an explicit access row (then that row applies).
 *
 * @param {{ delegate: boolean, actorUid: string, accessMap: Record<string, string[]>, canisterIds: string[] }} p
 * @returns {string[]}
 */
export function resolveAllowedVaultIdsForHostedContext({ delegate, actorUid, accessMap, canisterIds }) {
  const access = accessMap && typeof accessMap === 'object' ? accessMap : {};
  const explicit = access[actorUid];
  const explicitList =
    explicit && Array.isArray(explicit) && explicit.length > 0
      ? explicit.map((x) => String(x))
      : null;
  const ids = Array.isArray(canisterIds) && canisterIds.length ? canisterIds.map(String) : ['default'];
  const allowedRaw = delegate ? explicitList ?? ['default'] : explicitList ?? ids;
  return intersectVaultIds(ids, allowedRaw);
}
