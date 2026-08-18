/**
 * Gateway hook: after canister proposal approve, apply bridge learning-path indexes
 * (KN-WORK-PATH-LIST-b — parity with task/capture/media hooks).
 *
 * Returns null unless the fetched proposal is a path proposal
 * (review_queue === "learning-path" and proposal_kind in the closed allowlist).
 * Must not steal task / capture / media apply.
 */

import { proposalIdFromApprovePath } from '../../lib/muse-thin-bridge.mjs';
import {
  fetchCanisterProposalForPath,
  isPathProposalForHostedApply,
} from '../../lib/path/path-hosted-proposal.mjs';

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
export async function maybeApplyHostedPathAfterApprove(ctx) {
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

  const fetched = await fetchCanisterProposalForPath({
    canisterUrl: ctx.canisterUrl,
    headers,
    proposalId,
  });
  if (!fetched.ok) return null;
  if (!isPathProposalForHostedApply(fetched.proposal)) return null;

  const bridgeRes = await fetch(
    `${ctx.bridgeUrl.replace(/\/$/, '')}/api/v1/learning-paths/proposals/${encodeURIComponent(proposalId)}/apply-approved`,
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
      code: typeof json.code === 'string' ? json.code : 'PATH_APPLY_FAILED',
    };
  }

  return {
    applied: true,
    payload: json && typeof json === 'object' ? /** @type {Record<string, unknown>} */ (json) : {},
  };
}

/**
 * Merge path apply outcome into canister approve JSON for the Hub client.
 *
 * @param {string} responseText
 * @param {{ applied: boolean, error?: string, code?: string, payload?: Record<string, unknown> }|null} applyOutcome
 * @returns {string}
 */
export function mergePathApplyIntoApproveResponse(responseText, applyOutcome) {
  if (!applyOutcome) return responseText;
  try {
    const body = JSON.parse(responseText);
    if (!body || typeof body !== 'object') return responseText;
    body.path_index_applied = applyOutcome.applied;
    if (applyOutcome.applied && applyOutcome.payload) {
      body.path_apply = applyOutcome.payload;
    }
    if (!applyOutcome.applied) {
      body.path_apply_error = applyOutcome.error ?? 'Path index apply failed';
      body.path_apply_code = applyOutcome.code ?? 'PATH_APPLY_FAILED';
    }
    return JSON.stringify(body);
  } catch {
    return responseText;
  }
}
