/**
 * Scooling propose-time external_ref validation (FINISH-COMPLETE-APPLY §FCA.4 +
 * FLOW-WRITE-LIVE §FWL.4.1). Kept separate from hub-proposal-personal-self-apply
 * to avoid import cycles with task-write / attachment-write / flow-authoring
 * (which those modules import for SOURCE constants).
 */

/** @type {RegExp} */
export const SCOOLING_TASK_EXTERNAL_REF_RE = /^scooling\.task:[A-Za-z0-9._:-]{1,200}$/;

/** @type {RegExp} */
export const SCOOLING_MEDIA_EXTERNAL_REF_RE = /^scooling\.media:[A-Za-z0-9._:-]{1,200}$/;

/** FLOW-WRITE-LIVE §FWL.4.1 — Flow authoring admission ref (max 128 after prefix). */
/** @type {RegExp} */
export const SCOOLING_FLOW_EXTERNAL_REF_RE = /^scooling\.flow:[A-Za-z0-9._:-]{1,128}$/;

/**
 * Validate optional Scooling external_ref on propose (absent → ok/undefined; malformed → 400).
 * @param {unknown} raw
 * @param {RegExp} expectedRe
 * @returns {{ ok: true, externalRef: string|undefined } | { ok: false, status: number, code: string, error: string }}
 */
export function resolveOptionalScoolingExternalRef(raw, expectedRe) {
  if (raw == null) return { ok: true, externalRef: undefined };
  const s = String(raw).trim();
  if (!s) return { ok: true, externalRef: undefined };
  if (!expectedRe.test(s)) {
    return {
      ok: false,
      status: 400,
      code: 'EXTERNAL_REF_INVALID',
      error: 'external_ref does not match the required Scooling pattern',
    };
  }
  return { ok: true, externalRef: s };
}

/**
 * Read optional external_ref from propose input / body.
 * @param {object} input
 * @returns {unknown}
 */
export function readProposeExternalRefRaw(input) {
  if (!input || typeof input !== 'object') return undefined;
  if (typeof input.externalRef === 'string') return input.externalRef;
  if (typeof input.external_ref === 'string') return input.external_ref;
  const body = input.body && typeof input.body === 'object' ? input.body : null;
  if (body && typeof body.external_ref === 'string') return body.external_ref;
  return undefined;
}
