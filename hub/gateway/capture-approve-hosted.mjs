/**
 * Gateway hook: after canister proposal approve, apply bridge capture indexes
 * (CAPTURE-HOSTED-APPLY-KN-b / CHA-C1 — parity with task/delegation hooks).
 *
 * Hosted canister approve commits BEFORE this hook runs (CHA-C11): a precheck or
 * apply failure after a successful approve yields an approved proposal with no
 * Flow, surfaced honestly as `capture_index_applied: false`. Ops may re-call the
 * bridge apply-approved route after fixing store state.
 *
 * T5 / personal self-apply stays refuse-all for capture (SD-23) — this hook only
 * runs after `assertHostedProposalApproveDiscard` allowed the approve.
 */

import { proposalIdFromApprovePath } from '../../lib/muse-thin-bridge.mjs';
import {
  fetchCanisterProposalForCapture,
  normalizeCanisterProposalForCapturePrecheck,
} from '../../lib/flow/flow-capture-hosted-proposal.mjs';

const PROPOSAL_APPROVE_RE = /^\/api\/v1\/proposals\/[^/]+\/approve\/?$/;

/**
 * @param {Record<string, unknown>} proposal
 * @returns {boolean}
 */
function isCaptureProposal(proposal) {
  return normalizeCanisterProposalForCapturePrecheck(proposal) != null;
}

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
export async function maybeApplyHostedCaptureAfterApprove(ctx) {
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

  const fetched = await fetchCanisterProposalForCapture({
    canisterUrl: ctx.canisterUrl,
    headers,
    proposalId,
  });
  if (!fetched.ok) return null;
  if (!isCaptureProposal(fetched.proposal)) return null;

  const bridgeRes = await fetch(
    `${ctx.bridgeUrl.replace(/\/$/, '')}/api/v1/flows/capture/proposals/${encodeURIComponent(proposalId)}/apply-approved`,
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
      code: typeof json.code === 'string' ? json.code : 'CAPTURE_APPLY_FAILED',
    };
  }

  return {
    applied: true,
    payload: json && typeof json === 'object' ? /** @type {Record<string, unknown>} */ (json) : {},
  };
}

/**
 * Merge capture apply outcome into canister approve JSON for the Hub client (CHA-C1).
 *
 * @param {string} responseText
 * @param {{ applied: boolean, error?: string, code?: string, payload?: Record<string, unknown> }|null} applyOutcome
 * @returns {string}
 */
export function mergeCaptureApplyIntoApproveResponse(responseText, applyOutcome) {
  if (!applyOutcome) return responseText;
  try {
    const body = JSON.parse(responseText);
    if (!body || typeof body !== 'object') return responseText;
    body.capture_index_applied = applyOutcome.applied;
    if (applyOutcome.applied && applyOutcome.payload) {
      body.capture_apply = applyOutcome.payload;
    }
    if (!applyOutcome.applied) {
      body.capture_apply_error = applyOutcome.error ?? 'Capture apply failed';
      body.capture_apply_code = applyOutcome.code ?? 'CAPTURE_APPLY_FAILED';
    }
    return JSON.stringify(body);
  } catch {
    return responseText;
  }
}
