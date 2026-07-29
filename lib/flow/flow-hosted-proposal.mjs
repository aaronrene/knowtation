/**
 * Hosted Flow proposal parity (FLOW-WRITE-LIVE-GATEWAY-PROXY).
 *
 * Flow authoring proposals must live in the canister proposal store so Hub Activity
 * can list them and personal self-apply can admit §FWL.4.1 fingerprints. Canister
 * has no `source` / `flow_meta` columns — those ride in frontmatter (task pattern).
 *
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md
 * @see lib/task/task-hosted-proposal.mjs
 */

import { parseCanisterProposalGetBody } from '../canister-proposal-response-parse.mjs';

/** Must match `FLOW_PROPOSAL_SOURCE` in flow-authoring.mjs (avoid load cycle). */
export const FLOW_PROPOSAL_SOURCE = 'flow';

/** Frontmatter keys persisted on canister proposals. */
export const FM_PROPOSAL_SOURCE = 'knowtation_proposal_source';
export const FM_FLOW_KIND = 'flow_proposal_kind';
export const FM_FLOW_BASE_VERSION = 'flow_base_version';
export const FM_FLOW_BASE_STATE_ID = 'flow_base_state_id';
export const FM_FLOW_ID = 'flow_id';
export const FM_FLOW_VERSION = 'flow_version';
export const FM_FLOW_SCOPE = 'scope';

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
 * Embed Flow metadata in canister frontmatter JSON.
 *
 * @param {Record<string, unknown>|undefined|null} baseFm
 * @param {{
 *   kind: string,
 *   base_version?: string|null,
 *   base_state_id?: string|null,
 *   flow_id?: string|null,
 *   flow_version?: string|null,
 *   scope?: string|null,
 * }} flowMeta
 * @returns {Record<string, unknown>}
 */
export function mergeFlowFrontmatter(baseFm, flowMeta) {
  const fm = {
    ...(baseFm && typeof baseFm === 'object' && !Array.isArray(baseFm) ? baseFm : {}),
  };
  fm[FM_PROPOSAL_SOURCE] = FLOW_PROPOSAL_SOURCE;
  fm.type = 'flow';
  fm[FM_FLOW_KIND] = String(flowMeta.kind || '').slice(0, 16);
  if (flowMeta.base_version != null && String(flowMeta.base_version).trim()) {
    fm[FM_FLOW_BASE_VERSION] = String(flowMeta.base_version).slice(0, 32);
  }
  if (flowMeta.base_state_id != null && String(flowMeta.base_state_id).trim()) {
    fm[FM_FLOW_BASE_STATE_ID] = String(flowMeta.base_state_id).slice(0, 96);
  }
  if (flowMeta.flow_id != null) {
    fm[FM_FLOW_ID] = String(flowMeta.flow_id).slice(0, 80);
  }
  if (flowMeta.flow_version != null) {
    fm[FM_FLOW_VERSION] = String(flowMeta.flow_version).slice(0, 32);
  }
  if (flowMeta.scope != null) {
    fm[FM_FLOW_SCOPE] = String(flowMeta.scope).slice(0, 16);
  }
  return fm;
}

/**
 * Map a canister proposal row into the shape self-apply / precheck expect
 * (`source: flow` + `flow_meta`).
 *
 * @param {Record<string, unknown>} proposal
 * @returns {Record<string, unknown>|null}
 */
