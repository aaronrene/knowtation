/**
 * After successful hosted proposal create, optionally run LLM and POST review-hints to canister.
 * Env: KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1. Model output is untrusted; not a merge gate.
 *
 * HOSTED-WRITE-EVAL (2026-07-23): inline wait on create must leave headroom for Scooling's
 * propose+approve abort (`HOSTED_REVIEW_WRITE_BACK_DEFAULT_TIMEOUT_MS` = 15_000). The previous
 * 18_000 ms default caused production `/try` Approve timeouts. Personal self-apply (Scooling
 * review-tray fingerprint) skips inline hints entirely — one-click approve follows create
 * immediately, so Hub reviewer hints are not on that path.
 */

import { completeChat } from '../../lib/llm-complete.mjs';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../../lib/hub-proposal-personal-self-apply.mjs';
import { canisterAuthHeaders } from './canister-auth-headers.mjs';

/**
 * Max ms the gateway may hold `POST /api/v1/proposals` waiting for review hints before returning.
 * Kept well under Scooling's 15s shared Hub abort so create + approve can both finish.
 */
export const HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS = 2000;

/**
 * Whether create-path inline hints should be skipped for this proposal class.
 * Scooling personal self-apply creates are approved in the same client round trip — hints
 * would race approve and are not the learner path (SD-18).
 *
 * @param {unknown} createBody - outgoing create JSON (after augment), if known
 * @returns {boolean}
 */
export function shouldSkipInlineReviewHintsOnCreate(createBody) {
  if (!createBody || typeof createBody !== 'object' || Buffer.isBuffer(createBody)) return false;
  const intent = String(/** @type {Record<string, unknown>} */ (createBody).intent ?? '').trim();
  return intent === SCOOLING_REVIEW_TRAY_INTENT;
}

/**
 * Run LLM review hints inline (before response is sent), bounded by a deadline.
 * setImmediate is not used because Netlify/Lambda containers freeze after the async handler
 * resolves — macrotask callbacks never fire reliably in that environment.
 * @param {{
 *   method: string,
 *   pathOnly: string,
 *   upstreamStatus: number,
 *   responseText: string,
 *   canisterUrl: string,
 *   effectiveUserId: string,
 *   actorUserId: string,
 *   vaultId: string,
 *   hintsEnabled: boolean,
 *   proposalData?: { path: string, body: string } | null,
 *   createBody?: unknown,
 * }} opts
 * @param {number} [budgetMs=HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS] Maximum ms to wait
 *   before giving up and letting the response proceed.
 * @returns {Promise<void>}
 */
export async function maybeScheduleHostedProposalReviewHints(
  opts,
  budgetMs = HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS,
) {
  if (!opts.hintsEnabled) return;
  const { method, pathOnly, upstreamStatus, responseText, canisterUrl, effectiveUserId, actorUserId, vaultId } = opts;
  if (method !== 'POST' || (pathOnly !== '/api/v1/proposals' && pathOnly !== '/api/v1/proposals/')) return;
  if (upstreamStatus < 200 || upstreamStatus >= 300) return;
  if (shouldSkipInlineReviewHintsOnCreate(opts.createBody)) return;

  let proposalId;
  try {
    const j = JSON.parse(responseText);
    if (j && j.proposal_id) proposalId = String(j.proposal_id);
  } catch (_) {
    return;
  }
  if (!proposalId) return;

  const capped =
    typeof budgetMs === 'number' && Number.isFinite(budgetMs) && budgetMs > 0
      ? Math.min(Math.floor(budgetMs), HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS)
      : HOSTED_PROPOSAL_REVIEW_HINTS_INLINE_BUDGET_MS;

  let timeoutHandle;
  const deadline = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), capped);
  });
  const job = runHostedProposalReviewHintsJob({
    canisterUrl,
    effectiveUserId,
    actorUserId,
    vaultId,
    proposalId,
    proposalData: opts.proposalData || null,
  }).catch((e) => ({ ok: false, code: 'RUNTIME_ERROR', detail: e?.message || String(e) }));

  const out = await Promise.race([job, deadline]);
  clearTimeout(timeoutHandle);
  if (!out.ok) {
    console.error(
      '[gateway] review hints failed',
      JSON.stringify({ proposalId, code: out.code, detail: out.detail?.slice?.(0, 200) }),
    );
  }
}

