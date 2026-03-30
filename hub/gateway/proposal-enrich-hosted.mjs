/**
 * Hosted Enrich: call LLM then POST assistant fields to canister.
 * Env: KNOWTATION_HUB_PROPOSAL_ENRICH=1. Output is advisory; not a merge gate.
 */

import { completeChat } from '../../lib/llm-complete.mjs';

function miniLlmConfig() {
  return {
    embedding: { ollama_url: process.env.OLLAMA_URL },
    llm: {},
  };
}

function chatModelLabel() {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-haiku-20241022';
  }
  return process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'ollama';
}

/**
 * @param {{
 *   canisterUrl: string,
 *   effectiveUserId: string,
 *   actorUserId: string,
 *   vaultId: string,
 *   proposalId: string,
 *   enrichEnabled: boolean,
 * }} opts
 * @returns {Promise<{ ok: true } | { ok: false, status: number, code: string, detail?: string }>}
 */
export async function runHostedProposalEnrichAndPost(opts) {
  if (!opts.enrichEnabled) {
    return { ok: false, status: 404, code: 'NOT_FOUND' };
  }
  const { canisterUrl, effectiveUserId, actorUserId, vaultId, proposalId } = opts;
  const base = canisterUrl.replace(/\/$/, '');
  const h = {
    Accept: 'application/json',
    'x-user-id': effectiveUserId,
    'x-actor-id': actorUserId,
    'x-vault-id': vaultId,
  };
  const getRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}`, { headers: h });
  if (!getRes.ok) {
    return { ok: false, status: getRes.status === 404 ? 404 : 502, code: 'UPSTREAM' };
  }
  const p = await getRes.json();
  if (!p || p.status !== 'proposed') {
    return { ok: false, status: 400, code: 'BAD_REQUEST', detail: 'Can only enrich proposed proposals' };
  }

  const system =
    'Reply with ONLY valid JSON: {"summary":"one short paragraph","suggested_labels":["lowercase-short-tag"]}. At most 5 labels. No markdown fences.';
  const user = `Path: ${p.path}\nIntent: ${p.intent || '—'}\n---\n${String(p.body || '').slice(0, 12_000)}`;
  let raw;
  try {
    raw = await completeChat(miniLlmConfig(), { system, user, maxTokens: 400 });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return { ok: false, status: 500, code: 'RUNTIME_ERROR', detail: msg };
  }

  let summary = raw;
  let suggested = [];
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
    const j = JSON.parse(cleaned);
    if (typeof j.summary === 'string') summary = j.summary;
    if (Array.isArray(j.suggested_labels)) suggested = j.suggested_labels;
  } catch (_) {
    /* use raw text as summary */
  }

  const model = chatModelLabel();
  const labelsJson = JSON.stringify(
    suggested.map((x) => String(x).slice(0, 64)).filter(Boolean).slice(0, 8),
  );
  const postRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}/enrich`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_notes: String(summary).slice(0, 16_000),
      assistant_model: String(model).slice(0, 128),
      suggested_labels_json: labelsJson,
    }),
  });
  if (!postRes.ok) {
    const t = await postRes.text();
    return {
      ok: false,
      status: postRes.status >= 400 && postRes.status < 600 ? postRes.status : 502,
      code: 'CANISTER_ENRICH',
      detail: t.slice(0, 500),
    };
  }
  return { ok: true };
}
