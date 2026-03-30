/**
 * Keyword search: substring or all-terms matching over vault note path, body, and selected frontmatter.
 * Same filter dimensions as list-notes / semantic search where applicable.
 */

import { loadConfig } from './config.mjs';
import { getNotesWithMeta, filterNotesByListOptions } from './list-notes.mjs';
import { effectiveProjectSlug, normalizeSlug, normalizeTags } from './vault.mjs';
import { truncateSnippet } from './search.mjs';

const DEFAULT_SNIPPET_CHARS = 300;

/**
 * Build a readNote-shaped record from a hosted export JSON element (path, body, frontmatter string or object).
 * @param {{ path?: string, body?: string, frontmatter?: string|object }} n
 * @returns {{ path: string, body: string, frontmatter: object, project?: string, tags?: string[], date?: string, updated?: string, causal_chain_id?: string, entity?: string[], episode_id?: string }}
 */
export function noteRecordFromExportPayload(n) {
  const path = n.path != null ? String(n.path) : '';
  const body = n.body != null ? String(n.body) : '';
  let fm = {};
  if (typeof n.frontmatter === 'string') {
    try {
      const parsed = JSON.parse(n.frontmatter);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fm = parsed;
    } catch (_) {
      fm = {};
    }
  } else if (n.frontmatter && typeof n.frontmatter === 'object' && !Array.isArray(n.frontmatter)) {
    fm = /** @type {Record<string, unknown>} */ (n.frontmatter);
  }
  const project = effectiveProjectSlug(path, fm);
  const tags = normalizeTags(fm.tags);
  const date =
    fm.date != null
      ? fm.date instanceof Date
        ? fm.date.toISOString()
        : String(fm.date)
      : undefined;
  const updated =
    fm.updated != null
      ? fm.updated instanceof Date
        ? fm.updated.toISOString()
        : String(fm.updated)
      : undefined;
  const causal_chain_id =
    fm.causal_chain_id != null ? normalizeSlug(String(fm.causal_chain_id)) : undefined;
  const entityRaw = fm.entity;
  const entity =
    entityRaw != null
      ? (Array.isArray(entityRaw) ? entityRaw : [entityRaw]).map((e) => normalizeSlug(String(e))).filter(Boolean)
      : undefined;
  const episode_id = fm.episode_id != null ? normalizeSlug(String(fm.episode_id)) : undefined;
  return {
    path,
    body,
    frontmatter: fm,
    project,
    tags,
    date,
    updated,
    causal_chain_id,
    entity,
    episode_id,
  };
}

/**
 * @param {Record<string, unknown>} fm
 */
function frontmatterSearchStrings(fm) {
  if (!fm || typeof fm !== 'object') return '';
  const keys = ['title', 'intent', 'source', 'proposal_id', 'target_path', 'description', 'summary'];
  const parts = [];
  for (const k of keys) {
    const v = fm[k];
    if (v != null && typeof v !== 'object') parts.push(String(v));
  }
  if (fm.tags != null) parts.push(Array.isArray(fm.tags) ? fm.tags.join(' ') : String(fm.tags));
  return parts.join('\n');
}

/**
 * @param {{ path: string, body?: string, frontmatter?: object }} note
 */
export function keywordHaystackForNote(note) {
  const fm = note.frontmatter && typeof note.frontmatter === 'object' ? note.frontmatter : {};
  const fmStr = frontmatterSearchStrings(fm);
  return [note.path || '', fmStr, note.body || ''].join('\n');
}

/**
 * Pure keyword rank/filter on an already-filtered list of notes (same shape as readNote output).
 * @param {Array<{ path: string, body?: string, frontmatter?: object, project?: string, tags?: string[], date?: string, updated?: string }>} notes
 * @param {string} query
 * @param {{
 *   match?: 'phrase'|'all_terms',
 *   order?: string,
 *   limit?: number,
 *   fields?: string,
 *   snippetChars?: number,
 *   countOnly?: boolean,
 * }} options
 * @returns {{ results?: Array<{ path: string, score: number, project?: string|null, tags?: string[], snippet?: string, frontmatter?: object, body?: string }>, count?: number, query: string, mode: 'keyword' }}
 */
