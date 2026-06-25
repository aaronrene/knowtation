/**
 * Hosted task proposal parity (Phase 2G hosted route wire).
 *
 * Task write proposals must live in the canister proposal store so Hub Activity can
 * list them. Approve apply runs via POST …/tasks/proposals/:id/apply-approved (gateway
 * hook after approve) into bridge hub_flow_store.json.
 *
 * @see docs/TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md — SD-4 review-before-write
 */

import { parseCanisterProposalGetBody } from '../canister-proposal-response-parse.mjs';
import {
  TASK_PROPOSAL_SOURCE,
  precheckApprovedTaskProposal,
  reconcileApprovedTaskProposal,
} from './task-write.mjs';

export const FM_PROPOSAL_SOURCE = 'knowtation_proposal_source';
export const FM_TASK_RECORD_KIND = 'task_record_kind';
export const FM_TASK_PROPOSAL_KIND = 'task_proposal_kind';
export const FM_TASK_ID = 'task_id';
export const FM_LOOP_ID = 'loop_id';
export const FM_OCCURRENCE_KEY = 'occurrence_key';

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
 * Embed task metadata in canister frontmatter JSON (canister has no task_meta column).
 *
 * @param {Record<string, unknown>|undefined|null} baseFm
 * @param {{
 *   record_kind: string,
 *   proposal_kind: string,
 *   task_id?: string|null,
 *   loop_id?: string|null,
 *   occurrence_key?: string|null,
 * }} taskMeta
 * @returns {Record<string, unknown>}
 */
export function mergeTaskFrontmatter(baseFm, taskMeta) {
  const fm = {
    ...(baseFm && typeof baseFm === 'object' && !Array.isArray(baseFm) ? baseFm : {}),
  };
  fm[FM_PROPOSAL_SOURCE] = TASK_PROPOSAL_SOURCE;
  fm[FM_TASK_RECORD_KIND] = String(taskMeta.record_kind || 'task').slice(0, 32);
  fm[FM_TASK_PROPOSAL_KIND] = String(taskMeta.proposal_kind || '').slice(0, 32);
  if (taskMeta.task_id != null) {
    fm[FM_TASK_ID] = String(taskMeta.task_id).slice(0, 64);
  }
  if (taskMeta.loop_id != null) {
    fm[FM_LOOP_ID] = String(taskMeta.loop_id).slice(0, 64);
  }
  if (taskMeta.occurrence_key != null) {
    fm[FM_OCCURRENCE_KEY] = String(taskMeta.occurrence_key).slice(0, 64);
  }
  return fm;
}

/**
 * Map a canister proposal row into the shape `precheckApprovedTaskProposal` expects.
 *
 * @param {Record<string, unknown>} proposal
 * @returns {Record<string, unknown>|null}
 */
