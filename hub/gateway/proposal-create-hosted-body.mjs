/**
 * Hosted: merge evaluation policy + review triggers into POST /api/v1/proposals JSON before canister.
 */

import { augmentProposalCreateRequestBody } from '../../lib/hub-proposal-create-augment.mjs';

/**
 * @param {string} method
 * @param {string} pathOnly
 * @param {unknown} body
 * @param {string} dataDir
 * @param {{ evaluationRequired?: boolean }} [policyOptions]
 * @returns {unknown}
 */
export function augmentProposalCreateForHosted(method, pathOnly, body, dataDir, policyOptions = {}) {
  if (method !== 'POST') return body;
  if (pathOnly !== '/api/v1/proposals' && pathOnly !== '/api/v1/proposals/') return body;
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  return augmentProposalCreateRequestBody(body, dataDir, policyOptions);
}
