/**
 * After successful hosted proposal create, optionally run LLM and POST review-hints to canister.
 * Env: KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1. Model output is untrusted; not a merge gate.
 */

import { completeChat } from '../../lib/llm-complete.mjs';

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
 * }} opts
 * @param {number} [budgetMs=18000] Maximum ms to wait before giving up and letting the response proceed.
 * @returns {Promise<void>}
 */
export async function maybeScheduleHostedProposalReviewHints(opts, budgetMs = 18000) {
  if (!opts.hintsEnabled) return;
  const { method, pathOnly, upstreamStatus, responseText, canisterUrl, effectiveUserId, actorUserId, vaultId } = opts;
  if (method !== 'POST' || (pathOnly !== '/api/v1/proposals' && pathOnly !== '/api/v1/proposals/')) return;
  if (upstreamStatus < 200 || upstreamStatus >= 300) return;
  let proposalId;
  try {
    const j = JSON.parse(responseText);
    if (j && j.proposal_id) proposalId = String(j.proposal_id);
  } catch (_) {
    return;
  }
  if (!proposalId) return;

  let timeoutHandle;
  const deadline = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), budgetMs);
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
      return {
        ok: false,
        status: getRes.status === 404 ? 404 : 502,
        code: 'UPSTREAM',
        detail: `GET proposal ${getRes.status}`,
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
