/**
 * List notes with filters. Single backend for CLI and MCP. Phase 9.
 * Extracted from CLI runListNotes for reuse.
 */

import { listMarkdownFiles, readNote, normalizeSlug, normalizeTags, effectiveProjectSlug } from './vault.mjs';
import { isApprovalLogNote } from './approval-log.mjs';

/**
 * @param {string} d - date string
 * @returns {string} YYYY-MM-DD slice for range comparison
 */
function dateSlice(d) {
  if (d == null || typeof d !== 'string') return '';
  return d.trim().slice(0, 10) || '';
}

/**
 * Get notes with metadata for listing.
 * @param {string} vaultPath
 * @param {{ ignore?: string[] }} config
 * @returns {{ path: string, frontmatter: object, body: string, project?: string, tags?: string[], date?: string, updated?: string, causal_chain_id?: string, entity?: string[], episode_id?: string }[]}
 */
export function getNotesWithMeta(vaultPath, config = {}) {
  const paths = listMarkdownFiles(vaultPath, { ignore: config.ignore });
  const notes = [];
  for (const p of paths) {
    try {
      notes.push(readNote(vaultPath, p));
    } catch (_) {
      // skip unreadable
    }
  }
  return notes;
}

/**
 * Apply list-notes structural filters (folder, project, tag, dates, chain, entity, episode,
 * content_scope, network, wallet_address, payment_status).
 * Mutates no inputs; returns a new array.
 * @param {Array<{ path: string, frontmatter?: object, body?: string, project?: string, tags?: string[], date?: string, updated?: string, causal_chain_id?: string, entity?: string[], episode_id?: string, network?: string, wallet_address?: string, payment_status?: string }>} notes
 * @param {{
 *   folder?: string,
 *   project?: string,
 *   tag?: string,
 *   since?: string,
 *   until?: string,
 *   chain?: string,
 *   entity?: string,
 *   episode?: string,
 *   content_scope?: 'all'|'notes'|'approval_logs',
 *   network?: string,
 *   wallet_address?: string,
 *   payment_status?: string
 * }} options
 */
export function filterNotesByListOptions(notes, options = {}) {
  let out = notes.slice();
  if (options.folder) {
    const prefix = options.folder.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    out = out.filter((n) => n.path === options.folder || n.path.startsWith(prefix));
  }
  if (options.project) {
    const p = normalizeSlug(options.project);
    out = out.filter((n) => effectiveProjectSlug(n.path, n.frontmatter) === p);
  }
  if (options.tag) {
    const t = normalizeSlug(options.tag);
    out = out.filter((n) => n.tags?.includes(t) || normalizeTags(n.frontmatter?.tags).includes(t));
  }
  if (options.since) {
    const s = dateSlice(options.since);
    if (s) out = out.filter((n) => dateSlice(n.date || n.updated) >= s);
  }
  if (options.until) {
    const u = dateSlice(options.until);
    if (u) out = out.filter((n) => dateSlice(n.date || n.updated) <= u);
  }
  if (options.chain) {
    const c = normalizeSlug(options.chain);
    out = out.filter((n) => n.causal_chain_id === c);
  }
  if (options.entity) {
    const e = normalizeSlug(options.entity);
    out = out.filter((n) => Array.isArray(n.entity) && n.entity.includes(e));
  }
  if (options.episode) {
    const ep = normalizeSlug(options.episode);
    out = out.filter((n) => n.episode_id === ep);
  }
  const cs = options.content_scope;
  if (cs === 'notes') {
    out = out.filter((n) => !isApprovalLogNote(n));
  } else if (cs === 'approval_logs') {
    out = out.filter((n) => isApprovalLogNote(n));
  }
  // Phase 12 — blockchain frontmatter filters
  if (options.network) {
    const net = String(options.network).trim().toLowerCase();
    out = out.filter((n) => {
      const nw = n.network ?? n.frontmatter?.network;
      return nw != null && String(nw).trim().toLowerCase() === net;
    });
  }
  if (options.wallet_address) {
    const wa = String(options.wallet_address).trim().toLowerCase();
    out = out.filter((n) => {
      const addr = n.wallet_address ?? n.frontmatter?.wallet_address;
      return addr != null && String(addr).trim().toLowerCase() === wa;
    });
  }
  if (options.payment_status) {
    const ps = String(options.payment_status).trim().toLowerCase();
    out = out.filter((n) => {
      const status = n.payment_status ?? n.frontmatter?.payment_status;
      return status != null && String(status).trim().toLowerCase() === ps;
    });
  }
  return out;
}

