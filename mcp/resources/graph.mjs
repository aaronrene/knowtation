/**
 * Knowledge graph resource (Issue #1 Phase A5).
 */

import { listMarkdownFiles, readNote, normalizeSlug } from '../../lib/vault.mjs';
import { MCP_RESOURCE_PAGE_SIZE } from './pagination.mjs';

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 */
export function buildKnowledgeGraph(config) {
  const paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
  const pathSet = new Set(paths.map((p) => p.replace(/\\/g, '/')));
  const allNotes = [];

  for (const p of paths) {
    try {
      allNotes.push(readNote(config.vault_path, p));
    } catch (_) {}
  }

  const nodes = allNotes.map((note) => ({
    path: note.path.replace(/\\/g, '/'),
    title: note.frontmatter?.title ?? null,
    tags: note.tags || [],
    project: note.project ?? null,
  }));

  const edges = [];
  const byBasename = new Map();
  for (const n of allNotes) {
    const rel = n.path.replace(/\\/g, '/');
    const base = rel.replace(/\.md$/i, '').split('/').pop();
    if (base) byBasename.set(base.toLowerCase(), rel);
  }

  for (const note of allNotes) {
    const rel = note.path.replace(/\\/g, '/');

    const follows = note.frontmatter?.follows;
    if (follows) {
      const target = String(follows).replace(/\\/g, '/');
      const to = pathSet.has(target) ? target : pathSet.has(`${target}.md`) ? `${target}.md` : null;
      if (to) edges.push({ from: rel, to, type: 'follows' });
    }

    const summarizes = note.frontmatter?.summarizes;
    if (summarizes) {
      const target = String(summarizes).replace(/\\/g, '/');
      const to = pathSet.has(target) ? target : pathSet.has(`${target}.md`) ? `${target}.md` : null;
      if (to) edges.push({ from: rel, to, type: 'summarizes' });
    }

    let m;
    const body = note.body || '';
    WIKILINK.lastIndex = 0;
    while ((m = WIKILINK.exec(body)) !== null) {
      const raw = m[1].trim();
      const targetBase = raw.replace(/\.md$/i, '').split('/').pop().toLowerCase();
      const resolved = byBasename.get(targetBase);
      if (resolved && resolved !== rel) {
        edges.push({ from: rel, to: resolved, type: 'wikilink' });
      }
    }
  }

  const byChain = new Map();
  for (const note of allNotes) {
    const c = note.frontmatter?.causal_chain_id;
    if (c == null) continue;
    const k = normalizeSlug(String(c));
    if (!k) continue;
    const rel = note.path.replace(/\\/g, '/');
    if (!byChain.has(k)) byChain.set(k, []);
    byChain.get(k).push(rel);
  }
  for (const group of byChain.values()) {
    if (group.length < 2) continue;
    group.sort();
    for (let i = 1; i < group.length; i++) {
      edges.push({ from: group[i - 1], to: group[i], type: 'causal_chain' });
    }
  }

  if (nodes.length > MCP_RESOURCE_PAGE_SIZE) {
    const keep = new Set(nodes.slice(0, MCP_RESOURCE_PAGE_SIZE).map((n) => n.path));
    return {
      truncated: true,
      node_limit: MCP_RESOURCE_PAGE_SIZE,
      nodes: nodes.slice(0, MCP_RESOURCE_PAGE_SIZE),
      edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
      note: `Graph truncated to ${MCP_RESOURCE_PAGE_SIZE} nodes; refine with list/search tools.`,
    };
  }

  return { nodes, edges, truncated: false };
}