export function normalizeCanisterProposalForTaskPrecheck(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;

  const fm = parseProposalFrontmatter(proposal.frontmatter);
  const fromFm = fm[FM_PROPOSAL_SOURCE] === TASK_PROPOSAL_SOURCE;
  const fromSource = proposal.source === TASK_PROPOSAL_SOURCE;
  const path =
    typeof proposal.path === 'string' && proposal.path.startsWith('meta/tasks/proposals/');

  if (!fromFm && !fromSource && !path) return null;

  /** @type {{ record_kind: string, proposal_kind: string, task_id?: string|null, loop_id?: string|null, occurrence_key?: string|null }} */
  const task_meta = {
    record_kind:
      (typeof fm[FM_TASK_RECORD_KIND] === 'string' && fm[FM_TASK_RECORD_KIND].trim()) ||
      (proposal.task_meta &&
      typeof proposal.task_meta === 'object' &&
      typeof /** @type {{ record_kind?: string }} */ (proposal.task_meta).record_kind === 'string'
        ? /** @type {{ record_kind: string }} */ (proposal.task_meta).record_kind
        : 'task'),
    proposal_kind:
      (typeof fm[FM_TASK_PROPOSAL_KIND] === 'string' && fm[FM_TASK_PROPOSAL_KIND].trim()) ||
      (proposal.task_meta &&
      typeof proposal.task_meta === 'object' &&
      typeof /** @type {{ proposal_kind?: string }} */ (proposal.task_meta).proposal_kind === 'string'
        ? /** @type {{ proposal_kind: string }} */ (proposal.task_meta).proposal_kind
        : ''),
  };

  if (typeof fm[FM_TASK_ID] === 'string' && fm[FM_TASK_ID].trim()) {
    task_meta.task_id = fm[FM_TASK_ID].trim();
  } else if (
    proposal.task_meta &&
    typeof proposal.task_meta === 'object' &&
    /** @type {{ task_id?: string|null }} */ (proposal.task_meta).task_id != null
  ) {
    task_meta.task_id = /** @type {{ task_id: string|null }} */ (proposal.task_meta).task_id;
  }

  if (typeof fm[FM_LOOP_ID] === 'string' && fm[FM_LOOP_ID].trim()) {
    task_meta.loop_id = fm[FM_LOOP_ID].trim();
  } else if (
    proposal.task_meta &&
    typeof proposal.task_meta === 'object' &&
    /** @type {{ loop_id?: string|null }} */ (proposal.task_meta).loop_id != null
  ) {
    task_meta.loop_id = /** @type {{ loop_id: string|null }} */ (proposal.task_meta).loop_id;
  }

  if (typeof fm[FM_OCCURRENCE_KEY] === 'string' && fm[FM_OCCURRENCE_KEY].trim()) {
    task_meta.occurrence_key = fm[FM_OCCURRENCE_KEY].trim();
  } else if (
    proposal.task_meta &&
    typeof proposal.task_meta === 'object' &&
    /** @type {{ occurrence_key?: string|null }} */ (proposal.task_meta).occurrence_key != null
  ) {
    task_meta.occurrence_key = /** @type {{ occurrence_key: string|null }} */ (proposal.task_meta)
      .occurrence_key;
  }

  if (!task_meta.proposal_kind) {
    try {
      const parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
      if (parsed && typeof parsed === 'object' && typeof parsed.proposal_kind === 'string') {
        task_meta.proposal_kind = parsed.proposal_kind.trim();
      }
    } catch {
      // ignore parse errors
    }
  }

  if (!task_meta.proposal_kind) return null;

  return {
    ...proposal,
    source: TASK_PROPOSAL_SOURCE,
    task_meta,
  };
}

/**
 * POST a task proposal to the canister (hosted bridge propose path).
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   input: {
 *     path: string,
 *     body?: string,
 *     intent?: string,
 *     frontmatter?: Record<string, unknown>,
 *     base_state_id?: string,
 *     task_meta?: {
 *       record_kind: string,
 *       proposal_kind: string,
 *       task_id?: string|null,
 *       loop_id?: string|null,
 *       occurrence_key?: string|null,
 *     },
 *     vault_id?: string,
 *     review_queue?: string,
 *     proposed_by?: string,
 *   },
 * }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createTaskProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted task proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const frontmatter = mergeTaskFrontmatter(input.frontmatter, input.task_meta ?? { record_kind: 'task', proposal_kind: '' });
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
    source: TASK_PROPOSAL_SOURCE,
    task_meta: input.task_meta,
    review_queue: input.review_queue,
    proposed_by: input.proposed_by,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch one proposal from the canister and normalize for task apply.
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 * }} opts
 * @returns {Promise<{ ok: true, proposal: Record<string, unknown> } | { ok: false, status: number, code: string, error: string }>}
 */
export async function fetchCanisterProposalForTask(opts) {
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
  const normalized = normalizeCanisterProposalForTaskPrecheck(raw);
  if (!normalized) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Not a task proposal' };
  }
  return { ok: true, proposal: normalized };
}

/**
 * Apply an approved canister task proposal to bridge hub_flow_store.json.
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
export async function applyApprovedTaskProposalFromCanister(opts) {
  const fetched = await fetchCanisterProposalForTask({
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
      error: 'Proposal must be approved before task index apply',
    };
  }

  const precheck = precheckApprovedTaskProposal(opts.dataDir, proposal);
  if (!precheck.ok) {
    return precheck;
  }

  const reconcile = reconcileApprovedTaskProposal(opts.dataDir, precheck);
  return {
    ok: true,
    payload: {
      applied: true,
      proposal_id: opts.proposalId,
      vault_id: precheck.vaultId,
      proposal_kind: precheck.proposalKind,
      task_id: reconcile.task_id ?? precheck.parsed?.task_id ?? null,
      loop_id: reconcile.loop_id ?? precheck.parsed?.loop_id ?? null,
    },
  };
}
