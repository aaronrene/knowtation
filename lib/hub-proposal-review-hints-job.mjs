/**
 * Optional async LLM text for human reviewers only (never merge authority).
 * Env: KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1
 */

import { completeChat } from './llm-complete.mjs';
import { getProposal, updateProposalReviewHints } from '../hub/proposals-store.mjs';

/**
 * @param {{ data_dir: string, llm?: { openai_chat_model?: string, ollama_chat_model?: string } }} config
 * @param {string} proposalId
 */
export async function runProposalReviewHintsJob(config, proposalId) {
  const p = getProposal(config.data_dir, proposalId);
  if (!p || p.status !== 'proposed') return;
  const system =
    'You assist human proposal reviewers. Reply with plain text only: 2–6 short lines (risks, unclear scope, things to verify). Do not say pass/fail or approve; output is untrusted hints.';
  const user = `Path: ${p.path}\nQueue: ${p.review_queue || '—'}\n---\n${String(p.body || '').slice(0, 12_000)}`;
  const raw = await completeChat(config, { system, user, maxTokens: 400 });
  const model = process.env.OPENAI_API_KEY
    ? process.env.OPENAI_CHAT_MODEL || config.llm?.openai_chat_model || 'gpt-4o-mini'
    : process.env.OLLAMA_CHAT_MODEL || config.llm?.ollama_chat_model || process.env.OLLAMA_MODEL || 'ollama';
  updateProposalReviewHints(config.data_dir, proposalId, {
    review_hints: raw.slice(0, 8000),
    review_hints_model: String(model).slice(0, 128),
  });
}
