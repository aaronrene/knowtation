/**
 * Derive Hub filter facets from canister list-note rows (path + frontmatter JSON string).
 * Mirrors web/hub/hub.js list normalization enough for dropdowns and Quick chips.
 */

import {
  parseFrontmatterJsonText,
  materializeWireFrontmatter as materializeListFrontmatter,
} from '../../lib/parse-frontmatter-json.mjs';

export { parseFrontmatterJsonText, materializeWireFrontmatter as materializeListFrontmatter };

export function tagsFromFm(fm) {
  const raw = fm && fm.tags;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * @param {Array<{ path?: string, frontmatter?: unknown }>} notes
 * @returns {{ projects: string[], tags: string[], folders: string[] }}
 */
export function deriveFacetsFromCanisterNotes(notes) {
  const projects = new Set();
  const tags = new Set();
  const folders = new Set();
  for (const n of notes) {
    if (!n || typeof n !== 'object') continue;
    const path = n.path;
    if (path) {
      const seg = String(path).split('/')[0];
      if (seg) folders.add(seg);
    }
    const fm = materializeListFrontmatter(n.frontmatter);
    if (fm.project != null && String(fm.project).trim()) projects.add(String(fm.project));
    for (const t of tagsFromFm(fm)) tags.add(String(t));
  }
  return {
    projects: [...projects].sort((a, b) => a.localeCompare(b)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
  };
}
