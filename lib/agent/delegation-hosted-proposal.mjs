/**
 * Hosted delegation proposal parity (Phase 7C-L1b).
 *
 * Delegation identity/consent proposals must live in the canister proposal store so Hub
 * Activity/Suggested tabs can list them. Approve still applies bridge-side delegation
 * indexes via {@link applyApprovedDelegationProposalFromCanister}.
 *
 * @see docs/AGENT-DELEGATION-V0-SPEC.md — SD-4 review-before-write
 */

import { parseCanisterProposalGetBody } from '../canister-proposal-response-parse.mjs';
import {
  DELEGATION_PROPOSAL_SOURCE,
  precheckApprovedDelegationProposal,
  applyDelegationProposalToIndex,
  getAgentIdentity,
  getConsent,
} from './delegation.mjs';

/** Intents that require bridge delegation index apply on approve. */
export const DELEGATION_PROPOSAL_INTENTS = new Set([
  'agent_identity_register',
  'delegation_consent_create',
]);

/** Frontmatter keys persisted on canister proposals (canister has no delegation_meta column). */
export const FM_PROPOSAL_SOURCE = 'knowtation_proposal_source';
export const FM_RECORD_KIND = 'delegation_record_kind';
export const FM_AGENT_ID = 'delegation_agent_id';
export const FM_CONSENT_ID = 'delegation_consent_id';

/**
 * @param {string} intent
 * @returns {boolean}
 */
export function isDelegationProposalIntent(intent) {
  return typeof intent === 'string' && DELEGATION_PROPOSAL_INTENTS.has(intent);
}

/**
 * @param {string} intent
 * @returns {'agent_identity'|'delegation_consent'|''}
 */
export function delegationRecordKindFromIntent(intent) {
  if (intent === 'agent_identity_register') return 'agent_identity';
  if (intent === 'delegation_consent_create') return 'delegation_consent';
  return '';
}

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
 * Embed delegation metadata in canister frontmatter JSON.
 *
 * @param {Record<string, unknown>|undefined|null} baseFm
 * @param {{ record_kind: string, agent_id?: string, consent_id?: string }} delegationMeta
 * @returns {Record<string, unknown>}
 */
export function mergeDelegationFrontmatter(baseFm, delegationMeta) {
  const fm = {
    ...(baseFm && typeof baseFm === 'object' && !Array.isArray(baseFm) ? baseFm : {}),
  };
  fm[FM_PROPOSAL_SOURCE] = DELEGATION_PROPOSAL_SOURCE;
  fm[FM_RECORD_KIND] = String(delegationMeta.record_kind || '').slice(0, 32);
  if (delegationMeta.agent_id != null) {
    fm[FM_AGENT_ID] = String(delegationMeta.agent_id).slice(0, 64);
  }
  if (delegationMeta.consent_id != null) {
    fm[FM_CONSENT_ID] = String(delegationMeta.consent_id).slice(0, 64);
  }
  return fm;
}

/**
 * Map a canister proposal GET/list row into the shape `precheckApprovedDelegationProposal` expects.
 *
 * @param {Record<string, unknown>} proposal
 * @returns {Record<string, unknown>|null}
 */
export function normalizeCanisterProposalForDelegationPrecheck(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;

  const fm = parseProposalFrontmatter(proposal.frontmatter);
  const intent = typeof proposal.intent === 'string' ? proposal.intent : '';
  const fromFm = fm[FM_PROPOSAL_SOURCE] === DELEGATION_PROPOSAL_SOURCE;
  const fromIntent = isDelegationProposalIntent(intent);

  if (!fromFm && !fromIntent && proposal.source !== DELEGATION_PROPOSAL_SOURCE) {
    return null;
  }

  /** @type {{ record_kind: string, agent_id?: string, consent_id?: string }} */
  const delegation_meta = {
    record_kind:
      (typeof fm[FM_RECORD_KIND] === 'string' && fm[FM_RECORD_KIND].trim()) ||
      delegationRecordKindFromIntent(intent) ||
      (proposal.delegation_meta &&
      typeof proposal.delegation_meta === 'object' &&
      typeof /** @type {{ record_kind?: string }} */ (proposal.delegation_meta).record_kind === 'string'
        ? /** @type {{ record_kind: string }} */ (proposal.delegation_meta).record_kind
        : ''),
  };
  if (typeof fm[FM_AGENT_ID] === 'string' && fm[FM_AGENT_ID].trim()) {
    delegation_meta.agent_id = fm[FM_AGENT_ID].trim();
  }
  if (typeof fm[FM_CONSENT_ID] === 'string' && fm[FM_CONSENT_ID].trim()) {
    delegation_meta.consent_id = fm[FM_CONSENT_ID].trim();
  }

  if (!delegation_meta.record_kind) return null;

  return {
    ...proposal,
    source: DELEGATION_PROPOSAL_SOURCE,
    delegation_meta,
  };
}

