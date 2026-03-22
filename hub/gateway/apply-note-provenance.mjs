/**
 * Hosted gateway: align note POST bodies with hub/server.mjs provenance rules before proxying to the canister.
 * The canister parses JSON with extractJsonString (string values only); the Hub UI sends frontmatter as an object.
 * After merge, frontmatter is set to JSON.stringify(merged) so upstream storage receives a single JSON text blob.
 */

import { mergeProvenanceFrontmatter } from '../../lib/hub-provenance.mjs';

/**
 * @param {unknown} body Parsed POST body (Express json())
 * @param {string | null} userId X-User-Id value (e.g. google:123)
 * @returns {unknown}
 */
export function mergeHostedNoteBodyForCanister(body, userId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  /** @type {Record<string, unknown>} */
  const out = { ...body };
  let clientFm = out.frontmatter;
  if (typeof clientFm === 'string') {
    try {
      clientFm = clientFm.trim() ? JSON.parse(clientFm) : {};
    } catch {
      clientFm = {};
    }
  } else if (!clientFm || typeof clientFm !== 'object' || Array.isArray(clientFm)) {
    clientFm = {};
  }
  const merged = mergeProvenanceFrontmatter(
    /** @type {Record<string, unknown>} */ (clientFm),
    {
      sub: userId || null,
      kind: 'human',
    }
  );
  out.frontmatter = JSON.stringify(merged);
  return out;
}

/**
 * @param {string} method
 * @param {string} pathPart URL path without query (e.g. /api/v1/notes)
 */
export function isPostApiV1Notes(method, pathPart) {
  if (method !== 'POST') return false;
  const p = (pathPart || '').replace(/\/+$/, '') || '/';
  return p === '/api/v1/notes';
}

export { pathPartNoQuery } from './request-path.mjs';
