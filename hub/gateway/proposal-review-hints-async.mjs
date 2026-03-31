/**
 * After successful hosted proposal create, optionally run LLM and POST review-hints to canister.
 * Env: KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1. Model output is untrusted; not a merge gate.
 */

import { completeChat } from '../../lib/llm-complete.mjs';

/**
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
 * }} opts
 */
export function maybeScheduleHostedProposalReviewHints(opts) {
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
  setImmediate(() => {
    runHostedProposalReviewHintsJob({
      canisterUrl,
      effectiveUserId,
      actorUserId,
      vaultId,
      proposalId,
    }).then((out) => {
      if (!out.ok) {
        console.error(
          '[gateway] async review hints failed',
          JSON.stringify({ proposalId, code: out.code, detail: out.detail?.slice?.(0, 200) }),
        );
      }
    });
  });
}

/**
 * Run LLM review hints and POST to canister (used after proposal create and from explicit UI trigger).
 * @param {{
 *   canisterUrl: string,
 *   effectiveUserId: string,
 *   actorUserId: string,
 *   vaultId: string,
 *   proposalId: string,
 * }} opts
 * @returns {Promise<{ ok: true } | { ok: false, status: number, code: string, detail?: string }>}
 */
export async function runHostedProposalReviewHintsJob({
  canisterUrl,
  effectiveUserId,
  actorUserId,
  vaultId,
  proposalId,
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
  const getRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}`, { headers: h });
  if (!getRes.ok) {
    return {
      ok: false,
      status: getRes.status === 404 ? 404 : 502,
      code: 'UPSTREAM',
      detail: `GET proposal ${getRes.status}`,
    };
  }
  const p = await getRes.json();
  if (!p || p.status !== 'proposed') {
    return { ok: false, status: 400, code: 'BAD_REQUEST', detail: 'Can only attach hints to proposed proposals' };
  }
  const system =
    'You assist human proposal reviewers. Reply with plain text only: 2–6 short lines (risks, unclear scope, things to verify). Do not say pass/fail or approve; output is untrusted hints.';
  const user = `Path: ${p.path}\n---\n${String(p.body || '').slice(0, 12_000)}`;
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
