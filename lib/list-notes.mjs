/**
 * List notes with filters. Single backend for CLI and MCP. Phase 9.
 * Extracted from CLI runListNotes for reuse.
 */

import { listMarkdownFiles, readNote, normalizeSlug, normalizeTags } from './vault.mjs';

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
function getNotesWithMeta(vaultPath, config = {}) {
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
 *   countOnly?: boolean
 * }} options
 * @returns {{ notes?: object[], total: number }}
 */
export function runListNotes(config, options = {}) {
  const limit = Math.max(0, options.limit ?? 20);
  const offset = Math.max(0, options.offset ?? 0);
  const order = options.order || 'date';
  const fields = options.fields || 'path+metadata';
  const countOnly = options.countOnly === true;

  let notes = getNotesWithMeta(config.vault_path, config);

  if (options.folder) {
    const prefix = options.folder.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    notes = notes.filter((n) => n.path === options.folder || n.path.startsWith(prefix));
  }
  if (options.project) {
    const p = normalizeSlug(options.project);
    notes = notes.filter((n) => n.project === p || (n.frontmatter?.project && normalizeSlug(String(n.frontmatter.project)) === p));
  }
  if (options.tag) {
    const t = normalizeSlug(options.tag);
    notes = notes.filter((n) => n.tags?.includes(t) || normalizeTags(n.frontmatter?.tags).includes(t));
  }
  if (options.since) {
    const s = dateSlice(options.since);
    if (s) notes = notes.filter((n) => dateSlice(n.date || n.updated) >= s);
  }
  if (options.until) {
    const u = dateSlice(options.until);
    if (u) notes = notes.filter((n) => dateSlice(n.date || n.updated) <= u);
  }
  if (options.chain) {
    const c = normalizeSlug(options.chain);
    notes = notes.filter((n) => n.causal_chain_id === c);
  }
  if (options.entity) {
    const e = normalizeSlug(options.entity);
    notes = notes.filter((n) => Array.isArray(n.entity) && n.entity.includes(e));
  }
  if (options.episode) {
    const ep = normalizeSlug(options.episode);
    notes = notes.filter((n) => n.episode_id === ep);
  }

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
    return {
      path: n.path,
      title: n.frontmatter?.title ?? null,
      project: n.project || null,
      tags: n.tags || [],
      date: n.date || null,
    };
  });

  return { notes: list, total };
}

/**
 * Return facet values for filter dropdowns: projects, tags, folders.
 * @param {{ vault_path: string, ignore?: string[] }} config
 * @returns {{ projects: string[], tags: string[], folders: string[] }}
 */
export function runFacets(config) {
  const notes = getNotesWithMeta(config.vault_path, config);
  const projects = new Set();
  const tags = new Set();
  const folders = new Set();
  for (const n of notes) {
    if (n.project) projects.add(n.project);
    for (const t of n.tags || []) if (t) tags.add(t);
    const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : '';
    if (folder) folders.add(folder);
  }
  return {
    projects: [...projects].sort(),
    tags: [...tags].sort(),
    folders: [...folders].sort(),
  };
}
