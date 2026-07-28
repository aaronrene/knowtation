/**
 * Merge org evaluation policy + deterministic review triggers into a proposal create payload.
 * Used by self-hosted Hub and hosted gateway (POST /api/v1/proposals body).
 *
 * HOSTED-WRITE-EVAL E1: after triggers, Scooling personal self-apply class gets
 * evaluation_status=passed (never self-pass elevated / auto-flagged).
 *
 * SEC-KN-2 / Pass 2 P2: client-supplied evaluation_status / evaluated_by / evaluated_at
 * are stripped from every create body before policy/triggers/E1. Only server-side
 * evaluation (policy pending, E1 self-pass, or the evaluate endpoint) may set them.
 */

import { getProposalEvaluationRequired } from './hub-proposal-policy.mjs';
import { loadReviewTriggers, applyReviewTriggers } from './hub-proposal-review-triggers.mjs';
import { applyPersonalSelfApplyEvaluationE1 } from './hub-proposal-personal-self-apply.mjs';

/** Client-forgeable evaluation audit fields — never trusted on create. */
export const CLIENT_EVALUATION_CREATE_FIELDS = Object.freeze([
  'evaluation_status',
  'evaluated_by',
  'evaluated_at',
]);

/**
 * Remove client-supplied evaluation fields from a proposal-create body.
 * Mutates a shallow copy; does not mutate the input object.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
export function stripClientEvaluationFields(body) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  const next = { ...body };
  for (const key of CLIENT_EVALUATION_CREATE_FIELDS) {
    delete next[key];
  }
  return next;
}

/**
 * @param {Record<string, unknown>} body - parsed JSON body (mutated copy returned)
 * @param {string} dataDir
 * @param {{
 *   evaluationRequired?: boolean,
 *   evaluatedBy?: string,
 *   evaluatedAt?: string,
 *   sessionBound?: boolean,
 *   authorActorId?: string|null,
 * }} [policyOptions] - when `evaluationRequired` is boolean, skip file/env read
 * @returns {Record<string, unknown>}
 */
export function augmentProposalCreateRequestBody(body, dataDir, policyOptions = {}) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  const policyPending =
    typeof policyOptions.evaluationRequired === 'boolean'
      ? policyOptions.evaluationRequired
      : getProposalEvaluationRequired(dataDir);
  const triggers = loadReviewTriggers(dataDir);
  const labels = Array.isArray(body.labels) ? body.labels : [];
  const applied = applyReviewTriggers(triggers, {
    path: String(body.path ?? ''),
    body: String(body.body ?? ''),
    intent: String(body.intent ?? ''),
    labels,
  });
  // SEC-KN-2: discard client evaluation fields before any server assignment.
  let next = stripClientEvaluationFields(body);
  const needPending = policyPending || applied.forcePending;
  if (needPending) {
    next.evaluation_status = 'pending';
  }
  if (applied.review_queue) next.review_queue = applied.review_queue;
  if (applied.review_severity) next.review_severity = applied.review_severity;
  if (applied.auto_flag_reasons.length) {
    next.auto_flag_reasons_json = JSON.stringify(applied.auto_flag_reasons);
    next.auto_flag_reasons = applied.auto_flag_reasons;
  }
  // E1 AFTER trigger merge — elevated/auto-flag still fail P6 and stay pending.
  next = applyPersonalSelfApplyEvaluationE1(next, {
    evaluatedBy: policyOptions.evaluatedBy,
    evaluatedAt: policyOptions.evaluatedAt,
    sessionBound: policyOptions.sessionBound,
    authorActorId: policyOptions.authorActorId ?? policyOptions.evaluatedBy,
  });
  return next;
}
