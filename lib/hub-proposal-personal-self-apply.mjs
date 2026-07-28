/**
 * Scooling personal self-apply class — HOSTED-WRITE-EVAL §HWE.3 + SEC-SEAM-1 + FINISH-COMPLETE-APPLY T5.
 *
 * Narrow predicate: hosted (or Node-parity) actors with vault:write may approve
 * their own partition proposals that match an admitted fingerprint (review tray,
 * or Tasks/Media under §FCA.4), without a Hub evaluation hop. Not a global
 * member-approve grant.
 *
 * SEC-SEAM-1: session-bound author==approver for seam surfaces; named refusals;
 * classification reuses apply-path predicates (S3.0). FINISH-COMPLETE-APPLY-KN-b
 * (T5) replaces step-11 empty admission with Tasks/Media fingerprints; Delegation
 * stays unconditional SELF_APPLY_DELEGATION_REFUSED; Flow/flow_capture stay
 * SELF_APPLY_NOT_ADMITTED.
 *
 * @see docs/PROPOSAL-LIFECYCLE.md — Personal self-apply
 * @see docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md
 * @see ../scooling/docs/FINISH-COMPLETE-APPLY-CONTRACT.md §FCA.4
 * @see ../scooling/docs/HOSTED-WRITE-EVAL-CONTRACT.md §HWE.3
 */

import { normalizeCanisterProposalForTaskPrecheck } from './task/task-hosted-proposal.mjs';
import { normalizeCanisterProposalForDelegationPrecheck } from './agent/delegation-hosted-proposal.mjs';
import { TASK_PROPOSAL_SOURCE } from './task/task-write.mjs';
import { DELEGATION_PROPOSAL_SOURCE } from './agent/delegation.mjs';
import { MEDIA_PROPOSAL_SOURCE } from './attachments/attachment-write.mjs';
import { FLOW_PROPOSAL_SOURCE } from './flow/flow-authoring.mjs';
import { FLOW_CAPTURE_PROPOSAL_SOURCE } from './flow/flow-capture.mjs';
import { isSelfApplyIneligibleSub } from './hub-self-apply-ineligible.mjs';
import {
  SCOOLING_TASK_EXTERNAL_REF_RE,
  SCOOLING_MEDIA_EXTERNAL_REF_RE,
  resolveOptionalScoolingExternalRef,
} from './scooling-external-ref.mjs';

export {
  SCOOLING_TASK_EXTERNAL_REF_RE,
  SCOOLING_MEDIA_EXTERNAL_REF_RE,
  resolveOptionalScoolingExternalRef,
};

/** @type {string} */
export const SCOOLING_REVIEW_TRAY_INTENT = 'scooling.review_tray.approve';

/** external_ref: scooling.review:{id} with bounded charset */
export const SCOOLING_REVIEW_EXTERNAL_REF_RE = /^scooling\.review:[A-Za-z0-9._:-]{1,200}$/;

/** path: reviewed/{slug}.md */
export const SCOOLING_REVIEWED_PATH_RE = /^reviewed\/[A-Za-z0-9._:-]{1,128}\.md$/;

/** FINISH-COMPLETE-APPLY §FCA.4.1 — task proposal mirror path */
export const SCOOLING_TASK_PROPOSAL_PATH_RE =
  /^meta\/tasks\/proposals\/([A-Za-z0-9._:-]{1,128})\.json$/;

/** FINISH-COMPLETE-APPLY §FCA.4.2 — media proposal mirror path */
export const SCOOLING_MEDIA_PROPOSAL_PATH_RE =
  /^meta\/media\/proposals\/([A-Za-z0-9._:-]{1,128})\.json$/;

/** Closed task kind allowlist (§FCA.4.1). */
export const ADMITTED_TASK_PROPOSAL_KINDS = Object.freeze([
  'task_create',
  'task_status_update',
  'task_assign',
  'task_artifact_link',
  'task_loop_create',
  'task_loop_pause',
  'task_loop_cancel',
  'task_instance_materialize',
]);

const ADMITTED_TASK_KIND_SET = new Set(ADMITTED_TASK_PROPOSAL_KINDS);

/** Closed media kind allowlist (§FCA.4.2). */
export const ADMITTED_MEDIA_PROPOSAL_KINDS = Object.freeze([
  'media_external_link',
  'media_attach',
]);

const ADMITTED_MEDIA_KIND_SET = new Set(ADMITTED_MEDIA_PROPOSAL_KINDS);

