/**
 * Phase 6 — provenance schema validator (D6.2).
 *
 * Validates the canonical provenance record as a write precondition.
 * Every derived-artifact write is REJECTED if any required field is missing
 * or malformed, if the provenance or artifact payload contains sensitive keys,
 * or if the privacy_max + source=managed contradiction is present (D6.2, §fail-closed).
 *
 * DESIGN INVARIANTS:
 *   - Pure function — no I/O, no network, no side effects.
 *   - Fail-closed: any ambiguity or missing field → rejection.
 *   - No secret-bearing field ever passes (D6.2.3).
 *   - Provenance is a flag, not a lifecycle state (D6.2.5).
 */

import { hasSensitiveKeys } from './memory-event.mjs';
import { RUNTIME_LANES } from './model-runtime-lane.mjs';

/** Current schema version. Increment when the schema changes. */
export const PROVENANCE_SCHEMA_VERSION = 1;

/**
 * Valid `source` values for the provenance record (D6.2.1).
 * Maps from the inference lane origin. 'managed' = cloud/direct_provider lane.
 * @readonly
 */
export const PROVENANCE_SOURCES = /** @type {const} */ ([
  'companion',
  'in_browser',
  'managed',
  'self_hosted',
  'enterprise',
  'openrouter',
]);

/**
 * Valid `privacy_tier` values (D6.2.1).
 * The owner's vault tier — governs storage routing and encryption.
 * @readonly
 */
export const PRIVACY_TIERS = /** @type {const} */ (['convenience', 'privacy_max']);

/**
 * Valid `artifact_type` values (D6.2.1).
 * @readonly
 */
export const ARTIFACT_TYPES = /** @type {const} */ ([
  'ai_summary',
  'embedding',
  'insight',
  'discovery_facet',
]);

/**
 * Fixed reason codes for provenance validation failures.
 * Callers surface these codes to the user/logger — never the raw field value.
 * @readonly
 */
export const PROVENANCE_REJECT_REASONS = Object.freeze({
  /** A required field is missing from the provenance record. */
  MISSING_FIELD: 'provenance_missing_required_field',
  /** A required field is present but has an invalid value. */
  MALFORMED_FIELD: 'provenance_malformed_field',
  /** hasSensitiveKeys detected secret-bearing content in provenance or artifact. */
  SENSITIVE_DATA: 'provenance_sensitive_data_detected',
  /**
   * privacy_max + source=managed contradiction (D6.2 §fail-closed):
   * private content never routes to a managed (cloud) lane.
   */
  PRIVACY_MAX_MANAGED_CONTRADICTION: 'provenance_privacy_max_managed_contradiction',
  /**
   * Both model_version and runtime_version are absent (D6.2.1):
   * at least one MUST be a concrete value.
   */
  BOTH_VERSIONS_ABSENT: 'provenance_both_versions_absent',
});

/**
 * Validate an ISO-8601 timestamp string (lenient: Date constructor parses it).
 * @param {unknown} v
 * @returns {boolean}
 */
