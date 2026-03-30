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
 * }} opts
 */
export function maybeScheduleHostedProposalReviewHints(opts) {
  if (process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS !== '1') return;
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
    runHostedProposalReviewHints({
      canisterUrl,
      effectiveUserId,
      actorUserId,
      vaultId,
      proposalId,
    }).catch(() => {});
  });
}

async function runHostedProposalReviewHints({ canisterUrl, effectiveUserId, actorUserId, vaultId, proposalId }) {
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
  if (!getRes.ok) return;
  const p = await getRes.json();
  if (!p || p.status !== 'proposed') return;
  const system =
    'You assist human proposal reviewers. Reply with plain text only: 2–6 short lines (risks, unclear scope, things to verify). Do not say pass/fail or approve; output is untrusted hints.';
  const user = `Path: ${p.path}\n---\n${String(p.body || '').slice(0, 12_000)}`;
  const raw = await completeChat(miniConfig, { system, user, maxTokens: 400 });
  const model = process.env.OPENAI_API_KEY
    ? process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
    : process.env.ANTHROPIC_API_KEY
      ? process.env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-haiku-20241022'
      : process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'ollama';
  await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}/review-hints`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      review_hints: raw.slice(0, 8000),
      review_hints_model: String(model).slice(0, 128),
    }),
  });
}