/** HTTP-visible seam refusal codes (S6) — never collapsed to generic FORBIDDEN. */
export const SELF_APPLY_HTTP_VISIBLE_SEAM_CODES = Object.freeze([
  'SELF_APPLY_SESSION_BINDING_REQUIRED',
  'SELF_APPLY_AUTHOR_UNVERIFIED',
  'SELF_APPLY_AUTHOR_MISMATCH',
  'SELF_APPLY_DELEGATION_REFUSED',
  'SELF_APPLY_NOT_ADMITTED',
]);

const HTTP_VISIBLE_SEAM_CODE_SET = new Set(SELF_APPLY_HTTP_VISIBLE_SEAM_CODES);

/**
 * Stable error bodies for HTTP-visible seam codes.
 * @type {Readonly<Record<string, string>>}
 */
export const SELF_APPLY_SEAM_ERROR_MESSAGES = Object.freeze({
  SELF_APPLY_SESSION_BINDING_REQUIRED:
    'Personal self-apply requires a session-bound learner credential on seam proposals.',
  SELF_APPLY_AUTHOR_UNVERIFIED:
    'Personal self-apply requires a verified proposal author on seam proposals.',
  SELF_APPLY_AUTHOR_MISMATCH:
    'Personal self-apply requires the approver to match the proposal author on seam proposals.',
  SELF_APPLY_DELEGATION_REFUSED:
    'Personal self-apply is refused for delegation surface proposals.',
  SELF_APPLY_NOT_ADMITTED:
    'Personal self-apply is not admitted for this seam proposal.',
});

/**
 * Whether a refusal code must be returned verbatim over HTTP (S6 / S6.2).
 * @param {string|null|undefined} code
 * @returns {boolean}
 */
export function isHttpVisibleSelfApplySeamCode(code) {
  return typeof code === 'string' && HTTP_VISIBLE_SEAM_CODE_SET.has(code);
}

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
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {Record<string, unknown>|null}
 */
