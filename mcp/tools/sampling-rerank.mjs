/**
 * Issue #1 Phase F4 — sampling-based search result reranking.
 * After vector search returns candidates, use the client LLM to rerank by semantic relevance.
 */

import { trySampling } from '../sampling.mjs';

const RERANK_SYSTEM = `You are a search result reranker. Given a query and numbered search results, return ONLY a JSON array of the result numbers (1-based) sorted by relevance to the query, most relevant first. Example: [3, 1, 5, 2, 4]
Do not include results that are clearly irrelevant. Return at most the number requested.`;

const MAX_RESULTS_FOR_RERANK = 20;

/**
 * Attempt to rerank search results using the client LLM via sampling.
 * Falls back to the original order when sampling is unavailable or fails.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {string} query
 * @param {{ path: string, snippet?: string, score?: number }[]} results
 * @param {number} [limit]
 * @returns {Promise<{ path: string, snippet?: string, score?: number }[]>}
 */
export async function rerankWithSampling(mcpServer, query, results, limit) {
  if (!results || results.length <= 1) return results;

  const candidates = results.slice(0, MAX_RESULTS_FOR_RERANK);
  const numbered = candidates
    .map((r, i) => `${i + 1}. [${r.path}] ${(r.snippet || '').slice(0, 200)}`)
    .join('\n');

  const user = `Query: "${query}"\nReturn up to ${limit || candidates.length} results.\n\nResults:\n${numbered}`;

  const raw = await trySampling(mcpServer, {
    system: RERANK_SYSTEM,
    user,
    maxTokens: 256,
  });

  if (!raw) return results;

  const ranked = parseRerankResponse(raw, candidates.length);
  if (!ranked || ranked.length === 0) return results;

  const reordered = [];
  const used = new Set();
  for (const idx of ranked) {
    if (idx >= 0 && idx < candidates.length && !used.has(idx)) {
      reordered.push(candidates[idx]);
      used.add(idx);
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    if (!used.has(i)) reordered.push(candidates[i]);
  }
  if (results.length > MAX_RESULTS_FOR_RERANK) {
    reordered.push(...results.slice(MAX_RESULTS_FOR_RERANK));
  }

  return limit ? reordered.slice(0, limit) : reordered;
}

/**
 * Parse the LLM rerank response into an array of 0-based indices.
 * @param {string} raw
 * @param {number} maxIdx
 * @returns {number[] | null}
 */
export function parseRerankResponse(raw, maxIdx) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((n) => typeof n === 'number' && Number.isFinite(n))
      .map((n) => Math.round(n) - 1)
      .filter((i) => i >= 0 && i < maxIdx);
  } catch (_) {
    const matches = raw.match(/\d+/g);
    if (!matches) return null;
    return matches
      .map((s) => parseInt(s, 10) - 1)
      .filter((i) => Number.isFinite(i) && i >= 0 && i < maxIdx);
  }
}
