/**
 * Phase 6 — ClientEncryptor hook interface (D6.4).
 *
 * Defines the seam for client-side encryption of privacy-max derived artifacts.
 * The actual ZK key hierarchy (Argon2id → IK → DEK-vault/DEK-memory, hybrid
 * X25519+ML-KEM-768 envelope encryption) is NOT implemented here — it is a hard
 * prerequisite owned by the ZK tier's gate (brief §9.4, gate §13.3).
 *
 * This module provides:
 *   1. The interface contract (JSDoc typedef + ENCRYPTOR_SCOPES + reason codes).
 *   2. The default "unavailable" implementation so privacy_max ALWAYS fails closed
 *      until the ZK tier ships.
 *   3. A `createClientEncryptor` factory that wraps any concrete implementation
 *      and enforces the contract surface (no decrypt(), no key material in output).
 *
 * RULES (hard constraints from D6.4):
 *   - No decrypt() is part of this interface — reads/decryption are the ZK tier's concern.
 *   - No plaintext fallback, ever (D6.4.3 / Rule #1).
 *     Unavailable encryptor → fail closed (drop or local-only), never downgrade to plaintext.
 *   - The encryptor lives ONLY in the authority group (D6.4.5).
 *     The runtime/inference group must NEVER import or hold this module.
 *   - Algorithm agility: the `alg` field + `schema_version` (D6.2) record the scheme
 *     so the ZK tier can introduce hybrid wrapping without breaking stored artifacts (D6.4.4).
 */

/**
 * @typedef {Object} EncryptResult
 * @property {Uint8Array} ciphertext     - Encrypted bytes. Never plaintext.
 * @property {string}     wrappedDekRef  - Opaque reference to the wrapped DEK (for crypto-shred, D6.5.3).
 *                                         Never the key material itself.
 * @property {string}     alg            - Encryption algorithm identifier (D6.4.4 algorithm agility).
 */

/**
 * @typedef {Object} ClientEncryptorLike
 * @property {(tier: string, scope: string) => boolean} isAvailable
 *   Returns true ONLY when a user-held key for this vault/memory scope is unlocked
 *   in this process (client-side). Always false at convenience tier and whenever the
 *   ZK hierarchy is absent or locked. Fail-closed default: false.
 *   Must never throw — any error returns false.
 * @property {(plaintextBytes: Uint8Array, opts: { scope: string, aad?: Uint8Array }) => EncryptResult} encrypt
 *   Envelope-encrypt under the user-held DEK for `scope` (vault | memory).
 *   Returns { ciphertext, wrappedDekRef, alg }; NEVER returns key material.
 *   Throws on any key/encryption error — the caller MUST fail closed (D6.4.3).
 *   Never called at convenience tier.
 */

/**
 * Valid scope values for the ClientEncryptor (D6.4.1).
 * 'vault'  → note frontmatter / vector store artifacts (ai_summary, embedding)
 * 'memory' → insight / discovery_facet artifacts (memory partition)
 * @readonly
 */
export const ENCRYPTOR_SCOPES = Object.freeze({
  VAULT: 'vault',
  MEMORY: 'memory',
});

/**
 * Fixed reason codes for ClientEncryptor failures.
 * Callers surface these codes — never the underlying exception message.
 * @readonly
 */
export const ENCRYPTOR_REASONS = Object.freeze({
  /** isAvailable returned false — ZK key hierarchy absent or locked. */
  UNAVAILABLE: 'encryptor_unavailable_no_user_held_key',
  /** encrypt() threw or returned a malformed result. */
  ENCRYPT_FAILED: 'encryptor_encrypt_failed',
  /**
   * Sentinel: a code path attempted a plaintext fallback. This MUST never be reached
   * in production code — its presence signals a logic error.
   */
  PLAINTEXT_FALLBACK_FORBIDDEN: 'encryptor_plaintext_fallback_forbidden',
});

/**
 * The default "unavailable" ClientEncryptor.
 *
 * isAvailable always returns false so privacy_max writes always fail closed
 * until the ZK key hierarchy is implemented. This is the correct default — Phase 6
 * ships with this implementation and the privacy_max path refuses to persist.
 *
 * @type {ClientEncryptorLike}
 */
export const UNAVAILABLE_CLIENT_ENCRYPTOR = Object.freeze({
  /**
   * Always returns false — ZK hierarchy not implemented yet.
   * @param {string} _tier
   * @param {string} _scope
   * @returns {false}
   */
  isAvailable(_tier, _scope) {
    return false;
  },

  /**
   * Always throws — no plaintext fallback, ever (D6.4.3 / Rule #1).
   * @param {Uint8Array} _plaintextBytes
   * @param {{ scope: string, aad?: Uint8Array }} _opts
   * @returns {never}
   */
  encrypt(_plaintextBytes, _opts) {
    throw new Error(ENCRYPTOR_REASONS.UNAVAILABLE);
  },
});

/**
 * Create a validated ClientEncryptor from a concrete implementation.
 *
 * Wraps the implementation to enforce the contract:
 *   - isAvailable must return boolean (exceptions → false, never throw to caller)
 *   - encrypt must return { ciphertext: Uint8Array, wrappedDekRef: string, alg: string }
 *   - No decrypt() is exposed in the returned encryptor
 *
 * @param {{ isAvailable: Function, encrypt: Function }} impl
 * @returns {ClientEncryptorLike}
 * @throws {TypeError} if impl does not provide isAvailable and encrypt.
 */
export function createClientEncryptor(impl) {
  if (
    impl == null ||
    typeof impl.isAvailable !== 'function' ||
    typeof impl.encrypt !== 'function'
  ) {
    throw new TypeError(
      'ClientEncryptor implementation must provide isAvailable(tier, scope) and encrypt(plaintextBytes, opts).',
    );
  }

  return Object.freeze({
    /**
     * Delegates to impl.isAvailable; any exception → false (fail-closed).
     * @param {string} tier
     * @param {string} scope
     * @returns {boolean}
     */
    isAvailable(tier, scope) {
      try {
        return impl.isAvailable(tier, scope) === true;
      } catch {
        return false;
      }
    },

    /**
     * Delegates to impl.encrypt; validates the result shape before returning.
     * Throws with ENCRYPTOR_REASONS.ENCRYPT_FAILED if the result is malformed.
     * @param {Uint8Array} plaintextBytes
     * @param {{ scope: string, aad?: Uint8Array }} opts
     * @returns {EncryptResult}
     */
    encrypt(plaintextBytes, opts) {
      // No plaintext fallback (D6.4.3): if impl throws, we re-throw, caller must fail closed.
      const result = impl.encrypt(plaintextBytes, opts);
      if (
        result == null ||
        !(result.ciphertext instanceof Uint8Array) ||
        typeof result.wrappedDekRef !== 'string' ||
        !result.wrappedDekRef ||
        typeof result.alg !== 'string' ||
        !result.alg
      ) {
        throw new Error(ENCRYPTOR_REASONS.ENCRYPT_FAILED);
      }
      return result;
    },
  });
}
