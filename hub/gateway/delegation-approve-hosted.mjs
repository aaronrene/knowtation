/**
 * Gateway hook: after canister proposal approve, apply bridge delegation indexes (7C-L1b).
 */

import { proposalIdFromApprovePath } from '../../lib/muse-thin-bridge.mjs';
import {
  applyApprovedDelegationProposalFromCanister,
  fetchCanisterProposalForDelegation,
  isDelegationProposalIntent,
} from '../../lib/agent/delegation-hosted-proposal.mjs';

const PROPOSAL_APPROVE_RE = /^\/api\/v1\/proposals\/[^/]+\/approve\/?$/;

/**
 * @param {{
 *   method: string,
 *   pathOnly: string,
 *   upstreamStatus: number,
 *   canisterUrl: string,
 *   bridgeUrl: string,
 *   authorization: string|undefined,
 *   vaultId: string,
 *   effectiveUserId: string,
 *   actorUserId: string,
 *   canisterAuthHeaders: () => Record<string, string>,
 * }} ctx
 * @returns {Promise<{ applied: boolean, error?: string, code?: string, payload?: Record<string, unknown> }|null>}
 */
export async function maybeApplyHostedDelegationAfterApprove(ctx) {
  if (ctx.method !== 'POST' || !PROPOSAL_APPROVE_RE.test(ctx.pathOnly)) return null;
  if (ctx.upstreamStatus < 200 || ctx.upstreamStatus >= 300) return null;

  const proposalId = proposalIdFromApprovePath(ctx.pathOnly);
  if (!proposalId || !ctx.bridgeUrl || !ctx.canisterUrl) return null;

  const headers = {
    ...ctx.canisterAuthHeaders(),
    'X-User-Id': ctx.effectiveUserId,
    'X-Actor-Id': ctx.actorUserId,
    'X-Vault-Id': ctx.vaultId,
  };

  const fetched = await fetchCanisterProposalForDelegation({
    canisterUrl: ctx.canisterUrl,
    headers,
    proposalId,
  });
  if (!fetched.ok) return null;

  const intent = typeof fetched.proposal.intent === 'string' ? fetched.proposal.intent : '';
  if (!isDelegationProposalIntent(intent)) return null;

  const bridgeRes = await fetch(
    `${ctx.bridgeUrl.replace(/\/$/, '')}/api/v1/delegation/proposals/${encodeURIComponent(proposalId)}/apply-approved`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(ctx.authorization ? { Authorization: ctx.authorization } : {}),
        'X-Vault-Id': ctx.vaultId,
      },
      body: JSON.stringify({}),
    },
  );

  const text = await bridgeRes.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!bridgeRes.ok) {
    return {
      applied: false,
      error: typeof json.error === 'string' ? json.error : text.slice(0, 200),
      code: typeof json.code === 'string' ? json.code : 'DELEGATION_APPLY_FAILED',
    };
  }

  return {
    applied: true,
    payload: json && typeof json === 'object' ? /** @type {Record<string, unknown>} */ (json) : {},
  };
}

/**
 * Merge delegation apply outcome into canister approve JSON for the Hub client.
 *
 * @param {string} responseText
 * @param {{ applied: boolean, error?: string, code?: string, payload?: Record<string, unknown> }|null} applyOutcome
 * @returns {string}
 */
export function mergeDelegationApplyIntoApproveResponse(responseText, applyOutcome) {
  if (!applyOutcome) return responseText;
  try {
    const body = JSON.parse(responseText);
    if (!body || typeof body !== 'object') return responseText;
    body.delegation_index_applied = applyOutcome.applied;
    if (applyOutcome.applied && applyOutcome.payload) {
      body.delegation_apply = applyOutcome.payload;
    }
    if (!applyOutcome.applied) {
      body.delegation_apply_error = applyOutcome.error ?? 'Delegation index apply failed';
      body.delegation_apply_code = applyOutcome.code ?? 'DELEGATION_APPLY_FAILED';
    }
    return JSON.stringify(body);
  } catch {
    return responseText;
  }
}
