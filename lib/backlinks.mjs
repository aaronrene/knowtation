/**
 * Reverse wikilink index (Issue #1 Phase C2).
 */

import { listMarkdownFiles, readNote } from './vault.mjs';

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

/**
 * Normalize wikilink target to comparable basename (no .md).
 * @param {string} raw
 */
function linkTargetKey(raw) {
  const s = raw.trim();
  const last = s.split(/[/\\]/).pop() || s;
  return last.replace(/\.md$/i, '').toLowerCase();
}

/**
 * @param {import('./config.mjs').loadConfig extends () => infer R ? R : never} config
 * @param {string} vaultRelativePath - target note path
 * @returns {{ path: string, backlinks: { path: string, title: string|null, context: string }[] }}
 */
export function runBacklinks(config, vaultRelativePath) {
  const target = vaultRelativePath.replace(/\\/g, '/');
  const targetKey = linkTargetKey(target.split('/').pop() || target);
  const paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
  const backlinks = [];

  for (const p of paths) {
    const rel = p.replace(/\\/g, '/');
    if (rel === target) continue;
    let note;
    try {
      note = readNote(config.vault_path, p);
    } catch (_) {
      continue;
    }
    const body = note.body || '';
    WIKILINK.lastIndex = 0;
    let m;
    while ((m = WIKILINK.exec(body)) !== null) {
      const key = linkTargetKey(m[1]);
      if (key !== targetKey) continue;
      const start = Math.max(0, m.index - 60);
      const end = Math.min(body.length, m.index + m[0].length + 60);
      const context = body.slice(start, end).replace(/\s+/g, ' ').trim();
      backlinks.push({
        path: rel,
        title: note.frontmatter?.title ?? null,
        context,
      });
      break;
    }
  }

  return { path: target, backlinks };
}