export function keywordSearchNotesArray(notes, query, options = {}) {
  const rawQ = query != null ? String(query).trim() : '';
  const match = options.match === 'all_terms' ? 'all_terms' : 'phrase';
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const fields = options.fields || 'path+snippet';
  const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET_CHARS;
  const countOnly = options.countOnly === true;
  const order = options.order === 'date-asc' ? 'date-asc' : options.order === 'date' ? 'date' : undefined;

  if (!rawQ) {
    if (countOnly) return { count: 0, query: rawQ, mode: 'keyword' };
    return { results: [], query: rawQ, mode: 'keyword' };
  }

  const lowerHay = (note) => keywordHaystackForNote(note).toLowerCase();
  const qLower = rawQ.toLowerCase();

  /** @type {Array<{ note: typeof notes[0], score: number }>} */
  const matched = [];

  if (match === 'phrase') {
    for (const note of notes) {
      const h = lowerHay(note);
      if (h.includes(qLower)) {
        matched.push({ note, score: 1 });
      }
    }
  } else {
    const terms = rawQ
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (terms.length === 0) {
      if (countOnly) return { count: 0, query: rawQ, mode: 'keyword' };
      return { results: [], query: rawQ, mode: 'keyword' };
    }
    for (const note of notes) {
      const h = lowerHay(note);
      let matchedTerms = 0;
      let ok = true;
      for (const t of terms) {
        if (h.includes(t)) matchedTerms += 1;
        else {
          ok = false;
          break;
        }
      }
      if (ok && terms.length > 0) {
        matched.push({ note, score: matchedTerms / terms.length });
      }
    }
  }

  const sorted = matched.sort((a, b) => {
    if (order === 'date-asc') {
      const da = a.note.date || a.note.updated || '';
      const db = b.note.date || b.note.updated || '';
      const c = String(da).localeCompare(String(db));
      if (c !== 0) return c;
    } else if (order === 'date') {
      const da = a.note.date || a.note.updated || '';
      const db = b.note.date || b.note.updated || '';
      const c = String(db).localeCompare(String(da));
      if (c !== 0) return c;
    }
    return (a.note.path || '').localeCompare(b.note.path || '');
  });

  if (countOnly) {
    return { count: sorted.length, query: rawQ, mode: 'keyword' };
  }

  const slice = sorted.slice(0, limit);
  const results = slice.map(({ note, score }) => {
    const base = {
      path: note.path,
      score,
      project: note.project ?? null,
      tags: Array.isArray(note.tags) ? note.tags : [],
    };
    const snipSource = note.body || keywordHaystackForNote(note);
    if (fields === 'path') {
      return base;
    }
    if (fields === 'path+snippet') {
      return { ...base, snippet: truncateSnippet(snipSource, snippetChars) };
    }
    if (fields === 'full') {
      return {
        ...base,
        snippet: truncateSnippet(snipSource, snippetChars),
        frontmatter: note.frontmatter || {},
        body: note.body || '',
      };
    }
    return { ...base, snippet: truncateSnippet(snipSource, snippetChars) };
  });

  return { results, query: rawQ, mode: 'keyword' };
}

/**
 * Keyword search over on-disk vault (CLI, MCP, Node Hub).
 * @param {string} query
 * @param {{
 *   folder?: string,
 *   project?: string,
 *   tag?: string,
 *   limit?: number,
 *   fields?: 'path'|'path+snippet'|'full',
 *   snippetChars?: number,
 *   countOnly?: boolean,
 *   since?: string,
 *   until?: string,
 *   order?: string,
 *   chain?: string,
 *   entity?: string,
 *   episode?: string,
 *   content_scope?: 'all'|'notes'|'approval_logs',
 *   match?: 'phrase'|'all_terms',
 * }} options
 * @param {{ vault_path?: string, ignore?: string[] }|null} configOverride
 */
export async function runKeywordSearch(query, options = {}, configOverride = null) {
  const config = configOverride || loadConfig();
  const vaultPath = config.vault_path;
  if (!vaultPath) {
    throw new Error('vault_path required for keyword search');
  }
  let notes = getNotesWithMeta(vaultPath, config);
  notes = filterNotesByListOptions(notes, options);
  return keywordSearchNotesArray(notes, query, options);
}