/**
 * Run LLM review hints and POST to canister (used after proposal create and from explicit UI trigger).
 * When proposalData is provided (path + body already known from the create response) the canister
 * GET is skipped entirely, saving one ICP round trip (~1–3 s) and making it reliably fit inside
 * the Netlify function budget.
 * @param {{
 *   canisterUrl: string,
 *   effectiveUserId: string,
 *   actorUserId: string,
 *   vaultId: string,
 *   proposalId: string,
 *   proposalData?: { path: string, body: string } | null,
 * }} opts
 * @returns {Promise<{ ok: true } | { ok: false, status: number, code: string, detail?: string }>}
 */
export async function runHostedProposalReviewHintsJob({
  canisterUrl,
  effectiveUserId,
  actorUserId,
  vaultId,
  proposalId,
  proposalData = null,
}) {
  const base = canisterUrl.replace(/\/$/, '');
  const h = {
    Accept: 'application/json',
    'x-user-id': effectiveUserId,
    'x-actor-id': actorUserId,
    'x-vault-id': vaultId,
    ...canisterAuthHeaders(),
  };
  const miniConfig = {
    embedding: { ollama_url: process.env.OLLAMA_URL },
    llm: {},
  };

  let proposalPath, proposalBody;
  if (proposalData && proposalData.path != null && proposalData.body) {
    proposalPath = String(proposalData.path);
    proposalBody = String(proposalData.body);
  } else {
    let getRes;
    try {
      getRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}`, { headers: h });
    } catch (e) {
      return { ok: false, status: 502, code: 'UPSTREAM', detail: `fetch: ${e?.message || String(e)}` };
    }
    if (!getRes.ok) {
      const t = await getRes.text().catch(() => '');
      return {
        ok: false,
        status: getRes.status === 404 ? 404 : 502,
        code: 'UPSTREAM',
        detail: (t && t.slice(0, 500)) || `GET proposal ${getRes.status}`,
      };
    }
    let p;
    try {
      p = await getRes.json();
    } catch (e) {
      return {
        ok: false,
        status: 502,
        code: 'UPSTREAM_JSON',
        detail: `Canister returned non-JSON body for hints proposal ${proposalId}: ${e?.message || String(e)}`,
      };
    }
    if (!p || p.status !== 'proposed') {
      return { ok: false, status: 400, code: 'BAD_REQUEST', detail: 'Can only attach hints to proposed proposals' };
    }
    proposalPath = p.path;
    proposalBody = p.body || '';
  }

  const system =
    'You assist human proposal reviewers. Reply with plain text only: 2–6 short lines (risks, unclear scope, things to verify). Do not say pass/fail or approve; output is untrusted hints.';
  const user = `Path: ${proposalPath}\n---\n${String(proposalBody).slice(0, 12_000)}`;
  let raw;
  try {
    raw = await completeChat(miniConfig, { system, user, maxTokens: 400 });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return { ok: false, status: 500, code: 'RUNTIME_ERROR', detail: msg };
  }
  const model = process.env.OPENAI_API_KEY
    ? process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
    : process.env.ANTHROPIC_API_KEY
      ? process.env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-haiku-20241022'
      : process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'ollama';
  const postRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}/review-hints`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      review_hints: raw.slice(0, 8000),
      review_hints_model: String(model).slice(0, 128),
    }),
  });
  if (!postRes.ok) {
    const t = await postRes.text();
    return {
      ok: false,
      status: postRes.status >= 400 && postRes.status < 600 ? postRes.status : 502,
      code: 'CANISTER_HINTS',
      detail: t.slice(0, 500),
    };
  }
  return { ok: true };
}
