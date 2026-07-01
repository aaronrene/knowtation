/**
 * Phase 8 P1b-b — role resolution for offline-locked auth (§5.2, §5.3).
 */

import { loadRoleMap, getRole } from '../roles.mjs';

const VALID_ROLES = new Set(['admin', 'editor', 'viewer', 'evaluator']);

/**
 * Resolve role for a local or OAuth sub.
 * When offlineLockedActive and role store is empty → denied (member), not default-admin.
 * @param {string} dataDir
 * @param {string} sub
 * @param {{ offlineLockedActive?: boolean, adminUserIdsSet?: Set<string> }} [opts]
 * @returns {string}
 */
export function resolveLocalAuthRole(dataDir, sub, opts = {}) {
  const { offlineLockedActive = false, adminUserIdsSet = new Set() } = opts;
  const roleMap = loadRoleMap(dataDir);
  if (roleMap.size === 0) {
    if (offlineLockedActive) return 'member';
    return 'admin';
  }
  const stored = getRole(roleMap, sub);
  if (stored && stored !== 'member' && VALID_ROLES.has(stored)) return stored;
  if (adminUserIdsSet.has(sub)) return 'admin';
  return stored === 'member' || !stored ? 'member' : stored;
}

/**
 * Whether the credential store has at least one admin role entry.
 * @param {string} dataDir
 * @returns {boolean}
 */
export function hasBootstrappedAdmin(dataDir, credentialStore) {
  const roleMap = loadRoleMap(dataDir);
  for (const role of roleMap.values()) {
    if (role === 'admin') return true;
  }
  if (credentialStore && credentialStore.credentials) {
    for (const cred of Object.values(credentialStore.credentials)) {
      const sub = `local:${cred.userId}`;
      if (roleMap.get(sub) === 'admin') return true;
    }
  }
  return false;
}

/**
 * Self-hosted effectiveRole helper when offline-locked is active.
 * @param {import('../roles.mjs').loadRoleMap extends Function ? ReturnType<typeof loadRoleMap> : never} roleMap
 * @param {string} sub
 * @param {boolean} offlineLockedActive
 * @returns {string}
 */
export function effectiveRoleForHub(roleMap, sub, offlineLockedActive) {
  if (roleMap.size === 0) {
    return offlineLockedActive ? 'member' : 'admin';
  }
  const gr = getRole(roleMap, sub);
  return gr === 'member' || !gr ? 'editor' : gr;
}
