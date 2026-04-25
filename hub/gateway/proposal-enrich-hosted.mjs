/**
 * Hosted Enrich: call LLM then POST assistant fields to canister.
 * Env: KNOWTATION_HUB_PROPOSAL_ENRICH=1. Output is advisory; not a merge gate.
 */

import { completeChat } from '../../lib/llm-complete.mjs';
import { validateAndNormalizeEnrichResult, serializeSuggestedFrontmatterJson } from '../../lib/proposal-enrich-llm.mjs';
import { canisterAuthHeaders } from './canister-auth-headers.mjs';

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

function buildHostedEnrichMessages(input) {
  const path = input.path != null ? String(input.path) : '';
  const intent = input.intent != null ? String(input.intent) : '—';
  const body = input.body != null ? String(input.body).slice(0, 12_000) : '';
  const system =
    'Reply with ONLY valid JSON (no markdown fences): {"summary":"one short paragraph","suggested_labels":["short-tag"],"suggested_frontmatter":{"title":"...","project":"...","tags":["..."],"date":"...","updated":"...","source":"...","source_id":"...","intent":"...","follows":"inbox/note.md","causal_chain_id":"...","entity":"...","episode_id":"...","summarizes":"inbox/other.md","summarizes_range":"...","state_snapshot":true}}. suggested_frontmatter is optional; include only fields clearly grounded in the content. Labels use lowercase slug form.';
  const user = `Path: ${path}\nIntent: ${intent}\n---\n${body}`;
  return { system, user };
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
    ...canisterAuthHeaders(),
  };
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
      detail: t ? t.slice(0, 500) : undefined,
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
      detail: `Canister returned non-JSON body for proposal ${proposalId}: ${e?.message || String(e)}`,
    };
  }
  if (!p || p.status !== 'proposed') {
    return { ok: false, status: 400, code: 'BAD_REQUEST', detail: 'Can only enrich proposed proposals' };
  }

  // Hosted runs inside a short-lived Netlify function, so keep the prompt/output budget
  // close to the last known good path while still returning the expanded schema.
  const { system, user } = buildHostedEnrichMessages({
    path: p.path,
    intent: p.intent,
    body: p.body,
  });
  let raw;
  try {
    raw = await completeChat(miniLlmConfig(), { system, user, maxTokens: 400 });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return { ok: false, status: 500, code: 'RUNTIME_ERROR', detail: msg };
  }

  const norm = validateAndNormalizeEnrichResult(raw);
  const model = chatModelLabel();
  const labelsJson = JSON.stringify(
    norm.suggested_labels.map((x) => String(x).slice(0, 64)).filter(Boolean).slice(0, 8),
  );
  const fmJson = serializeSuggestedFrontmatterJson(norm.suggested_frontmatter);
  const postRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}/enrich`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_notes: String(norm.summary).slice(0, 16_000),
      assistant_model: String(model).slice(0, 128),
      suggested_labels_json: labelsJson,
      assistant_suggested_frontmatter_json: fmJson,
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
