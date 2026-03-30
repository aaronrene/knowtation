/**
 * Merge org evaluation policy + deterministic review triggers into a proposal create payload.
 * Used by self-hosted Hub and hosted gateway (POST /api/v1/proposals body).
 */

import { getProposalEvaluationRequired } from './hub-proposal-policy.mjs';
import { loadReviewTriggers, applyReviewTriggers } from './hub-proposal-review-triggers.mjs';

/**
 * @param {Record<string, unknown>} body - parsed JSON body (mutated copy returned)
 * @param {string} dataDir
 * @param {{ evaluationRequired?: boolean }} [policyOptions] - when `evaluationRequired` is boolean, skip file/env read
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
  const next = { ...body };
  const needPending = policyPending || applied.forcePending;
  if (needPending) {
    const es = next.evaluation_status;
    if (es == null || String(es).trim() === '') next.evaluation_status = 'pending';
  }
  if (applied.review_queue) next.review_queue = applied.review_queue;
  if (applied.review_severity) next.review_severity = applied.review_severity;
  if (applied.auto_flag_reasons.length) {
    next.auto_flag_reasons_json = JSON.stringify(applied.auto_flag_reasons);
  }
  return next;
}