/**
 * Run list-notes with filters. Returns SPEC §4.2 JSON shape.
 * @param {{ vault_path: string, ignore?: string[] }} config
 * @param {{
 *   folder?: string,
 *   project?: string,
 *   tag?: string,
 *   since?: string,
 *   until?: string,
 *   chain?: string,
 *   entity?: string,
 *   episode?: string,
 *   limit?: number,
 *   offset?: number,
 *   order?: 'date'|'date-asc'|string,
 *   fields?: 'path'|'path+metadata'|'full',
 *   countOnly?: boolean,
 *   content_scope?: 'all'|'notes'|'approval_logs',
 *   network?: string,
 *   wallet_address?: string,
 *   payment_status?: string
 * }} options
 * @returns {{ notes?: object[], total: number }}
 */
export function runListNotes(config, options = {}) {
  const limit = Math.max(0, options.limit ?? 20);
  const offset = Math.max(0, options.offset ?? 0);
  const order = options.order || 'date';
  const fields = options.fields || 'path+metadata';
  const countOnly = options.countOnly === true;

  let notes = filterNotesByListOptions(getNotesWithMeta(config.vault_path, config), options);

  if (order === 'date-asc') {
    notes.sort((a, b) => (a.date || a.updated || '').localeCompare(b.date || b.updated || ''));
  } else if (order === 'date') {
    notes.sort((a, b) => (b.date || b.updated || '').localeCompare(a.date || a.updated || ''));
  } else {
    notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  const total = notes.length;
  const slice = notes.slice(offset, offset + limit);

  if (countOnly) {
    return { total };
  }

  const list = slice.map((n) => {
    if (fields === 'path') return { path: n.path };
    if (fields === 'full') return { path: n.path, frontmatter: n.frontmatter, body: n.body };
    const fm = n.frontmatter || {};
    return {
      path: n.path,
      title: fm.title ?? null,
      project: n.project || null,
      tags: n.tags || [],
      date: n.date || null,
      kind: fm.kind != null ? String(fm.kind) : null,
      /** ISO timestamp for Hub UI calendar/list when `date` is unset (list response omits full frontmatter). */
      knowtation_edited_at:
        fm.knowtation_edited_at != null ? String(fm.knowtation_edited_at) : null,
    };
  });

  return { notes: list, total };
}

/**
 * Return facet values for filter dropdowns: projects, tags, folders, networks, wallets.
 * @param {{ vault_path: string, ignore?: string[] }} config
 * @returns {{ projects: string[], tags: string[], folders: string[], networks: string[], wallets: string[] }}
 */
export function runFacets(config) {
  const notes = getNotesWithMeta(config.vault_path, config);
  const projects = new Set();
  const tags = new Set();
  const folders = new Set();
  const networks = new Set();
  const wallets = new Set();
  for (const n of notes) {
    if (n.project) projects.add(n.project);
    for (const t of n.tags || []) if (t) tags.add(t);
    const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : '';
    if (folder) folders.add(folder);
    const fm = n.frontmatter || {};
    if (fm.network != null && String(fm.network).trim()) networks.add(String(fm.network).trim());
    if (fm.wallet_address != null && String(fm.wallet_address).trim()) wallets.add(String(fm.wallet_address).trim());
  }
  return {
    projects: [...projects].sort(),
    tags: [...tags].sort(),
    folders: [...folders].sort(),
    networks: [...networks].sort(),
    wallets: [...wallets].sort(),
  };
}
