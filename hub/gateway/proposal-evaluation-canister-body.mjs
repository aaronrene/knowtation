/**
 * Canister evaluation POST expects checklist JSON in evaluation_checklist_json (extractJsonString).
 * Hub UI sends checklist as an array; add the string field before proxying to Motoko.
 */

/**
 * @param {string} method
 * @param {string} pathOnly e.g. /api/v1/proposals/uuid/evaluation
 * @param {unknown} body
 * @returns {unknown}
 */
export function augmentProposalEvaluationBodyForCanister(method, pathOnly, body) {
  if (method !== 'POST' || body == null || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  if (!/^\/api\/v1\/proposals\/[^/]+\/evaluation\/?$/.test(pathOnly)) return body;
  const next = { ...body };
  if (Array.isArray(next.checklist)) {
    next.evaluation_checklist_json = JSON.stringify(next.checklist);
  }
  return next;
}