export function normalizeCanisterProposalForFlowPrecheck(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;

  const fm = parseProposalFrontmatter(proposal.frontmatter);
  const fromFm = fm[FM_PROPOSAL_SOURCE] === FLOW_PROPOSAL_SOURCE;
  const fromSource = proposal.source === FLOW_PROPOSAL_SOURCE;
  const path =
    typeof proposal.path === 'string' &&
    proposal.path.replace(/^\/+/, '').startsWith('meta/flows/');

  if (!fromFm && !fromSource && !path) return null;

  const kindRaw =
    (typeof fm[FM_FLOW_KIND] === 'string' && fm[FM_FLOW_KIND].trim()) ||
    (proposal.flow_meta &&
      typeof proposal.flow_meta === 'object' &&
      typeof /** @type {{ kind?: unknown }} */ (proposal.flow_meta).kind === 'string' &&
      String(/** @type {{ kind: string }} */ (proposal.flow_meta).kind).trim()) ||
    '';

  if (!kindRaw) return null;

  const baseVersion =
    (typeof fm[FM_FLOW_BASE_VERSION] === 'string' && fm[FM_FLOW_BASE_VERSION].trim()) ||
    (proposal.flow_meta &&
      typeof proposal.flow_meta === 'object' &&
      /** @type {{ base_version?: unknown }} */ (proposal.flow_meta).base_version != null
      ? String(/** @type {{ base_version: unknown }} */ (proposal.flow_meta).base_version)
      : null);

  const baseStateId =
    (typeof fm[FM_FLOW_BASE_STATE_ID] === 'string' && fm[FM_FLOW_BASE_STATE_ID].trim()) ||
    (proposal.flow_meta &&
      typeof proposal.flow_meta === 'object' &&
      typeof /** @type {{ base_state_id?: unknown }} */ (proposal.flow_meta).base_state_id ===
        'string'
      ? String(/** @type {{ base_state_id: string }} */ (proposal.flow_meta).base_state_id)
      : '');

  return {
    ...proposal,
    source: FLOW_PROPOSAL_SOURCE,
    flow_meta: {
      kind: kindRaw,
      base_version: baseVersion,
      base_state_id: baseStateId,
    },
  };
}

/**
 * POST a Flow proposal to the canister (hosted bridge propose path).
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
 *     external_ref?: string,
 *     flow_meta?: {
 *       kind: string,
 *       base_version?: string|null,
 *       base_state_id?: string,
 *     },
 *     vault_id?: string,
 *     review_queue?: string,
 *     proposed_by?: string,
 *   },
 * }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createFlowProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted flow proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const flowMeta = input.flow_meta ?? { kind: '' };
  const frontmatter = mergeFlowFrontmatter(input.frontmatter, {
    kind: flowMeta.kind,
    base_version: flowMeta.base_version,
    base_state_id: flowMeta.base_state_id ?? input.base_state_id,
    flow_id:
      input.frontmatter && typeof input.frontmatter.flow_id === 'string'
        ? input.frontmatter.flow_id
        : null,
    flow_version:
      input.frontmatter && typeof input.frontmatter.flow_version === 'string'
        ? input.frontmatter.flow_version
        : null,
    scope:
      input.frontmatter && typeof input.frontmatter.scope === 'string'
        ? input.frontmatter.scope
        : null,
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
  if (input.external_ref) payload.external_ref = input.external_ref;

  const { applyPersonalSelfApplyEvaluationE1 } = await import('../hub-proposal-personal-self-apply.mjs');
  const e1Body = applyPersonalSelfApplyEvaluationE1(
    {
      ...payload,
      source: FLOW_PROPOSAL_SOURCE,
      flow_meta: {
        kind: flowMeta.kind,
        base_version: flowMeta.base_version ?? null,
        base_state_id: flowMeta.base_state_id ?? input.base_state_id ?? '',
      },
      external_ref: input.external_ref,
      status: 'proposed',
    },
    {
      evaluatedBy: typeof input.proposed_by === 'string' ? input.proposed_by : '',
      authorActorId: typeof input.proposed_by === 'string' ? input.proposed_by : '',
      sessionBound: opts.sessionBound === true,
    },
  );
  if (e1Body.evaluation_status === 'passed') {
    payload.evaluation_status = 'passed';
    if (e1Body.evaluated_by) payload.evaluated_by = e1Body.evaluated_by;
    if (e1Body.evaluated_at) payload.evaluated_at = e1Body.evaluated_at;
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
    base_state_id: input.base_state_id,
    external_ref: input.external_ref,
    source: FLOW_PROPOSAL_SOURCE,
    flow_meta: {
      kind: flowMeta.kind,
      base_version: flowMeta.base_version ?? null,
      base_state_id: flowMeta.base_state_id ?? input.base_state_id ?? '',
    },
    review_queue: input.review_queue,
    proposed_by: input.proposed_by,
    evaluation_status: e1Body.evaluation_status,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch one proposal from the canister and normalize for Flow self-apply / precheck.
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 * }} opts
 * @returns {Promise<{ ok: true, proposal: Record<string, unknown> } | { ok: false }>}
 */
export async function fetchCanisterProposalForFlow(opts) {
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
    const normalized = normalizeCanisterProposalForFlowPrecheck(parsed);
    return { ok: true, proposal: normalized ?? parsed };
  } catch {
    return { ok: false };
  }
}
