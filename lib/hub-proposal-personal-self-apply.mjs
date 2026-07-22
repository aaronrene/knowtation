/**
 * Scooling personal self-apply class — HOSTED-WRITE-EVAL §HWE.3.
 *
 * Narrow predicate: hosted (or Node-parity) actors with vault:write may approve
 * their own partition proposals that match the Scooling review-tray fingerprint,
 * without a Hub evaluation hop. Not a global member-approve grant.
 *
 * @see docs/PROPOSAL-LIFECYCLE.md — Personal self-apply (Scooling review tray)
 * @see ../scooling/docs/HOSTED-WRITE-EVAL-CONTRACT.md §HWE.3
 */

/** @type {string} */
export const SCOOLING_REVIEW_TRAY_INTENT = 'scooling.review_tray.approve';

/** external_ref: scooling.review:{id} with bounded charset */
export const SCOOLING_REVIEW_EXTERNAL_REF_RE = /^scooling\.review:[A-Za-z0-9._:-]{1,200}$/;

/** path: reviewed/{slug}.md */
export const SCOOLING_REVIEWED_PATH_RE = /^reviewed\/[A-Za-z0-9._:-]{1,128}\.md$/;

/**
 * Normalize auto-flag reasons from proposal or create body (array or JSON string).
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {string[]}
 */
export function parseAutoFlagReasons(proposal) {
  if (!proposal || typeof proposal !== 'object') return [];
  if (Array.isArray(proposal.auto_flag_reasons)) {
    return proposal.auto_flag_reasons.map((x) => String(x)).filter(Boolean);
  }
  const raw = proposal.auto_flag_reasons_json;
  if (raw == null || String(raw).trim() === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * P3–P5 fingerprint (intent + external_ref + path).
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {boolean}
 */
export function matchesScoolingReviewTrayFingerprint(proposal) {
  if (!proposal || typeof proposal !== 'object') return false;
  const intent = String(proposal.intent ?? '').trim();
  if (intent !== SCOOLING_REVIEW_TRAY_INTENT) return false;
  const externalRef = String(proposal.external_ref ?? '').trim();
  if (!SCOOLING_REVIEW_EXTERNAL_REF_RE.test(externalRef)) return false;
  const notePath = String(proposal.path ?? '').trim().replace(/^\/+/, '');
  if (!SCOOLING_REVIEWED_PATH_RE.test(notePath)) return false;
  return true;
}

/**
 * P6 — elevated severity or any auto-flag reasons → no self-apply.
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {boolean}
 */
export function isElevatedOrAutoFlagged(proposal) {
  if (!proposal || typeof proposal !== 'object') return false;
  if (String(proposal.review_severity ?? '').trim() === 'elevated') return true;
  return parseAutoFlagReasons(proposal).length > 0;
}

/**
 * Roles that may exercise personal self-apply when the full predicate holds.
 * Hosted majority = member; Node Hub write role = editor.
 * @param {string} role
 * @returns {boolean}
 */
export function roleEligibleForPersonalSelfApply(role) {
  const r = String(role || '').trim();
  return r === 'member' || r === 'editor' || r === 'admin';
}

/**
 * Full personal self-apply class check (P1–P8 fields the server can evaluate).
 *
 * @param {{
 *   proposal: Record<string, unknown>|null|undefined,
 *   hasVaultWrite: boolean,
 *   partitionOwned: boolean,
 *   role?: string,
 * }} opts
 * @returns {boolean}
 */
export function isPersonalSelfApplyClass(opts) {
  const { proposal, hasVaultWrite, partitionOwned } = opts;
  if (!hasVaultWrite || !partitionOwned) return false;
  if (opts.role != null && !roleEligibleForPersonalSelfApply(opts.role)) return false;
  if (!proposal || typeof proposal !== 'object') return false;
  if (String(proposal.status ?? 'proposed').trim() !== 'proposed') return false;
  if (!matchesScoolingReviewTrayFingerprint(proposal)) return false;
  if (isElevatedOrAutoFlagged(proposal)) return false;
  return true;
}

/**
 * E1 — after policy + review-trigger augmentation, self-satisfy evaluation for the class.
 * Elevated / auto-flagged proposals are left untouched (stay pending when gate/triggers require it).
 *
 * @param {Record<string, unknown>} body - post-trigger create body
 * @param {{ evaluatedBy?: string, evaluatedAt?: string }} [audit]
 * @returns {Record<string, unknown>}
 */
export function applyPersonalSelfApplyEvaluationE1(body, audit = {}) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  if (!matchesScoolingReviewTrayFingerprint(body)) return body;
  if (isElevatedOrAutoFlagged(body)) {
    // P6 fail-closed: never leave a forged `passed` on elevated / auto-flagged class rows.
    if (String(body.evaluation_status ?? '').trim() === 'passed') {
      const cleared = { ...body, evaluation_status: 'pending' };
      delete cleared.evaluated_by;
      delete cleared.evaluated_at;
      return cleared;
    }
    return body;
  }
  const evaluatedBy =
    typeof audit.evaluatedBy === 'string' && audit.evaluatedBy.trim()
      ? audit.evaluatedBy.trim().slice(0, 256)
      : typeof body.evaluated_by === 'string'
        ? String(body.evaluated_by).trim().slice(0, 256)
        : '';
  const evaluatedAt =
    typeof audit.evaluatedAt === 'string' && audit.evaluatedAt.trim()
      ? audit.evaluatedAt.trim()
      : new Date().toISOString();
  return {
    ...body,
    evaluation_status: 'passed',
    ...(evaluatedBy ? { evaluated_by: evaluatedBy } : {}),
    evaluated_at: evaluatedAt,
  };
}

/**
 * Whether approve RBAC may allow this actor via personal self-apply (not admin/evaluator path).
 * @param {Parameters<typeof isPersonalSelfApplyClass>[0]} opts
 * @returns {boolean}
 */
export function personalSelfApplyAllowsApprove(opts) {
  return isPersonalSelfApplyClass(opts);
}
