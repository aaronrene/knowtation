/**
 * Hosted Flow capture proposal parity (FLOW-CAPTURE-LIVE-KN-b).
 *
 * Capture proposals (`source: flow_capture`) must live in the canister proposal store
 * so Hub Activity can list them. Wave 2 keeps T5 personal self-apply closed
 * (`SELF_APPLY_NOT_ADMITTED` — FCL-C3 / SD-23). Canister has no `source` /
 * `capture_meta` columns — those ride in frontmatter (task/flow pattern).
 *
 * @see docs/FLOW-CAPTURE-FLYWHEEL-CONTRACT-7A-L4.md
 * @see lib/flow/flow-hosted-proposal.mjs
 */

import { parseCanisterProposalGetBody } from '../canister-proposal-response-parse.mjs';

/** Must match `FLOW_CAPTURE_PROPOSAL_SOURCE` in flow-capture.mjs (avoid load cycle). */
export const FLOW_CAPTURE_PROPOSAL_SOURCE = 'flow_capture';

/** Frontmatter keys persisted on canister proposals. */
export const FM_PROPOSAL_SOURCE = 'knowtation_proposal_source';
export const FM_CAPTURE_PROPOSAL_KIND = 'capture_proposal_kind';
export const FM_CAPTURE_CANDIDATE_ID = 'capture_candidate_id';
export const FM_CAPTURE_CONFIRMED_SCOPE = 'capture_confirmed_scope';
export const FM_CAPTURE_MERGE_INTO_FLOW_ID = 'capture_merge_into_flow_id';

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
 * Embed capture metadata in canister frontmatter JSON.
 *
 * @param {Record<string, unknown>|undefined|null} baseFm
 * @param {{
 *   proposal_kind: string,
 *   candidate_id: string,
 *   confirmed_scope?: string|null,
 *   merge_into_flow_id?: string|null,
 * }} captureMeta
 * @returns {Record<string, unknown>}
 */
export function mergeCaptureFrontmatter(baseFm, captureMeta) {
  const fm = {
    ...(baseFm && typeof baseFm === 'object' && !Array.isArray(baseFm) ? baseFm : {}),
  };
  fm[FM_PROPOSAL_SOURCE] = FLOW_CAPTURE_PROPOSAL_SOURCE;
  fm.type = 'flow_capture';
  fm[FM_CAPTURE_PROPOSAL_KIND] = String(captureMeta.proposal_kind || '').slice(0, 32);
  fm[FM_CAPTURE_CANDIDATE_ID] = String(captureMeta.candidate_id || '').slice(0, 48);
  if (captureMeta.confirmed_scope != null && String(captureMeta.confirmed_scope).trim()) {
    fm[FM_CAPTURE_CONFIRMED_SCOPE] = String(captureMeta.confirmed_scope).slice(0, 16);
  }
  if (captureMeta.merge_into_flow_id != null && String(captureMeta.merge_into_flow_id).trim()) {
    fm[FM_CAPTURE_MERGE_INTO_FLOW_ID] = String(captureMeta.merge_into_flow_id).slice(0, 80);
  }
  return fm;
}

/**
 * Map a canister proposal row into the shape capture precheck / seam expect
 * (`source: flow_capture` + `capture_meta`).
 *
 * @param {Record<string, unknown>} proposal
 * @returns {Record<string, unknown>|null}
 */
