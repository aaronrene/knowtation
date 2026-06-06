/**
 * Phase 6 — DerivedArtifactWriter: single write + delete path (D6.6).
 *
 * This is the ONLY module that may persist or delete a derived artifact in any store:
 *   - Note frontmatter (ai_summary + provenance sidecar) via writeNoteFn
 *   - Vector store (embeddings) via vectorStore.upsert / deleteByPath
 *   - Memory insight events via MemoryManager.store('insight', ...)
 *
 * AUTHORITY GROUP ONLY (D6.4.5, D6.6.3):
 *   This module MUST NEVER be imported by:
 *     - lib/companion-runtime-manager.mjs (runtime group)
 *     - lib/companion-spawn-adapter.mjs / companion-download-adapter.mjs (runtime adapters)
 *     - Any other module in the runtime/inference group
 *   An architecture test in the security test tier enforces this.
 *
 * WRITE PIPELINE (D6.6.1 — all steps must succeed, or no write occurs):
 *   1. Provenance validation         (D6.2 — validateProvenance)
 *   2. Tier resolution               (D6.1 — resolveTier)
 *   3. Consent gate                  (D6.3 — enforceConsentPolicy, Phase 1 reuse)
 *   4. Encryption routing            (D6.4 — ClientEncryptor.isAvailable + encrypt)
 *   5. Terminal-state store          (D6.1.2 — dispatch to the correct physical store)
 *
 * DELETE PIPELINE (D6.5.4):
 *   Single call removes from ALL stores for a note/scope. Partial removal is surfaced
 *   as an error, not silently treated as complete.
 *
 * RE-ENRICHMENT (D6.7):
 *   checkReEnrichmentEligibility is advisory only — never forces recompute,
 *   never routes to the proposal pipeline (D6.7.4).
 */

import { validateProvenance } from './companion-provenance-validator.mjs';
import { resolveTier, TERMINAL_STATES } from './companion-tier-resolver.mjs';
import { enforceConsentPolicy } from './model-runtime-lane.mjs';
import {
  ENCRYPTOR_REASONS,
  ENCRYPTOR_SCOPES,
  UNAVAILABLE_CLIENT_ENCRYPTOR,
} from './companion-client-encryptor.mjs';

/**
 * Fixed reason codes for writer failures.
 * Only these codes are logged/surfaced — never the raw exception message or any secrets.
 * @readonly
 */
export const WRITER_REASONS = Object.freeze({
  /** Provenance record failed D6.2 validation. */
  PROVENANCE_INVALID: 'writer_provenance_invalid',
  /** Tier resolution failed — unknown tier or privacy_max without registry. */
  TIER_UNRESOLVABLE: 'writer_tier_unresolvable',
  /** enforceConsentPolicy returned lane_policy_denied or cloud_consent_required. */
  CONSENT_DENIED: 'writer_consent_denied',
  /** privacy_max + ClientEncryptor.isAvailable === false → fail closed (D6.4.3). */
  ENCRYPTION_UNAVAILABLE: 'writer_encryption_unavailable',
  /** ClientEncryptor.encrypt threw or returned a malformed result. */
  ENCRYPTION_FAILED: 'writer_encryption_failed',
  /** Physical store operation failed. */
  STORE_FAILED: 'writer_store_failed',
  /** All delete stores failed. */
  DELETE_FAILED: 'writer_delete_failed',
  /** Some delete stores succeeded, some failed — partial removal. */
  DELETE_PARTIAL: 'writer_delete_partial',
  /**
   * Cross-partition (delegated) write requested before the tenancy gate exists (D6.3.6).
   * Only self-partition writes are enabled until the tenancy identity lands.
   */
  SELF_PARTITION_ONLY: 'writer_self_partition_only',
});

/**
 * @typedef {{
 *   writeNoteFn: (vaultPath: string, notePath: string, opts: object) => void,
 *   vaultPath: string,
 *   vectorStore?: ({ upsert: (points: object[]) => Promise<void>, deleteByPath?: (notePath: string) => Promise<void> }) | null,
 *   mm?: import('./memory.mjs').MemoryManager | null,
 *   encryptor?: import('./companion-client-encryptor.mjs').ClientEncryptorLike,
 *   vaultRegistryAvailable?: boolean,
 * }} WriterDeps
 */

