/**
 * Semantic clustering over notes (Issue #1 Phase C8).
 * Embeds truncated note text (up to 200 notes) and runs k-means — works with Qdrant or sqlite-vec without reading raw vectors from the store.
 */

import { loadConfig } from './config.mjs';
import { listMarkdownFiles, readNote, normalizeSlug } from './vault.mjs';
import { embed } from './embedding.mjs';
import { kmeans } from './kmeans.mjs';

const MAX_NOTES = 200;
const TEXT_SLICE = 800;

/**
 * @param {{ project?: string, folder?: string, n_clusters?: number }} options
 */
export async function runCluster(options = {}) {
  const config = loadConfig();
  const k = Math.max(2, Math.min(options.n_clusters ?? 5, 15));
  let paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });

  if (options.folder) {
    const prefix = options.folder.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    const exact = options.folder.replace(/\\/g, '/').replace(/\/$/, '');
    paths = paths.filter((p) => {
      const n = p.replace(/\\/g, '/');
      return n === exact || n.startsWith(prefix);
    });
  }

  const wantProject = options.project != null ? normalizeSlug(String(options.project)) : null;

  const texts = [];
  const pathFor = [];
  for (const p of paths) {
    if (pathFor.length >= MAX_NOTES) break;
    try {
      const note = readNote(config.vault_path, p);
      if (wantProject && note.project !== wantProject) continue;
      const t = `${note.frontmatter?.title ? String(note.frontmatter.title) + '\n' : ''}${(note.body || '').slice(0, TEXT_SLICE)}`;
      if (!t.trim()) continue;
      texts.push(t);
      pathFor.push(note.path.replace(/\\/g, '/'));
    } catch (_) {}
  }

  if (texts.length < k) {
    return {
      clusters: [],
      note: `Not enough notes (${texts.length}) for k=${k}. Add notes or lower n_clusters.`,
    };
  }

  const vectors = await embed(texts, config.embedding || {}, { voyageInputType: 'document' });
  const points = [];
  for (let i = 0; i < pathFor.length; i++) {
    const v = vectors[i];
    if (!v || !v.length) continue;
    points.push({ id: pathFor[i], vector: v, path: pathFor[i], text: texts[i] });
  }
  if (points.length < k) {
    return { clusters: [], note: 'Embedding failed for some notes.' };
  }

  const { labels } = kmeans(
    points.map((p) => ({ id: p.id, vector: p.vector })),
    k
  );

  const clusters = [];
  for (let c = 0; c < k; c++) {
    const members = [];
    for (let i = 0; i < points.length; i++) {
      if (labels[i] === c) members.push(points[i]);
    }
    if (!members.length) continue;
    const centroidSnippet = (members[0].text || '').slice(0, 120).replace(/\s+/g, ' ').trim();
    const pathsIn = [...new Set(members.map((m) => m.path))];
    clusters.push({
      label: `cluster_${c + 1}`,
      centroid_snippet: centroidSnippet,
      paths: pathsIn,
    });
  }

  return { clusters, notes_sampled: points.length, max_notes: MAX_NOTES };
}