export function normalizeCanisterProposalForCapturePrecheck(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;

  const fm = parseProposalFrontmatter(proposal.frontmatter);
  const fromFm = fm[FM_PROPOSAL_SOURCE] === FLOW_CAPTURE_PROPOSAL_SOURCE;
  const fromSource = proposal.source === FLOW_CAPTURE_PROPOSAL_SOURCE;
  const path =
    typeof proposal.path === 'string' &&
    proposal.path.replace(/^\/+/, '').startsWith('meta/candidates/');

  if (!fromFm && !fromSource && !path) return null;

  const kindRaw =
    (typeof fm[FM_CAPTURE_PROPOSAL_KIND] === 'string' && fm[FM_CAPTURE_PROPOSAL_KIND].trim()) ||
    (typeof fm.proposal_kind === 'string' && fm.proposal_kind.trim()) ||
    (proposal.capture_meta &&
      typeof proposal.capture_meta === 'object' &&
      typeof /** @type {{ proposal_kind?: unknown }} */ (proposal.capture_meta).proposal_kind ===
        'string'
      ? String(/** @type {{ proposal_kind: string }} */ (proposal.capture_meta).proposal_kind).trim()
      : '') ||
    '';

  const candidateId =
    (typeof fm[FM_CAPTURE_CANDIDATE_ID] === 'string' && fm[FM_CAPTURE_CANDIDATE_ID].trim()) ||
    (typeof fm.candidate_id === 'string' && fm.candidate_id.trim()) ||
    (proposal.capture_meta &&
      typeof proposal.capture_meta === 'object' &&
      typeof /** @type {{ candidate_id?: unknown }} */ (proposal.capture_meta).candidate_id ===
        'string'
      ? String(/** @type {{ candidate_id: string }} */ (proposal.capture_meta).candidate_id).trim()
      : '') ||
    '';

  if (!kindRaw || !candidateId) return null;

  /** @type {{ proposal_kind: string, candidate_id: string, confirmed_scope?: string, merge_into_flow_id?: string|null }} */
  const capture_meta = {
    proposal_kind: kindRaw,
    candidate_id: candidateId,
  };

  const confirmed =
    (typeof fm[FM_CAPTURE_CONFIRMED_SCOPE] === 'string' && fm[FM_CAPTURE_CONFIRMED_SCOPE].trim()) ||
    (proposal.capture_meta &&
      typeof proposal.capture_meta === 'object' &&
      typeof /** @type {{ confirmed_scope?: unknown }} */ (proposal.capture_meta).confirmed_scope ===
        'string'
      ? String(/** @type {{ confirmed_scope: string }} */ (proposal.capture_meta).confirmed_scope)
      : '');
  if (confirmed) capture_meta.confirmed_scope = confirmed;

  const mergeInto =
    (typeof fm[FM_CAPTURE_MERGE_INTO_FLOW_ID] === 'string' &&
      fm[FM_CAPTURE_MERGE_INTO_FLOW_ID].trim()) ||
    (proposal.capture_meta &&
      typeof proposal.capture_meta === 'object' &&
      /** @type {{ merge_into_flow_id?: unknown }} */ (proposal.capture_meta).merge_into_flow_id !=
        null
      ? String(
          /** @type {{ merge_into_flow_id: unknown }} */ (proposal.capture_meta).merge_into_flow_id,
        )
      : '');
  if (mergeInto) capture_meta.merge_into_flow_id = mergeInto;

  return {
    ...proposal,
    source: FLOW_CAPTURE_PROPOSAL_SOURCE,
    capture_meta,
  };
}

/**
 * POST a Flow capture proposal to the canister (hosted bridge propose/dismiss path).
 *
 * Does NOT call E1 evaluation satisfaction for capture — Wave 2 keeps capture
 * out of personal self-apply admission (FCL-C3).
 *
 * @param {{
 *   canisterUrl: string,
 *   sessionBound?: boolean,
 *   headers: Record<string, string>,
 *   input: {
 *     path: string,
 *     body?: string,
 *     intent?: string,
 *     frontmatter?: Record<string, unknown>,
 *     base_state_id?: string,
 *     capture_meta?: {
 *       proposal_kind: string,
 *       candidate_id: string,
 *       confirmed_scope?: string,
 *       merge_into_flow_id?: string|null,
 *     },
 *     vault_id?: string,
 *     review_queue?: string,
 *     proposed_by?: string,
 *   },
 * }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createCaptureProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted capture proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const captureMeta = input.capture_meta ?? {
    proposal_kind: '',
    candidate_id: '',
  };
  const frontmatter = mergeCaptureFrontmatter(input.frontmatter, {
    proposal_kind: captureMeta.proposal_kind,
    candidate_id: captureMeta.candidate_id,
    confirmed_scope: captureMeta.confirmed_scope,
    merge_into_flow_id: captureMeta.merge_into_flow_id,
  });

  /** @type {Record<string, unknown>} */
  const payload = {
    path: input.path,
    body: input.body ?? '',
    intent: input.intent ?? '',
    frontmatter,
  };
  if (input.base_state_id) payload.base_state_id = input.base_state_id;
  if (input.review_queue) payload.review_queue = input.review_queue;

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
    base_state_id: input.base_state_id,
    source: FLOW_CAPTURE_PROPOSAL_SOURCE,
    capture_meta: {
      proposal_kind: captureMeta.proposal_kind,
      candidate_id: captureMeta.candidate_id,
      ...(captureMeta.confirmed_scope != null
        ? { confirmed_scope: captureMeta.confirmed_scope }
        : {}),
      ...(captureMeta.merge_into_flow_id !== undefined
        ? { merge_into_flow_id: captureMeta.merge_into_flow_id }
        : {}),
    },
    review_queue: input.review_queue,
    proposed_by: input.proposed_by,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch one proposal from the canister and normalize for capture precheck / seam.
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 * }} opts
 * @returns {Promise<{ ok: true, proposal: Record<string, unknown> } | { ok: false }>}
 */
export async function fetchCanisterProposalForCapture(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base || !opts.proposalId) return { ok: false };
  try {
    const res = await fetch(
      `${base}/api/v1/proposals/${encodeURIComponent(opts.proposalId)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...opts.headers,
        },
      },
    );
    if (!res.ok) return { ok: false };
    const text = await res.text();
    const parsed = parseCanisterProposalGetBody(opts.proposalId, text, {});
    if (!parsed || typeof parsed !== 'object') return { ok: false };
    const normalized = normalizeCanisterProposalForCapturePrecheck(parsed);
    return { ok: true, proposal: normalized ?? parsed };
  } catch {
    return { ok: false };
  }
}
