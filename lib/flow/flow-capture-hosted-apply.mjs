/**
 * Hosted Flow capture Hub-complete apply (CAPTURE-HOSTED-APPLY-KN-b / CHA-C2).
 *
 * After an admin / permitted-evaluator approve on the hosted canister, the bridge
 * applies the capture proposal to `hub_flow_store.json` using the SAME
 * `precheckApprovedCaptureProposal` + `applyCaptureProposal` pair as self-hosted
 * Hub approve (`hub/server.mjs`) — no hosted-only precheck fork (CHA-C3).
 *
 * Lives in a sibling module (not `flow-capture-hosted-proposal.mjs`) because
 * importing `flow-capture.mjs` from that module would create the load cycle
 * flow-capture → proposals-store → hub-proposal-personal-self-apply →
 * flow-capture-hosted-proposal. Nothing in that graph imports this module.
 *
 * T5 / personal self-apply stays refuse-all (`SELF_APPLY_NOT_ADMITTED` — SD-23);
 * this helper is only reachable through Hub-complete approve authority.
 *
 * @see docs/CAPTURE-HOSTED-APPLY-FREEZE.md §CHA.2
 * @see lib/task/task-hosted-proposal.mjs applyApprovedTaskProposalFromCanister
 */

import {
  precheckApprovedCaptureProposal,
  applyCaptureProposal,
} from './flow-capture.mjs';
import {
  fetchCanisterProposalForCapture,
  normalizeCanisterProposalForCapturePrecheck,
} from './flow-capture-hosted-proposal.mjs';

/**
 * Apply an approved canister capture proposal to the bridge flow store.
 *
 * Ordered per CHA-C2: fetch → capture-classify (400) → approved gate (409) →
 * shared precheck (refusal passthrough, no store mutate) → shared apply.
 * The canister proposal `body` string is passed through intact (CHA-C10) —
 * `precheckApprovedCaptureProposal` parses it; empty/missing body refuses
 * `FLOW_DRAFT_INVALID` without mutating the store.
 *
 * Blob hydrate/persist is the caller's job (bridge route wraps this in
 * `withExternalProtocolBlobSync` — CHA-C3 cold-lambda candidate visibility).
 *
 * @param {{
 *   dataDir: string,
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 *   requireApproved?: boolean,
 * }} opts
 * @returns {Promise<{ ok: true, payload: Record<string, unknown> } | { ok: false, status: number, code: string, error: string }>}
 */
export async function applyApprovedCaptureProposalFromCanister(opts) {
  const proposalId = String(opts.proposalId || '').trim();
  if (!opts.canisterUrl || !proposalId) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'canisterUrl and proposalId required' };
  }

  const fetched = await fetchCanisterProposalForCapture({
    canisterUrl: opts.canisterUrl,
    headers: opts.headers,
    proposalId,
  });
  if (!fetched.ok) {
    return { ok: false, status: 502, code: 'BAD_GATEWAY', error: 'Canister proposal fetch failed' };
  }

  const proposal = normalizeCanisterProposalForCapturePrecheck(fetched.proposal);
  if (!proposal) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Not a flow capture proposal' };
  }

  if (opts.requireApproved !== false && proposal.status !== 'approved') {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      error: 'Proposal must be approved before capture apply',
    };
  }

  const precheck = precheckApprovedCaptureProposal(opts.dataDir, proposal);
  if (!precheck.ok) {
    return {
      ok: false,
      status: precheck.status,
      code: precheck.code,
      error: precheck.error,
    };
  }

  const result = applyCaptureProposal(opts.dataDir, precheck);
  return {
    ok: true,
    payload: {
      applied: true,
      proposal_id: proposalId,
      vault_id: precheck.vaultId,
      proposal_kind: precheck.proposalKind,
      candidate_id: precheck.candidateId,
      apply_result: result.applied,
      ...(result.applied === 'promote'
        ? { flow_id: result.flow_id, scope: result.scope }
        : {}),
      ...(result.applied === 'merge'
        ? { merge_into_flow_id: result.merge_into_flow_id }
        : {}),
      ...(result.applied === 'dismiss' ? { dismissed: true } : {}),
    },
  };
}
