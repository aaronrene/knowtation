/**
 * Phase 6 — per-tier, per-artifact storage routing (D6.1).
 *
 * Maps (artifact_type × privacy_tier) to exactly one of three terminal states:
 *   'host_readable'    — convenience tier only (server-held-key is this class, not ZK)
 *   'client_encrypted' — privacy_max: requires ClientEncryptor with user-held key
 *   'local_only'       — either tier, when above options are unavailable
 *
 * ROUTING RULES (D6.1, binding):
 *   - Server-held-key AES-256-GCM is classified as 'host_readable' for policy purposes
 *     (the operator can decrypt). It DOES NOT satisfy privacy_max (D6.1.2).
 *   - Unknown/unresolvable tier → treat as most-restrictive (privacy_max) → fail closed.
 *   - Until the two-tier vault registry exists, ONLY 'convenience' is resolvable;
 *     any 'privacy_max' write fails closed (D6.1.1).
 *   - No caller picks a storage location directly — routing is centralized here (D6.1.3).
 *
 * DESIGN INVARIANTS:
 *   - Pure function — no I/O, no network.
 *   - Fail-closed on every ambiguous or unknown input.
 */

import { ARTIFACT_TYPES, PRIVACY_TIERS } from './companion-provenance-validator.mjs';

/**
 * The three legal terminal storage states (D6.1.2).
 * There is no fourth state.
 * @readonly
 */
export const TERMINAL_STATES = Object.freeze({
  /** Convenience only. Artifact stored plaintext or with a server-held key. Host can read it. */
  HOST_READABLE: 'host_readable',
  /** privacy_max. Artifact stored only as ciphertext under a user-held key. Host cannot read it. */
  CLIENT_ENCRYPTED: 'client_encrypted',
  /**
   * Either tier. Artifact kept only on the local device.
   * Used when client encryption is unavailable for privacy_max (fail-closed path).
   */
  LOCAL_ONLY: 'local_only',
});

/**
 * Fixed reason codes for tier resolution failures.
 * @readonly
 */
export const TIER_RESOLVE_REASONS = Object.freeze({
  /** Artifact type is not in the known set. */
  INVALID_ARTIFACT_TYPE: 'tier_resolve_invalid_artifact_type',
  /** Privacy tier value is unknown — treated as most-restrictive, then fails closed. */
  UNKNOWN_TIER: 'tier_resolve_unknown_tier',
  /**
   * privacy_max requested but the two-tier vault registry does not exist yet (D6.1.1).
   * Phase 6 fails closed rather than inventing a tier source.
   */
  PRIVACY_MAX_NO_REGISTRY: 'tier_resolve_privacy_max_no_registry',
});

/**
 * Resolve the terminal storage state for a derived artifact.
 *
 * D6.1.1 — tier is resolved from the OWNER's vault tier (passed as `privacyTier`).
 * Until `vaultRegistryAvailable` is true, only 'convenience' resolves; any
 * 'privacy_max' artifact fails closed.
 *
 * D6.1.2 — exactly three terminal states. Server-held-key = host_readable (same policy class).
 *
 * D6.1.3 — routing is centralized; callers supply artifact + tier, not a location.
 *
 * @param {string} artifactType  - One of ARTIFACT_TYPES.
 * @param {string} privacyTier   - 'convenience' | 'privacy_max' (the OWNER's vault tier).
 * @param {{ vaultRegistryAvailable?: boolean }} [opts]
 * @returns {{ ok: true; terminalState: string } | { ok: false; reason: string }}
 */
export function resolveTier(artifactType, privacyTier, opts = {}) {
  // Validate artifact type — unknown type is a hard reject
  if (!ARTIFACT_TYPES.includes(/** @type {any} */ (artifactType))) {
    return { ok: false, reason: TIER_RESOLVE_REASONS.INVALID_ARTIFACT_TYPE };
  }

  // Unknown/unresolvable tier → most-restrictive (privacy_max) → fail closed (D6.1 §fail-closed)
  if (!PRIVACY_TIERS.includes(/** @type {any} */ (privacyTier))) {
    return { ok: false, reason: TIER_RESOLVE_REASONS.UNKNOWN_TIER };
  }

  if (privacyTier === 'privacy_max') {
    // Until the two-tier vault registry lands, privacy_max always fails closed (D6.1.1)
    if (!opts.vaultRegistryAvailable) {
      return { ok: false, reason: TIER_RESOLVE_REASONS.PRIVACY_MAX_NO_REGISTRY };
    }
    // Registry present: privacy_max → client_encrypted (requires ClientEncryptor at write time)
    return { ok: true, terminalState: TERMINAL_STATES.CLIENT_ENCRYPTED };
  }

  // convenience → host_readable (including server-held-key at-rest path — same policy class)
  return { ok: true, terminalState: TERMINAL_STATES.HOST_READABLE };
}
