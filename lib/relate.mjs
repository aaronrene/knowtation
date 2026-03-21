/**
 * Semantic "related notes" for a path (Issue #1 Phase C1).
 */

import { loadConfig } from './config.mjs';
import { readNote, normalizeSlug } from './vault.mjs';
import { embed } from './embedding.mjs';
import { createVectorStore } from './vector-store.mjs';

const BODY_SLICE = 12000;

/**
 * @param {string} vaultRelativePath
 * @param {{ limit?: number, project?: string }} options
 * @returns {Promise<{ path: string, related: { path: string, score: number, title: string|null, snippet: string }[] }>}
 */
export async function runRelate(vaultRelativePath, options = {}) {
  const config = loadConfig();
  const note = readNote(config.vault_path, vaultRelativePath);
  const text = `${note.frontmatter?.title ? String(note.frontmatter.title) + '\n' : ''}${note.body || ''}`.slice(0, BODY_SLICE);
  const [vector] = await embed([text], config.embedding || {});
  if (!vector?.length) throw new Error('Embedding failed for relate.');

  const store = await createVectorStore(config);
  const want = Math.max(1, Math.min(options.limit ?? 5, 20));
  const hits = await store.search(vector, {
    limit: Math.min(want + 15, 50),
    project: options.project != null ? normalizeSlug(String(options.project)) : undefined,
  });

  const src = note.path.replace(/\\/g, '/');
  const seen = new Set();
  const related = [];
  for (const h of hits) {
    const p = (h.path || '').replace(/\\/g, '/');
    if (!p || p === src) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    let title = null;
    try {
      const n = readNote(config.vault_path, p);
      title = n.frontmatter?.title ?? null;
    } catch (_) {}
    related.push({
      path: p,
      score: h.score,
      title,
      snippet: (h.text || '').slice(0, 200).replace(/\s+/g, ' ').trim(),
    });
    if (related.length >= want) break;
  }

  return { path: src, related };
}
