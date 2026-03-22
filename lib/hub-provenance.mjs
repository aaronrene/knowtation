/**
 * Hub-mediated note writes: server-controlled frontmatter keys for accountability.
 * Clients cannot forge reserved keys — merge always applies server values last.
 */

const RESERVED = new Set([
  'knowtation_editor',
  'knowtation_edited_at',
  'author_kind',
  'knowtation_proposed_by',
  'knowtation_approved_by',
]);

/**
 * Remove reserved keys from a frontmatter object (e.g. untrusted client input).
 * @param {Record<string, unknown> | null | undefined} fm
 * @returns {Record<string, string>}
 */
export function stripReservedFrontmatterKeys(fm) {
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(fm)) {
    if (RESERVED.has(k)) continue;
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

/**
 * Merge client/body frontmatter with server provenance. Reserved keys always come from the server.
 *
 * @param {Record<string, unknown> | null | undefined} clientFrontmatter
 * @param {{
 *   sub?: string | null,
 *   kind: 'human' | 'webhook' | 'agent' | 'import',
 *   now?: string,
 *   proposedBy?: string | null,
 *   approvedBy?: string | null,
 * }} opts
 * @returns {Record<string, string>}
 */
export function mergeProvenanceFrontmatter(clientFrontmatter, opts) {
  const now = opts.now ?? new Date().toISOString();
  const base = stripReservedFrontmatterKeys(clientFrontmatter);
  /** @type {Record<string, string>} */
  const prov = {
    author_kind: opts.kind,
    knowtation_edited_at: now,
  };
  if (opts.sub) prov.knowtation_editor = String(opts.sub);
  if (opts.proposedBy) prov.knowtation_proposed_by = String(opts.proposedBy);
  if (opts.approvedBy) prov.knowtation_approved_by = String(opts.approvedBy);
  return { ...base, ...prov };
}