function parseProposalBodyObject(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;
  try {
    const parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * Scope from apply-path body order: task.scope → loop.scope → top-level scope.
 * @param {Record<string, unknown>|null} body
 * @returns {string}
 */
export function extractTaskOrMediaScopeFromBody(body) {
  if (!body || typeof body !== 'object') return '';
  const task = body.task;
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    const s = /** @type {Record<string, unknown>} */ (task).scope;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  const loop = body.loop;
  if (loop && typeof loop === 'object' && !Array.isArray(loop)) {
    const s = /** @type {Record<string, unknown>} */ (loop).scope;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  if (typeof body.scope === 'string' && body.scope.trim()) return body.scope.trim();
  return '';
}

/**
 * Path slug must be rewritten to a real proposal_id — never `pending` (approve-time admission).
 * @param {string} path
 * @param {RegExp} re
 * @param {string|null|undefined} proposalId
 * @returns {boolean}
 */
function proposalMirrorPathAdmitted(path, re, proposalId) {
  const notePath = String(path ?? '').trim().replace(/^\/+/, '');
  const m = notePath.match(re);
  if (!m) return false;
  const slug = m[1];
  if (!slug || slug === 'pending') return false;
  if (proposalId != null && String(proposalId).trim()) {
    return slug === String(proposalId).trim();
  }
  return true;
}

/**
 * Create-time path shape for E1 — pending slug allowed until rewrite completes.
 * @param {string} path
 * @param {RegExp} re
 * @returns {boolean}
 */
function proposalMirrorPathShapeOk(path, re) {
  const notePath = String(path ?? '').trim().replace(/^\/+/, '');
  return re.test(notePath);
}

/**
 * FINISH-COMPLETE-APPLY §FCA.4.1 — Tasks fingerprint (without assignee/author conjunct).
 * @param {Record<string, unknown>|null|undefined} proposal
 * @param {{ allowPendingPath?: boolean }} [opts]
 * @returns {boolean}
 */
export function matchesScoolingTaskFingerprint(proposal, opts = {}) {
  if (!proposal || typeof proposal !== 'object') return false;
  if (isDelegationSurfaceProposal(proposal)) return false;

  const normalized = normalizeCanisterProposalForTaskPrecheck(proposal);
  const isTask =
    normalized != null ||
    proposal.source === TASK_PROPOSAL_SOURCE ||
    (typeof proposal.path === 'string' &&
      proposal.path.replace(/^\/+/, '').startsWith('meta/tasks/proposals/'));
  if (!isTask) return false;

  const kind = String(
    (normalized && normalized.task_meta && /** @type {{ proposal_kind?: string }} */ (normalized.task_meta)
      .proposal_kind) ||
      '',
  ).trim();
  if (!ADMITTED_TASK_KIND_SET.has(kind)) return false;

  const pathOk = opts.allowPendingPath
    ? proposalMirrorPathShapeOk(String(proposal.path ?? ''), SCOOLING_TASK_PROPOSAL_PATH_RE)
    : proposalMirrorPathAdmitted(
        String(proposal.path ?? ''),
        SCOOLING_TASK_PROPOSAL_PATH_RE,
        typeof proposal.proposal_id === 'string' ? proposal.proposal_id : null,
      );
  if (!pathOk) return false;

  const externalRef = String(proposal.external_ref ?? '').trim();
  if (!SCOOLING_TASK_EXTERNAL_REF_RE.test(externalRef)) return false;

  const body = parseProposalBodyObject(proposal);
  if (extractTaskOrMediaScopeFromBody(body) !== 'personal') return false;

  return true;
}

/**
 * FINISH-COMPLETE-APPLY §FCA.4.2 — Media fingerprint.
 * @param {Record<string, unknown>|null|undefined} proposal
 * @param {{ allowPendingPath?: boolean }} [opts]
 * @returns {boolean}
 */
export function matchesScoolingMediaFingerprint(proposal, opts = {}) {
  if (!proposal || typeof proposal !== 'object') return false;
  if (isDelegationSurfaceProposal(proposal)) return false;
  if (proposal.source !== MEDIA_PROPOSAL_SOURCE) return false;

  const body = parseProposalBodyObject(proposal);
  const kindFromMeta =
    proposal.media_meta &&
    typeof proposal.media_meta === 'object' &&
    typeof /** @type {{ proposal_kind?: string }} */ (proposal.media_meta).proposal_kind === 'string'
      ? String(/** @type {{ proposal_kind: string }} */ (proposal.media_meta).proposal_kind).trim()
      : '';
  const kindFromBody =
    body && typeof body.proposal_kind === 'string' ? body.proposal_kind.trim() : '';
  const kind = kindFromMeta || kindFromBody;
  if (!ADMITTED_MEDIA_KIND_SET.has(kind)) return false;

  const pathOk = opts.allowPendingPath
    ? proposalMirrorPathShapeOk(String(proposal.path ?? ''), SCOOLING_MEDIA_PROPOSAL_PATH_RE)
    : proposalMirrorPathAdmitted(
        String(proposal.path ?? ''),
        SCOOLING_MEDIA_PROPOSAL_PATH_RE,
        typeof proposal.proposal_id === 'string' ? proposal.proposal_id : null,
      );
  if (!pathOk) return false;

  const externalRef = String(proposal.external_ref ?? '').trim();
  if (!SCOOLING_MEDIA_EXTERNAL_REF_RE.test(externalRef)) return false;

  if (extractTaskOrMediaScopeFromBody(body) !== 'personal') return false;

  return true;
}

/**
 * T5 positive admission for Tasks/Media (author used for task_assign self-assign).
 * @param {Record<string, unknown>|null|undefined} proposal
 * @param {string} authorActorId - already trimmed
 * @param {{ allowPendingPath?: boolean }} [opts]
 * @returns {boolean}
 */
export function isAdmittedSeamSelfApplyFingerprint(proposal, authorActorId, opts = {}) {
  if (matchesScoolingMediaFingerprint(proposal, opts)) return true;
  if (!matchesScoolingTaskFingerprint(proposal, opts)) return false;

  const normalized = normalizeCanisterProposalForTaskPrecheck(proposal);
  const kind = String(
    (normalized && normalized.task_meta && /** @type {{ proposal_kind?: string }} */ (normalized.task_meta)
      .proposal_kind) ||
      '',
  ).trim();
  if (kind !== 'task_assign') return true;

  const body = parseProposalBodyObject(proposal);
  const assigneeRaw = body && body.assignee_ref != null ? body.assignee_ref : null;
  if (typeof assigneeRaw !== 'string') return false;
  const assignee = assigneeRaw.trim();
  if (!assignee || !authorActorId) return false;
  return assignee === authorActorId;
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
 *
 * SEC-KN-3 / Pass 2 P6: self-apply is the learner's human review. Agent tokens
 * (`tokenType: 'mcp_access'`, `actorKind: 'agent'`, or `humanActor: false`) are never eligible.
 *
 * @param {string} role
 * @param {{
 *   humanActor?: boolean,
 *   tokenType?: string|null,
 *   actorKind?: string|null,
 * }} [actor]
 * @returns {boolean}
 */
export function roleEligibleForPersonalSelfApply(role, actor = {}) {
  if (actor.humanActor === false) return false;
  if (String(actor.tokenType || '').trim() === 'mcp_access') return false;
  if (String(actor.actorKind || '').trim() === 'agent') return false;
  const r = String(role || '').trim();
  return r === 'member' || r === 'editor' || r === 'admin';
}

/**
 * SEC-SEAM-1 / S3.1 — seam by construction from approve-time apply triggers.
 * Fail-closed: any predicate throw classifies as seam (obligations imposed).
 *
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {boolean}
 */
export function isSeamSurfaceProposal(proposal) {
  try {
    if (!proposal || typeof proposal !== 'object') return false;
    if (normalizeCanisterProposalForTaskPrecheck(proposal) != null) return true;
    if (normalizeCanisterProposalForDelegationPrecheck(proposal) != null) return true;
    const source = proposal.source;
    if (source === TASK_PROPOSAL_SOURCE) return true;
    if (source === DELEGATION_PROPOSAL_SOURCE) return true;
    if (source === MEDIA_PROPOSAL_SOURCE) return true;
    if (source === FLOW_PROPOSAL_SOURCE) return true;
    if (source === FLOW_CAPTURE_PROPOSAL_SOURCE) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * SEC-SEAM-1 / S3.1 — delegation surface only (conditions 2 or 4).
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {boolean}
 */
export function isDelegationSurfaceProposal(proposal) {
  try {
    if (!proposal || typeof proposal !== 'object') return false;
    if (normalizeCanisterProposalForDelegationPrecheck(proposal) != null) return true;
    if (proposal.source === DELEGATION_PROPOSAL_SOURCE) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Trim opaque actor ids for exact comparison (case-sensitive).
 * @param {unknown} value
 * @returns {string}
 */
function trimActorId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * SEC-SEAM-1 / S6 + FINISH-COMPLETE-APPLY T5 — total refusal reason.
 * Precedence is frozen in S6.1. Step 11 admits Tasks/Media fingerprints only.
 *
 * @param {{
 *   proposal: Record<string, unknown>|null|undefined,
 *   hasVaultWrite: boolean,
 *   partitionOwned: boolean,
 *   role?: string,
 *   humanActor?: boolean,
 *   tokenType?: string|null,
 *   actorKind?: string|null,
 *   authorActorId?: string|null,
 *   approverActorId?: string|null,
 *   sessionBound?: boolean,
 * }} opts
 * @returns {string|null}
 */
export function personalSelfApplyRefusalReason(opts) {
  const { proposal, hasVaultWrite, partitionOwned } = opts;
  const authorActorId = trimActorId(opts.authorActorId);
  const approverActorId = trimActorId(opts.approverActorId);

  // 1 — S10 ineligible subject (internal-only over HTTP)
  if (isSelfApplyIneligibleSub(approverActorId)) {
    return 'SELF_APPLY_SUBJECT_INELIGIBLE';
  }
  // 2–3 — live order
  if (!hasVaultWrite) return 'NOT_VAULT_WRITE';
  if (!partitionOwned) return 'NOT_PARTITION_OWNED';
  // 4 — role ineligible (role != null guard is load-bearing)
  if (
    opts.role != null &&
    !roleEligibleForPersonalSelfApply(opts.role, {
      humanActor: opts.humanActor,
      tokenType: opts.tokenType,
      actorKind: opts.actorKind,
    })
  ) {
    return 'ROLE_NOT_ELIGIBLE';
  }
  // 5 — proposal missing
  if (!proposal || typeof proposal !== 'object') return 'PROPOSAL_MISSING';
  // 6 — status not proposed (absent status treated as proposed)
  if (String(proposal.status ?? 'proposed').trim() !== 'proposed') {
    return 'STATUS_NOT_PROPOSED';
  }

  const seam = isSeamSurfaceProposal(proposal);
  // 7 — delegation refused unconditionally
  if (isDelegationSurfaceProposal(proposal)) {
    return 'SELF_APPLY_DELEGATION_REFUSED';
  }
  if (seam) {
    // 8 — session binding
    if (opts.sessionBound !== true) return 'SELF_APPLY_SESSION_BINDING_REQUIRED';
    // 9 — author empty
    if (!authorActorId) return 'SELF_APPLY_AUTHOR_UNVERIFIED';
    // 10 — approver empty or author ≠ approver
    if (!approverActorId || authorActorId !== approverActorId) {
      return 'SELF_APPLY_AUTHOR_MISMATCH';
    }
    // 11 — T5 admission (Tasks/Media fingerprints only; Flow stays out)
    if (!isAdmittedSeamSelfApplyFingerprint(proposal, authorActorId)) {
      return 'SELF_APPLY_NOT_ADMITTED';
    }
    if (isElevatedOrAutoFlagged(proposal)) return 'ELEVATED_OR_AUTO_FLAGGED';
    return null;
  }

  // 12 — fingerprint
  if (!matchesScoolingReviewTrayFingerprint(proposal)) return 'FINGERPRINT_MISMATCH';
  // 13 — elevated / auto-flagged
  if (isElevatedOrAutoFlagged(proposal)) return 'ELEVATED_OR_AUTO_FLAGGED';
  // 14 — class holds
  return null;
}

/**
 * Full personal self-apply class check (P1–P8 + SEC-SEAM-1 + T5).
 * Implemented as `personalSelfApplyRefusalReason(opts) === null` so the boolean
 * and named-reason paths can never diverge (S6 / V5).
 *
 * @param {Parameters<typeof personalSelfApplyRefusalReason>[0]} opts
 * @returns {boolean}
 */
export function isPersonalSelfApplyClass(opts) {
  return personalSelfApplyRefusalReason(opts) === null;
}

/**
 * Whether create-time E1 may self-pass this body for an admitted class.
 * Review-tray: fingerprint only (unchanged). Tasks/Media: fingerprint + session/author gates.
 *
 * @param {Record<string, unknown>} body
 * @param {{
 *   evaluatedBy?: string,
 *   sessionBound?: boolean,
 *   authorActorId?: string|null,
 * }} audit
 * @returns {boolean}
 */
function e1FingerprintEligible(body, audit) {
  if (matchesScoolingReviewTrayFingerprint(body)) return true;
  // Refuse to self-pass when sessionBound/author gates would fail at approve (P3 / §FCA.4.0 E1).
  if (audit.sessionBound !== true) return false;
  const author = trimActorId(audit.authorActorId ?? audit.evaluatedBy);
  if (!author) return false;
  return isAdmittedSeamSelfApplyFingerprint(body, author, { allowPendingPath: true });
}

/**
 * E1 — after policy + review-trigger augmentation, self-satisfy evaluation for the class.
 * Elevated / auto-flagged proposals are left untouched (stay pending when gate/triggers require it).
 * T5: also stamps admitted Task/Media fingerprints when sessionBound + author hold.
 *
 * @param {Record<string, unknown>} body - post-trigger create body
 * @param {{
 *   evaluatedBy?: string,
 *   evaluatedAt?: string,
 *   sessionBound?: boolean,
 *   authorActorId?: string|null,
 * }} [audit]
 * @returns {Record<string, unknown>}
 */
export function applyPersonalSelfApplyEvaluationE1(body, audit = {}) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  if (!e1FingerprintEligible(body, audit)) return body;
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
  // SEC-KN-2: evaluated_by / evaluated_at come only from server audit — never from body.
  const evaluatedBy =
    typeof audit.evaluatedBy === 'string' && audit.evaluatedBy.trim()
      ? audit.evaluatedBy.trim().slice(0, 256)
      : '';
  const evaluatedAt =
    typeof audit.evaluatedAt === 'string' && audit.evaluatedAt.trim()
      ? audit.evaluatedAt.trim()
      : new Date().toISOString();
  const next = {
    ...body,
    evaluation_status: 'passed',
    evaluated_at: evaluatedAt,
  };
  if (evaluatedBy) next.evaluated_by = evaluatedBy;
  else delete next.evaluated_by;
  return next;
}

/**
 * Whether approve RBAC may allow this actor via personal self-apply (not admin/evaluator path).
 * Same boolean contract as before; equals `personalSelfApplyRefusalReason(opts) === null` (V5).
 *
 * @param {Parameters<typeof personalSelfApplyRefusalReason>[0]} opts
 * @returns {boolean}
 */
export function personalSelfApplyAllowsApprove(opts) {
  return personalSelfApplyRefusalReason(opts) === null;
}
