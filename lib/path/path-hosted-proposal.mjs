/**
 * Hosted learning-path proposal parity (KN-WORK-PATH-LIST-b).
 *
 * Path write proposals live in the canister proposal store. Approve apply runs via
 * POST …/learning-paths/proposals/:id/apply-approved (gateway hook after approve)
 * into bridge hub_flow_store.json learning_paths[].
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §4.4
 */

import { parseCanisterProposalGetBody } from '../canister-proposal-response-parse.mjs';
import {
  PATH_PROPOSAL_SOURCE,
  PATH_REVIEW_QUEUE,
  PATH_PROPOSAL_KINDS,
  getPathWritesEnabled,
  precheckApprovedPathProposal,
  reconcileApprovedPathProposal,
} from './path-write.mjs';

export const FM_PROPOSAL_SOURCE = 'knowtation_proposal_source';
export const FM_PATH_PROPOSAL_KIND = 'path_proposal_kind';
export const FM_PATH_ID = 'path_id';

/**
 * @param {unknown} frontmatter
 * @returns {Record<string, unknown>}
 */
export function parseProposalFrontmatter(frontmatter) {
  if (frontmatter == null) return {};
  if (typeof frontmatter === 'object' && !Array.isArray(frontmatter)) {
    return /** @type {Record<string, unknown>} */ (frontmatter);
  }
  if (typeof frontmatter === 'string' && frontmatter.trim()) {
    try {
      const parsed = JSON.parse(frontmatter);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? /** @type {Record<string, unknown>} */ (parsed)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function readProposalKind(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Map a canister/self-hosted proposal into the shape precheckApprovedPathProposal expects.
 * Returns null unless this is a learning-path proposal (source, review_queue, or mirror path).
 *
 * @param {Record<string, unknown>} proposal
 * @returns {Record<string, unknown>|null}
 */
export function normalizeCanisterProposalForPathPrecheck(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;

  const fm = parseProposalFrontmatter(proposal.frontmatter);
  const fromFm = fm[FM_PROPOSAL_SOURCE] === PATH_PROPOSAL_SOURCE;
  const fromSource = proposal.source === PATH_PROPOSAL_SOURCE;
  const fromQueue = proposal.review_queue === PATH_REVIEW_QUEUE || fm.review_queue === PATH_REVIEW_QUEUE;
  const path =
    typeof proposal.path === 'string' &&
    proposal.path.replace(/^\/+/, '').startsWith('meta/learning-paths/proposals/');

  if (!fromFm && !fromSource && !fromQueue && !path) return null;

  let proposalKind =
    readProposalKind(fm[FM_PATH_PROPOSAL_KIND]) ||
    readProposalKind(fm.proposal_kind) ||
    '';
  if (!proposalKind) {
    try {
      const parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
      if (parsed && typeof parsed === 'object' && typeof parsed.proposal_kind === 'string') {
        proposalKind = parsed.proposal_kind.trim();
      }
    } catch {
      // ignore
    }
  }

  return {
    ...proposal,
    source: PATH_PROPOSAL_SOURCE,
    review_queue: PATH_REVIEW_QUEUE,
    frontmatter: {
      ...fm,
      [FM_PROPOSAL_SOURCE]: PATH_PROPOSAL_SOURCE,
      proposal_kind: proposalKind,
      [FM_PATH_PROPOSAL_KIND]: proposalKind,
    },
  };
}

/**
 * Hosted hook classify: review_queue === learning-path AND kind in the closed allowlist.
 *
 * @param {Record<string, unknown>} proposal
 * @returns {boolean}
 */
export function isPathProposalForHostedApply(proposal) {
  const normalized = normalizeCanisterProposalForPathPrecheck(proposal);
  if (!normalized) return false;
  const queue = normalized.review_queue === PATH_REVIEW_QUEUE;
  const fm = parseProposalFrontmatter(normalized.frontmatter);
  let kind = readProposalKind(fm.proposal_kind) || readProposalKind(fm[FM_PATH_PROPOSAL_KIND]);
  if (!kind) {
    try {
      const parsed = JSON.parse(typeof normalized.body === 'string' ? normalized.body : '');
      if (parsed && typeof parsed === 'object' && typeof parsed.proposal_kind === 'string') {
        kind = parsed.proposal_kind.trim();
      }
    } catch {
      kind = '';
    }
  }
  return queue && PATH_PROPOSAL_KINDS.includes(/** @type {typeof PATH_PROPOSAL_KINDS[number]} */ (kind));
}

/**
 * POST a path proposal to the canister (hosted bridge propose path).
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   sessionBound?: boolean,
 *   input: Record<string, unknown>,
 * }} opts
 */
export async function createPathProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted path proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const frontmatter = {
    ...(input.frontmatter && typeof input.frontmatter === 'object' ? input.frontmatter : {}),
    [FM_PROPOSAL_SOURCE]: PATH_PROPOSAL_SOURCE,
  };
  /** @type {Record<string, unknown>} */
  const payload = {
    path: input.path,
    body: input.body ?? '',
    intent: input.intent ?? '',
    frontmatter,
  };
  if (input.review_queue) payload.review_queue = input.review_queue;
  if (input.external_ref) payload.external_ref = input.external_ref;

  const res = await fetch(`${base}/api/v1/proposals`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = new Error(
      typeof json.error === 'string' ? json.error : text || `Canister proposal create ${res.status}`,
    );
    err.status = res.status;
    err.code = typeof json.code === 'string' ? json.code : 'UPSTREAM_ERROR';
    throw err;
  }

  const proposalId = typeof json.proposal_id === 'string' ? json.proposal_id : '';
  if (!proposalId) {
    const err = new Error('Canister proposal create missing proposal_id');
    err.status = 502;
    err.code = 'BAD_GATEWAY';
    throw err;
  }

  const now = new Date().toISOString();
  return {
    proposal_id: proposalId,
    path: typeof json.path === 'string' ? json.path : input.path,
    status: typeof json.status === 'string' ? json.status : 'proposed',
    vault_id: input.vault_id,
    intent: input.intent,
    body: input.body,
    frontmatter,
    external_ref: input.external_ref,
    source: PATH_PROPOSAL_SOURCE,
    review_queue: input.review_queue,
    proposed_by: input.proposed_by,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch one proposal from the canister and normalize for path apply.
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 * }} opts
 */
export async function fetchCanisterProposalForPath(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  const proposalId = String(opts.proposalId || '').trim();
  if (!base || !proposalId) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'canisterUrl and proposalId required' };
  }

  const res = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...opts.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 404 ? 404 : 502,
      code: res.status === 404 ? 'NOT_FOUND' : 'BAD_GATEWAY',
      error: text.slice(0, 200) || `Canister GET proposal ${res.status}`,
    };
  }

  const raw = parseCanisterProposalGetBody(proposalId, text, {});
  const normalized = normalizeCanisterProposalForPathPrecheck(raw);
  if (!normalized) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Not a path proposal' };
  }
  return { ok: true, proposal: normalized };
}

