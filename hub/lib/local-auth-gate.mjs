/**
 * Phase 8 P1b-b — env gate for offline-locked auth (read once at boot, §2.2).
 */

import { isOfflineLockedAuthActive } from './local-auth-feature-flag.mjs';

/**
 * Read KNOWTATION_OFFLINE_LOCKED_AUTH at boot. Only `enabled` turns the gate on.
 * @returns {boolean}
 */
export function readOfflineLockedAuthEnvGate() {
  const raw = process.env.KNOWTATION_OFFLINE_LOCKED_AUTH;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'enabled';
}

/**
 * Cached boot snapshot: env gate + compile-time shipped flag.
 * @param {boolean} [envGate] - optional pre-read env gate
 * @returns {{ envGateEnabled: boolean, active: boolean }}
 */
export function resolveOfflineLockedAuthPosture(envGate = readOfflineLockedAuthEnvGate()) {
  return {
    envGateEnabled: envGate,
    active: isOfflineLockedAuthActive(envGate),
  };
}