/**
 * @typedef {{
 *   write: (artifact: object, provenance: object, context: WriteContext) => Promise<WriteResult>,
 *   deleteArtifacts: (target: DeleteTarget) => Promise<DeleteResult>,
 *   checkReEnrichmentEligibility: (storedProvenance: object, currentVersions: object) => EligibilityResult,
 * }} DerivedArtifactWriter
 */

/**
 * @typedef {{
 *   lane: string,
 *   containsPrivateData: boolean,
 *   consentId?: string,
 *   isDelegate?: boolean,
 *   delegatedManagedAllowed?: boolean,
 *   enrichesDelegatedPartition?: boolean,
 *   delegatedEnrichmentAllowed?: boolean,
 * }} WriteContext
 */

/**
 * @typedef {{ ok: true; terminalState: string } | { ok: false; reason: string; detail?: string }} WriteResult
 */

/**
 * @typedef {{ notePath?: string; scope?: string }} DeleteTarget
 */

/**
 * @typedef {{ ok: true; stores: string[] } | { ok: false; reason: string; failed: string[] }} DeleteResult
 */

/**
 * @typedef {{ eligible: boolean; reason: string }} EligibilityResult
 */

/**
 * Create a DerivedArtifactWriter capability.
 *
 * Must be held ONLY by the authority group. Pass it explicitly to callers that
 * need to persist derived artifacts (enrichIndexedNotes, runDiscoverPass) — never
 * import it from within the runtime/inference group.
 *
 * @param {WriterDeps} deps
 * @returns {DerivedArtifactWriter}
 */