function isIso8601(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

/**
 * Validate the canonical provenance record before any derived-artifact write.
 *
 * Required fields per D6.2.1:
 *   generated_by, source, model, model_version|runtime_version (one MUST be concrete),
 *   runtime_version, lane, privacy_tier, source_note_path, source_event_id,
 *   created_at, artifact_type, schema_version.
 *
 * Additional checks (D6.2.3):
 *   - hasSensitiveKeys scan over provenance AND artifact payload.
 *   - privacy_max + source=managed → rejected as a contradiction.
 *
 * @param {unknown} provenance - The provenance record to validate.
 * @param {unknown} [artifact]  - The artifact payload (also scanned for sensitive keys).
 * @returns {{ ok: true } | { ok: false; reason: string; field?: string }}
 */
export function validateProvenance(provenance, artifact) {
  if (provenance == null || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MISSING_FIELD, field: 'provenance' };
  }

  const p = /** @type {Record<string, unknown>} */ (provenance);

  // generated_by — non-empty string actor id
  if (typeof p.generated_by !== 'string' || !p.generated_by.trim()) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MISSING_FIELD, field: 'generated_by' };
  }

  // source — valid enum
  if (!PROVENANCE_SOURCES.includes(/** @type {any} */ (p.source))) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'source' };
  }

  // model — non-empty string
  if (typeof p.model !== 'string' || !p.model.trim()) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MISSING_FIELD, field: 'model' };
  }

  // model_version OR runtime_version MUST be a concrete non-empty string (D6.2.1)
  const hasMV = typeof p.model_version === 'string' && p.model_version.trim().length > 0;
  const hasRV = typeof p.runtime_version === 'string' && p.runtime_version.trim().length > 0;
  if (!hasMV && !hasRV) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.BOTH_VERSIONS_ABSENT, field: 'model_version|runtime_version' };
  }

  // runtime_version — must be present (null is OK; undefined is not — missing field)
  if (!('runtime_version' in p)) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MISSING_FIELD, field: 'runtime_version' };
  }
  if (p.runtime_version !== null && typeof p.runtime_version !== 'string') {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'runtime_version' };
  }

  // lane — valid RUNTIME_LANES enum
  if (!RUNTIME_LANES.includes(/** @type {any} */ (p.lane))) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'lane' };
  }

  // privacy_tier — valid enum
  if (!PRIVACY_TIERS.includes(/** @type {any} */ (p.privacy_tier))) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'privacy_tier' };
  }

  // source_note_path — must be present (null is OK for aggregate artifacts)
  if (!('source_note_path' in p)) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MISSING_FIELD, field: 'source_note_path' };
  }
  if (p.source_note_path !== null && typeof p.source_note_path !== 'string') {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'source_note_path' };
  }

  // source_event_id — string or non-empty array of non-empty strings
  if (typeof p.source_event_id !== 'string' && !Array.isArray(p.source_event_id)) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MISSING_FIELD, field: 'source_event_id' };
  }
  if (typeof p.source_event_id === 'string' && !p.source_event_id.trim()) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'source_event_id' };
  }
  if (Array.isArray(p.source_event_id)) {
    if (p.source_event_id.length === 0) {
      return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'source_event_id' };
    }
    if (!p.source_event_id.every((id) => typeof id === 'string' && id.trim())) {
      return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'source_event_id' };
    }
  }

  // created_at — ISO-8601 timestamp
  if (!isIso8601(/** @type {any} */ (p.created_at))) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'created_at' };
  }

  // artifact_type — valid enum
  if (!ARTIFACT_TYPES.includes(/** @type {any} */ (p.artifact_type))) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'artifact_type' };
  }

  // schema_version — positive integer
  if (!Number.isInteger(p.schema_version) || /** @type {number} */ (p.schema_version) < 1) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.MALFORMED_FIELD, field: 'schema_version' };
  }

  // D6.2.3: privacy_max + source=managed contradiction
  // private content never routes to a managed (cloud) lane (D2.3)
  if (p.privacy_tier === 'privacy_max' && p.source === 'managed') {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.PRIVACY_MAX_MANAGED_CONTRADICTION };
  }

  // D6.2.3: hasSensitiveKeys scan over provenance (no DEK, IK, JWT, token, etc.)
  if (hasSensitiveKeys(p)) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.SENSITIVE_DATA };
  }

  // D6.2.3: hasSensitiveKeys scan over artifact payload
  if (artifact != null && hasSensitiveKeys(artifact)) {
    return { ok: false, reason: PROVENANCE_REJECT_REASONS.SENSITIVE_DATA };
  }

  return { ok: true };
}

/**
 * Build a minimal valid provenance record for the convenience/self-partition default case.
 * Used by migrated enrichment callers that have a config + lane context but no explicit actor.
 *
 * @param {{
 *   generatedBy: string,
 *   source: string,
 *   model: string,
 *   modelVersion?: string,
 *   runtimeVersion?: string,
 *   lane: string,
 *   artifactType: string,
 *   sourceNotePath?: string | null,
 *   sourceEventId: string | string[],
 * }} params
 * @returns {object} A provenance record with schema_version, privacy_tier=convenience, created_at=now.
 */
export function buildConvenienceProvenance(params) {
  return {
    generated_by: params.generatedBy,
    source: params.source,
    model: params.model,
    model_version: params.modelVersion ?? null,
    runtime_version: params.runtimeVersion ?? null,
    lane: params.lane,
    privacy_tier: 'convenience',
    source_note_path: params.sourceNotePath ?? null,
    source_event_id: params.sourceEventId,
    created_at: new Date().toISOString(),
    artifact_type: params.artifactType,
    schema_version: PROVENANCE_SCHEMA_VERSION,
  };
}
