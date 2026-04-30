/**
 * Build { path, body } for hosted review-hints after POST /proposals.
 * The canister create response often omits `body`; the client request (bodyOut) still has it.
 * Passing non-empty body lets proposal-review-hints-async skip a canister GET (saves ~1–3s+).
 */

/**
 * @param {unknown} j - parsed JSON from canister POST /proposals response
 * @param {unknown} bodyOut - outgoing request body object (after augment), same shape sent to canister
 * @returns {{ path: string, body: string } | null}
 */
export function proposalDataForHostedReviewHintsFromCreate(j, bodyOut) {
  if (!j || typeof j !== 'object' || typeof j.proposal_id !== 'string') return null;
  let mergedBody = j.body != null && String(j.body).length > 0 ? String(j.body) : '';
  if (!mergedBody && bodyOut && typeof bodyOut === 'object' && !Buffer.isBuffer(bodyOut)) {
    const b = /** @type {Record<string, unknown>} */ (bodyOut).body;
    if (b != null) mergedBody = String(b);
  }
  const pathStr = j.path != null ? String(j.path) : '';
  return { path: pathStr, body: mergedBody };
}