export function createDerivedArtifactWriter(deps) {
  const {
    writeNoteFn,
    vaultPath,
    vectorStore = null,
    mm = null,
    encryptor = UNAVAILABLE_CLIENT_ENCRYPTOR,
    vaultRegistryAvailable = false,
  } = deps;

  if (typeof writeNoteFn !== 'function') {
    throw new TypeError('DerivedArtifactWriter: writeNoteFn must be a function.');
  }
  if (typeof vaultPath !== 'string' || !vaultPath.trim()) {
    throw new TypeError('DerivedArtifactWriter: vaultPath must be a non-empty string.');
  }

  /**
   * Execute the 5-step write pipeline (D6.6.1).
   *
   * @param {object} artifact   - The derived artifact payload (e.g. { summary: '...' }).
   * @param {object} provenance - The canonical provenance record per D6.2.1.
   * @param {WriteContext} context - Consent/authorization context.
   * @returns {Promise<WriteResult>}
   */
  async function write(artifact, provenance, context) {
    // D6.3.6 — Cross-partition writes disabled until tenancy gate exists.
    // enrichesDelegatedPartition=true means actor ≠ partition owner (D6.3.2).
    if (context.enrichesDelegatedPartition === true) {
      return { ok: false, reason: WRITER_REASONS.SELF_PARTITION_ONLY };
    }

    // ── Step 1: Provenance validation (D6.2) ─────────────────────────────────
    const provenanceCheck = validateProvenance(provenance, artifact);
    if (!provenanceCheck.ok) {
      return {
        ok: false,
        reason: WRITER_REASONS.PROVENANCE_INVALID,
        detail: provenanceCheck.reason,
      };
    }

    // ── Step 2: Tier resolution (D6.1) ───────────────────────────────────────
    const tierResult = resolveTier(
      /** @type {string} */ (provenance.artifact_type),
      /** @type {string} */ (provenance.privacy_tier),
      { vaultRegistryAvailable },
    );
    if (!tierResult.ok) {
      return { ok: false, reason: WRITER_REASONS.TIER_UNRESOLVABLE, detail: tierResult.reason };
    }
    const { terminalState } = tierResult;

    // ── Step 3: Consent gate (D6.3 — Phase 1 enforceConsentPolicy reuse) ─────
    const consentDecision = enforceConsentPolicy({
      lane: context.lane,
      containsPrivateData: context.containsPrivateData,
      consentId: context.consentId,
      isDelegate: context.isDelegate ?? false,
      delegatedManagedAllowed: context.delegatedManagedAllowed ?? false,
      enrichesDelegatedPartition: context.enrichesDelegatedPartition ?? false,
      delegatedEnrichmentAllowed: context.delegatedEnrichmentAllowed ?? false,
    });
    if (consentDecision !== 'allow') {
      return { ok: false, reason: WRITER_REASONS.CONSENT_DENIED, detail: consentDecision };
    }

    // ── Step 4: Encryption routing (D6.4) ────────────────────────────────────
    let encryptedPayload = null;
    if (terminalState === TERMINAL_STATES.CLIENT_ENCRYPTED) {
      const scope = _scopeForArtifact(/** @type {string} */ (provenance.artifact_type));

      // Require ClientEncryptor with user-held key — fail closed if absent (D6.4.2, D6.4.3)
      if (!encryptor.isAvailable(/** @type {string} */ (provenance.privacy_tier), scope)) {
        return { ok: false, reason: WRITER_REASONS.ENCRYPTION_UNAVAILABLE };
      }

      try {
        const plaintext = new TextEncoder().encode(JSON.stringify({ artifact, provenance: _safeProvenanceFields(provenance) }));
        encryptedPayload = encryptor.encrypt(plaintext, { scope });
      } catch (err) {
        // Surface a fixed reason code — never the raw exception (may contain key material)
        const detail =
          err instanceof Error && err.message === ENCRYPTOR_REASONS.UNAVAILABLE
            ? ENCRYPTOR_REASONS.UNAVAILABLE
            : ENCRYPTOR_REASONS.ENCRYPT_FAILED;
        return { ok: false, reason: WRITER_REASONS.ENCRYPTION_FAILED, detail };
      }
    }

    // ── Step 5: Terminal-state store (D6.1.2) ────────────────────────────────
    try {
      await _storeArtifact({
        artifact,
        provenance,
        terminalState,
        encryptedPayload,
        writeNoteFn,
        vaultPath,
        vectorStore,
        mm,
      });
    } catch {
      // Never re-throw the raw error (may contain path or data details)
      return { ok: false, reason: WRITER_REASONS.STORE_FAILED };
    }

    return { ok: true, terminalState };
  }

  /**
   * Delete all derived artifacts for a note path from ALL stores (D6.5.4).
   * A single deletion call removes frontmatter ai_summary, vector entry,
   * and stale-flags aggregate insights. Partial removal is an error.
   *
   * @param {DeleteTarget} target
   * @returns {Promise<DeleteResult>}
   */
  async function deleteArtifacts(target) {
    const failed = [];
    const succeeded = [];

    // 1. Remove ai_summary + provenance sidecar from note frontmatter (D6.5.1)
    if (target.notePath) {
      try {
        writeNoteFn(vaultPath, target.notePath, {
          frontmatter: {
            ai_summary: null,
            ai_summary_provenance: null,
            ai_summary_ciphertext: null,
          },
        });
        succeeded.push('frontmatter');
      } catch {
        failed.push('frontmatter');
      }
    }

    // 2. Purge vector entry keyed by note path (D6.5.1)
    if (target.notePath && vectorStore != null && typeof vectorStore.deleteByPath === 'function') {
      try {
        await vectorStore.deleteByPath(target.notePath);
        succeeded.push('vector');
      } catch {
        failed.push('vector');
      }
    }

    // 3. Stale-flag aggregate insights referencing this note (D6.5.2).
    // Aggregate insights are NOT deleted when a source note is deleted — instead,
    // a maintenance event records the deletion so runVerifyPass marks them stale
    // and D6.7 re-enrichment is triggered.
    if (target.notePath && mm != null) {
      try {
        mm.store('maintenance', {
          deleted_note_path: target.notePath,
          action: 'artifact_delete_requested',
        });
        succeeded.push('memory_stale_flag');
      } catch {
        failed.push('memory_stale_flag');
      }
    }

    if (failed.length === 0) {
      return { ok: true, stores: succeeded };
    }

    return {
      ok: false,
      reason: succeeded.length === 0 ? WRITER_REASONS.DELETE_FAILED : WRITER_REASONS.DELETE_PARTIAL,
      failed,
    };
  }

  /**
   * Advisory re-enrichment eligibility check (D6.7.1).
   *
   * Returns eligible=true when the active model/runtime version is newer than the
   * stored artifact's recorded version. This is a FLAG only — never forces recompute,
   * never routes the note to the proposal pipeline (D6.7.4).
   *
   * Fail-closed (D6.7 §fail-closed): unknown/unparseable version → eligible=true
   * (safe: recompute rather than trust potentially stale artifact).
   *
   * @param {{ model_version?: string | null, runtime_version?: string | null }} storedProvenance
   * @param {{ model_version?: string | null, runtime_version?: string | null }} currentVersions
   * @returns {EligibilityResult}
   */
  function checkReEnrichmentEligibility(storedProvenance, currentVersions) {
    if (!storedProvenance || !currentVersions) {
      return { eligible: true, reason: 're_enrichment_unknown_stored_version' };
    }

    const storedMV = typeof storedProvenance.model_version === 'string' && storedProvenance.model_version.trim()
      ? storedProvenance.model_version
      : null;
    const storedRV = typeof storedProvenance.runtime_version === 'string' && storedProvenance.runtime_version.trim()
      ? storedProvenance.runtime_version
      : null;
    const currentMV = typeof currentVersions.model_version === 'string' && currentVersions.model_version.trim()
      ? currentVersions.model_version
      : null;
    const currentRV = typeof currentVersions.runtime_version === 'string' && currentVersions.runtime_version.trim()
      ? currentVersions.runtime_version
      : null;

    // Both stored versions absent → eligible (stale by default)
    if (!storedMV && !storedRV) {
      return { eligible: true, reason: 're_enrichment_stored_version_absent' };
    }

    // Current version unknown → eligible (safe conservative default)
    if (!currentMV && !currentRV) {
      return { eligible: true, reason: 're_enrichment_current_version_unknown' };
    }

    // model_version mismatch
    if (storedMV && currentMV && currentMV !== storedMV) {
      return { eligible: true, reason: 're_enrichment_model_version_newer' };
    }

    // runtime_version mismatch
    if (storedRV && currentRV && currentRV !== storedRV) {
      return { eligible: true, reason: 're_enrichment_runtime_version_newer' };
    }

    return { eligible: false, reason: 're_enrichment_version_current' };
  }

  return Object.freeze({ write, deleteArtifacts, checkReEnrichmentEligibility });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Map artifact type to the encryptor scope (D6.4.1 / ENCRYPTOR_SCOPES).
 * ai_summary + embedding live in the vault; insight + discovery_facet in memory.
 * @param {string} artifactType
 * @returns {'vault'|'memory'}
 */
function _scopeForArtifact(artifactType) {
  return artifactType === 'ai_summary' || artifactType === 'embedding'
    ? ENCRYPTOR_SCOPES.VAULT
    : ENCRYPTOR_SCOPES.MEMORY;
}

/**
 * Return only the safe, non-secret provenance fields for storage in frontmatter/sidecar.
 * Defense-in-depth: provenance validator already rejects secrets, but we whitelist here
 * to guarantee no novel field with a secret ever appears in a stored artifact.
 * @param {object} provenance
 * @returns {object}
 */
function _safeProvenanceFields(provenance) {
  const SAFE = [
    'generated_by', 'source', 'model', 'model_version', 'runtime_version',
    'lane', 'privacy_tier', 'source_note_path', 'source_event_id',
    'created_at', 'artifact_type', 'schema_version',
  ];
  const result = /** @type {Record<string, unknown>} */ ({});
  for (const k of SAFE) {
    if (k in provenance) result[k] = /** @type {any} */ (provenance)[k];
  }
  return result;
}

/**
 * Dispatch terminal-state storage to the correct physical store.
 * Called ONLY by write() after all gates pass.
 *
 * @param {{
 *   artifact: object,
 *   provenance: object,
 *   terminalState: string,
 *   encryptedPayload: import('./companion-client-encryptor.mjs').EncryptResult | null,
 *   writeNoteFn: Function,
 *   vaultPath: string,
 *   vectorStore: object | null,
 *   mm: object | null,
 * }} params
 * @returns {Promise<void>}
 */
async function _storeArtifact({ artifact, provenance, terminalState, encryptedPayload, writeNoteFn, vaultPath, vectorStore, mm }) {
  const { artifact_type, source_note_path } = /** @type {any} */ (provenance);
  const safeProv = _safeProvenanceFields(provenance);

  if (terminalState === TERMINAL_STATES.HOST_READABLE) {
    switch (artifact_type) {
      case 'ai_summary': {
        if (!source_note_path) throw new Error('ai_summary requires source_note_path');
        writeNoteFn(vaultPath, source_note_path, {
          frontmatter: {
            ai_summary: artifact.summary,
            ai_summary_provenance: safeProv,
          },
        });
        break;
      }
      case 'embedding': {
        if (!vectorStore) throw new Error('embedding requires vectorStore');
        await vectorStore.upsert([{
          path: source_note_path,
          vector: artifact.vector,
          payload: { provenance: safeProv, ...(artifact.payload ?? {}) },
        }]);
        break;
      }
      case 'insight':
      case 'discovery_facet': {
        if (!mm) throw new Error('insight/discovery_facet requires MemoryManager');
        mm.store('insight', {
          connections: artifact.connections ?? [],
          contradictions: artifact.contradictions ?? [],
          open_questions: artifact.open_questions ?? [],
          topic_count: artifact.topic_count ?? 0,
          provenance: safeProv,
        });
        break;
      }
      default:
        throw new Error(`Unknown artifact_type: ${artifact_type}`);
    }

  } else if (terminalState === TERMINAL_STATES.CLIENT_ENCRYPTED) {
    // privacy_max: store ciphertext + wrappedDekRef only — host never sees plaintext (D6.4.2 step 3)
    if (!encryptedPayload) throw new Error('CLIENT_ENCRYPTED requires encryptedPayload');
    const ciphertextB64 = Buffer.from(encryptedPayload.ciphertext).toString('base64');
    const provenanceMeta = {
      wrapped_dek_ref: encryptedPayload.wrappedDekRef,
      alg: encryptedPayload.alg,
      schema_version: provenance.schema_version,
      artifact_type,
    };

    switch (artifact_type) {
      case 'ai_summary': {
        if (!source_note_path) throw new Error('ai_summary requires source_note_path');
        writeNoteFn(vaultPath, source_note_path, {
          frontmatter: {
            ai_summary_ciphertext: ciphertextB64,
            ai_summary_provenance: provenanceMeta,
          },
        });
        break;
      }
      case 'embedding': {
        if (!vectorStore) throw new Error('embedding requires vectorStore');
        await vectorStore.upsert([{
          path: source_note_path,
          ciphertext: ciphertextB64,
          wrapped_dek_ref: encryptedPayload.wrappedDekRef,
          alg: encryptedPayload.alg,
          provenance_schema_version: provenance.schema_version,
        }]);
        break;
      }
      case 'insight':
      case 'discovery_facet': {
        if (!mm) throw new Error('insight/discovery_facet requires MemoryManager');
        mm.store('insight', {
          ciphertext: ciphertextB64,
          wrapped_dek_ref: encryptedPayload.wrappedDekRef,
          alg: encryptedPayload.alg,
          schema_version: provenance.schema_version,
        });
        break;
      }
      default:
        throw new Error(`Unknown artifact_type: ${artifact_type}`);
    }

  }
  // TERMINAL_STATES.LOCAL_ONLY: nothing persisted to remote stores.
  // The caller handles local-only caching outside this writer — the writer
  // simply returns { ok: true, terminalState: 'local_only' } as confirmation.
}
