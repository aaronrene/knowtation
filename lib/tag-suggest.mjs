/**
 * Suggest tags from similar notes (Issue #1 Phase C10).
 */

import { loadConfig } from './config.mjs';
import { readNote, normalizeTags, normalizeSlug } from './vault.mjs';
import { embed } from './embedding.mjs';
import { createVectorStore } from './vector-store.mjs';

/**
 * @param {{ path?: string, body?: string }} input - exactly one of path or body
 * @returns {Promise<{ suggested_tags: string[], existing_tags: string[] }>}
 */
export async function runTagSuggest(input) {
  const config = loadConfig();
  let text;
  let existing = [];
  if (input.path) {
    const note = readNote(config.vault_path, input.path);
    text = `${note.frontmatter?.title ? String(note.frontmatter.title) + '\n' : ''}${note.body || ''}`;
    existing = note.tags?.length ? note.tags : normalizeTags(note.frontmatter?.tags);
  } else if (input.body) {
    text = String(input.body);
  } else {
    throw new Error('tag_suggest requires path or body.');
  }

  const [vector] = await embed([text.slice(0, 12000)], config.embedding || {}, { voyageInputType: 'document' });
  if (!vector?.length) throw new Error('Embedding failed for tag_suggest.');

  const store = await createVectorStore(config);
  const hits = await store.search(vector, { limit: 15 });
  const tagCounts = new Map();
  const existingSet = new Set(existing.map((t) => normalizeSlug(String(t))).filter(Boolean));

  for (const h of hits) {
    let tags = h.tags || [];
    if (!tags.length) {
      try {
        const n = readNote(config.vault_path, h.path);
        tags = n.tags?.length ? n.tags : normalizeTags(n.frontmatter?.tags);
      } catch (_) {}
    }
    for (const t of tags) {
      const slug = normalizeSlug(String(t));
      if (!slug || existingSet.has(slug)) continue;
      tagCounts.set(slug, (tagCounts.get(slug) || 0) + 1);
    }
  }

  const suggested_tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 12);

  return { suggested_tags, existing_tags: existing };
}
