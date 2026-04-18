/**
 * Obsidian-style `[[wikilink]]` parsing shared by local `lib/backlinks.mjs` and hosted MCP `backlinks`.
 */

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

/**
 * Normalize wikilink inner text to comparable basename (no `.md`), lowercase.
 * @param {string} raw
 */
export function wikilinkTargetKey(raw) {
  const s = String(raw).trim();
  const last = s.split(/[/\\]/).pop() || s;
  return last.replace(/\.md$/i, '').toLowerCase();
}

/**
 * Target key for the note at `vaultRelativePath` (basename stem), same as local backlinks target.
 * @param {string} vaultRelativePath
 */
export function vaultBasenameTargetKey(vaultRelativePath) {
  const target = String(vaultRelativePath).replace(/\\/g, '/');
  return wikilinkTargetKey(target.split('/').pop() || target);
}

/**
 * If `body` contains a wikilink whose target normalizes to `targetKey`, return trimmed context around
 * the first match; otherwise `null`.
 * @param {string} body
 * @param {string} targetKey
 * @returns {string|null}
 */
export function findFirstWikilinkToTargetInBody(body, targetKey) {
  const text = body != null ? String(body) : '';
  WIKILINK.lastIndex = 0;
  let m;
  while ((m = WIKILINK.exec(text)) !== null) {
    if (wikilinkTargetKey(m[1]) !== targetKey) continue;
    const start = Math.max(0, m.index - 60);
    const end = Math.min(text.length, m.index + m[0].length + 60);
    return text.slice(start, end).replace(/\s+/g, ' ').trim();
  }
  return null;
}
