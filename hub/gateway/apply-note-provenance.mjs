/**
 * Hosted gateway: align note POST bodies with hub/server.mjs provenance rules before proxying to the canister.
 *
 * IMPORTANT: `frontmatter` must remain a JSON **object** on the wire (Express will stringify the whole body once).
 * If we set `frontmatter` to JSON.stringify(merged), the POST body contains `"frontmatter":"{\"k\":...}"` and Motoko's
 * extractJsonString copies `\\"` as two characters instead of unescaping — stored text is invalid JSON and the
 * Hub shows `{}`. Sending a nested object lets Motoko use extractJsonObjectSlice and persist valid JSON text.
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
  out.frontmatter = merged;
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
