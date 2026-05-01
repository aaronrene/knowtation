/**
 * Skill: search-vault
 *
 * Project-scoped semantic search over the Knowtation vault.
 * Used by research, blog-seo, and clip-factory agents to find supporting evidence
 * (claims, quotes, prior content) without leaking across projects.
 *
 * Hard rules:
 *  - `project` is REQUIRED (no global search; agents see one project at a time).
 *  - default mode is 'semantic' (meaning), not 'keyword'.
 *  - default limit is 8, max 25.
 *  - default fields shape is 'path+snippet' (cheap; agents pull full body via read-* skills).
 *
 * @param {ReturnType<import('./hub-client.mjs').createHubClient>} hub
 * @param {{
 *   project: 'born-free' | 'store-free' | 'knowtation',
 *   query: string,
 *   limit?: number,
 *   mode?: 'semantic' | 'keyword',
 *   fields?: 'path' | 'path+snippet' | 'full',
 *   tag?: string,
 *   since?: string,
 *   until?: string,
 * }} args
 * @returns {Promise<{ results: Array<{ path: string, snippet?: string }>, query: string, count: number, project: string }>}
 */
import { assertProject } from './hub-client.mjs';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export async function searchVault(hub, args) {
  const project = assertProject(args.project);
  const query = sanitizeQuery(args.query);
  const limit = clampLimit(args.limit);
  const mode = args.mode === 'keyword' ? 'keyword' : 'semantic';
  const fields = ['path', 'path+snippet', 'full'].includes(args.fields) ? args.fields : 'path+snippet';

  /** @type {Record<string, unknown>} */
  const body = {
    query,
    project,
    mode,
    fields,
    limit,
    snippet_chars: 300,
  };
  if (args.tag != null && String(args.tag).trim() !== '') body.tag = String(args.tag).trim();
  if (args.since != null && String(args.since).trim() !== '') body.since = String(args.since).trim();
  if (args.until != null && String(args.until).trim() !== '') body.until = String(args.until).trim();

  const data = await hub.search(body);
  const rows = Array.isArray(data?.results) ? data.results : [];

  return {
    project,
    query,
    count: rows.length,
    results: rows.map((r) => ({
      path: String(r.path ?? ''),
      ...(r.snippet != null ? { snippet: String(r.snippet) } : {}),
      ...(r.title != null ? { title: String(r.title) } : {}),
      ...(r.score != null ? { score: Number(r.score) } : {}),
    })),
  };
}

function sanitizeQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw Object.assign(new Error('invalid_query: query must be a non-empty string'), {
      code: 'INVALID_QUERY',
    });
  }
  if (query.length > 4000) {
    throw Object.assign(new Error('invalid_query: query exceeds 4000 chars'), {
      code: 'INVALID_QUERY',
    });
  }
  return query.trim();
}

function clampLimit(limit) {
  if (limit == null) return DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