/**
 * POST a delegation proposal to the canister (hosted bridge propose path).
 *
 * Parity with task/media hosted proposals: merge hosted evaluation policy + review
 * triggers before canister POST (gateway uses the same augment on proxied creates).
 * Delegation surface never E1 self-passes; proposals stay pending for Hub review.
 *
 * @param {{
 *   canisterUrl: string,
 *   dataDir?: string,
 *   sessionBound?: boolean,
 *   headers: Record<string, string>,
 *   input: {
 *     path: string,
 *     body?: string,
 *     intent?: string,
 *     frontmatter?: Record<string, unknown>,
 *     delegation_meta?: { record_kind: string, agent_id?: string, consent_id?: string },
 *     vault_id?: string,
 *     review_queue?: string,
 *     proposed_by?: string,
 *   },
 * }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createDelegationProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted delegation proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const frontmatter = mergeDelegationFrontmatter(input.frontmatter, input.delegation_meta ?? { record_kind: '' });
  const proposedBy =
    typeof input.proposed_by === 'string' && input.proposed_by.trim() ? input.proposed_by.trim() : '';
  /** @type {Record<string, unknown>} */
  let payload = {
    path: input.path,
    body: input.body ?? '',
    intent: input.intent ?? '',
    frontmatter,
    source: DELEGATION_PROPOSAL_SOURCE,
  };
  if (input.review_queue) payload.review_queue = input.review_queue;

  const dataDir = typeof opts.dataDir === 'string' ? opts.dataDir.trim() : '';
  if (dataDir) {
    const { augmentProposalCreateRequestBody } = await import('../hub-proposal-create-augment.mjs');
    payload = augmentProposalCreateRequestBody(payload, dataDir, {
      evaluatedBy: proposedBy || undefined,
      sessionBound: opts.sessionBound === true,
      authorActorId: proposedBy || undefined,
    });
  }
  // Delegation proposals always require human review (SD-4); never leave eval unset.
  if (String(payload.evaluation_status ?? '').trim() !== 'passed') {
    payload.evaluation_status = 'pending';
  }

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
    source: DELEGATION_PROPOSAL_SOURCE,
    delegation_meta: input.delegation_meta,
    review_queue: input.review_queue,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch one proposal from the canister and normalize for delegation apply.
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 * }} opts
 * @returns {Promise<{ ok: true, proposal: Record<string, unknown> } | { ok: false, status: number, code: string, error: string }>}
 */
export async function fetchCanisterProposalForDelegation(opts) {
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
  const normalized = normalizeCanisterProposalForDelegationPrecheck(raw);
  if (!normalized) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Not a delegation proposal' };
  }
  return { ok: true, proposal: normalized };
}

/**
 * Apply an approved canister delegation proposal to bridge delegation indexes.
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
export async function applyApprovedDelegationProposalFromCanister(opts) {
  const fetched = await fetchCanisterProposalForDelegation({
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
      error: 'Proposal must be approved before delegation index apply',
    };
  }

  const precheck = precheckApprovedDelegationProposal(opts.dataDir, proposal, {
    author: typeof proposal.created_by === 'string' ? proposal.created_by : '',
  });
  if (!precheck.ok) {
    if (precheck.code === 'CONFLICT') {
      const meta = proposal.delegation_meta;
      if (meta && typeof meta === 'object') {
        const vaultId =
          typeof proposal.vault_id === 'string' && proposal.vault_id.trim()
            ? proposal.vault_id.trim()
            : 'default';
        if (meta.record_kind === 'agent_identity' && typeof meta.agent_id === 'string') {
          const existing = getAgentIdentity(opts.dataDir, String(vaultId), meta.agent_id);
          if (existing && existing.status === 'active') {
            return {
              ok: true,
              payload: { applied: true, idempotent: true, record_kind: 'agent_identity', proposal_id: opts.proposalId },
            };
          }
        }
        if (meta.record_kind === 'delegation_consent' && typeof meta.consent_id === 'string') {
          const existing = getConsent(opts.dataDir, String(vaultId), meta.consent_id);
          if (existing && existing.status === 'active') {
            return {
              ok: true,
              payload: {
                applied: true,
                idempotent: true,
                record_kind: 'delegation_consent',
                proposal_id: opts.proposalId,
              },
            };
          }
        }
      }
    }
    return precheck;
  }

  applyDelegationProposalToIndex(opts.dataDir, precheck);
  return {
    ok: true,
    payload: {
      applied: true,
      record_kind: precheck.recordKind,
      proposal_id: opts.proposalId,
      vault_id: precheck.vaultId,
    },
  };
}
