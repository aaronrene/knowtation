/**
 * Phase 8 P1b-b — compile-time feature flag for offline-locked auth code paths.
 * Double-lock with KNOWTATION_OFFLINE_LOCKED_AUTH env gate (§11).
 * Remains `false` until a separate Tier 3 authorization flips it after tests green.
 */

/** @type {boolean} Shipped inert in P1b-b first commit. */
export const OFFLINE_LOCKED_AUTH_CODE_SHIPPED = false;

/**
 * Whether offline-locked auth is fully active (env gate + compile-time flag).
 * Tests may set KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED=1 to exercise gate-on paths
 * without changing the shipped constant.
 * @param {boolean} envGateEnabled - cached boot-time env gate boolean
 * @returns {boolean}
 */
export function isOfflineLockedAuthActive(envGateEnabled) {
  if (!envGateEnabled) return false;
  if (OFFLINE_LOCKED_AUTH_CODE_SHIPPED) return true;
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_SHIPPED === '1'
  ) {
    return true;
  }
  return false;
}
