/**
 * Semantic search: embed query, vector store search, filters, SPEC §4.2 output shape.
 * Phase 3: folder, project, tag, limit, fields, snippet-chars, count-only.
 */

import { loadConfig } from './config.mjs';
import { embed } from './embedding.mjs';
import { createVectorStore } from './vector-store.mjs';
import { readNote, normalizeSlug } from './vault.mjs';
import { filterHitsByContentScope, resolveSearchFolderForContentScope } from './approval-log.mjs';
import { MAX_VECTOR_KNN } from './vector-knn-limit.mjs';

const DEFAULT_SNIPPET_CHARS = 300;

/**
 * Truncate text to max chars, at word boundary if possible.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateSnippet(text, maxChars) {
  if (text == null || typeof text !== 'string') return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > maxChars / 2) {
    return slice.slice(0, lastSpace) + '…';
  }
  return slice + '…';
}

/**
 * Run semantic search. Loads config, embeds query, searches vector store, formats per SPEC §4.2.
 * Phase 3.1: --since, --until, --order, --chain, --entity, --episode.
 * @param {string} query - Search query string
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
 *   vault_id?: string,
 *   content_scope?: 'all'|'notes'|'approval_logs'
 * }} options
 * @param {{ vault_path?: string, qdrant_url?: string, vector_store?: string, data_dir?: string, embedding?: object, ignore?: string[] }} [configOverride] - When provided (e.g. Hub), use instead of loadConfig()
 * @returns {Promise<{ results?: { path, snippet?, score, project, tags }[], count?: number, query: string }>}
 */
export async function runSearch(query, options = {}, configOverride = null) {
  const config = configOverride || loadConfig();
  const store = await createVectorStore(config);

  const countOnly = options.countOnly === true;
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const fields = options.fields || 'path+snippet';
  const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET_CHARS;

  const project = options.project != null ? normalizeSlug(String(options.project)) : undefined;
  const tag = options.tag != null ? normalizeSlug(String(options.tag)) : undefined;
  const folder = options.folder != null ? String(options.folder).trim() : undefined;
  const since = options.since != null ? String(options.since).trim() : undefined;
  const until = options.until != null ? String(options.until).trim() : undefined;
  const order = options.order === 'date-asc' ? 'date-asc' : (options.order === 'date' ? 'date' : undefined);
  const chain = options.chain != null ? normalizeSlug(String(options.chain)) : undefined;
  const entity = options.entity != null ? normalizeSlug(String(options.entity)) : undefined;
  const episode = options.episode != null ? normalizeSlug(String(options.episode)) : undefined;

  const vector = await embed([query], config.embedding);
  if (!vector || !vector[0]) {
    throw new Error('Embedding failed: no vector returned for query.');
  }

  const scope = options.content_scope || 'all';
  const resolved = resolveSearchFolderForContentScope(scope, folder);
  if (resolved.impossible) {
    if (countOnly) return { count: 0, query };
    return { results: [], query };
  }
  const effectiveFolder = resolved.folder;
  let searchLimit = countOnly ? 1000 : limit;
  if (!countOnly && resolved.wideNotesFetch) {
    searchLimit = Math.min(10000, Math.max(limit * 120, 2500));
  } else if (!countOnly && scope !== 'all') {
    searchLimit = Math.min(10000, Math.max(limit * 40, 800));
  }
  searchLimit = Math.min(searchLimit, MAX_VECTOR_KNN);
  let hits = await store.search(vector[0], {
    limit: searchLimit,
    vault_id: options.vault_id,
    project,
    tag,
    folder: effectiveFolder,
    since,
    until,
    order,
    chain,
    entity,
    episode,
  });
  hits = filterHitsByContentScope(hits, scope);
  if (countOnly) {
    return { count: hits.length, query };
  }
  hits = hits.slice(0, limit);

  const results = hits.map((h) => {
    const base = {
      path: h.path,
      score: h.score,
      project: h.project ?? null,
      tags: h.tags ?? [],
    };
    if (fields === 'path') {
      return base;
    }
    if (fields === 'path+snippet') {
      return {
        ...base,
        snippet: truncateSnippet(h.text, snippetChars),
      };
    }
    if (fields === 'full') {
      let frontmatter = {};
      let body = '';
      try {
        const note = readNote(config.vault_path, h.path);
        frontmatter = note.frontmatter || {};
        body = note.body || '';
      } catch (_) {
        body = truncateSnippet(h.text, snippetChars);
      }
      return {
        ...base,
        snippet: truncateSnippet(h.text, snippetChars),
        frontmatter,
        body,
      };
    }
    return { ...base, snippet: truncateSnippet(h.text, snippetChars) };
  });

  return { results, query };
}