/**
 * Apply an approved canister path proposal to bridge hub_flow_store.json.
 *
 * @param {{
 *   dataDir: string,
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 *   requireApproved?: boolean,
 * }} opts
 */
export async function applyApprovedPathProposalFromCanister(opts) {
  if (!getPathWritesEnabled()) {
    return {
      ok: false,
      status: 403,
      code: 'PATH_WRITES_DISABLED',
      error: 'Path writes are disabled',
    };
  }

  const fetched = await fetchCanisterProposalForPath({
    canisterUrl: opts.canisterUrl,
    headers: opts.headers,
    proposalId: opts.proposalId,
  });
  if (!fetched.ok) return fetched;

  const proposal = fetched.proposal;
  if (opts.requireApproved !== false && proposal.status !== 'approved') {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      error: 'Proposal must be approved before path index apply',
    };
  }

  const precheck = precheckApprovedPathProposal(opts.dataDir, proposal);
  if (!precheck.ok) return precheck;

  const reconcile = reconcileApprovedPathProposal(opts.dataDir, precheck);
  return {
    ok: true,
    payload: {
      applied: true,
      proposal_id: opts.proposalId,
      vault_id: precheck.vaultId,
      proposal_kind: precheck.proposalKind,
      path_id: reconcile.path_id,
    },
  };
}
