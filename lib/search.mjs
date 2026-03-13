/**
 * Semantic search: embed query, vector store search, filters, SPEC §4.2 output shape.
 * Phase 3: folder, project, tag, limit, fields, snippet-chars, count-only.
 */

import { loadConfig } from './config.mjs';
import { embed } from './embedding.mjs';
import { createVectorStore } from './vector-store.mjs';
import { readNote, normalizeSlug } from './vault.mjs';

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
 *   episode?: string
 * }} options
 * @returns {Promise<{ results?: { path, snippet?, score, project, tags }[], count?: number, query: string }>}
 */
export async function runSearch(query, options = {}) {
  const config = loadConfig();
  const store = createVectorStore(config);

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

  const hits = await store.search(vector[0], {
    limit: countOnly ? 1000 : limit,
    project,
    tag,
    folder,
    since,
    until,
    order,
    chain,
    entity,
    episode,
  });

  if (countOnly) {
    return { count: hits.length, query };
  }

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
