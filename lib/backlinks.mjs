/**
 * Reverse wikilink index (Issue #1 Phase C2).
 */

import { listMarkdownFiles, readNote } from './vault.mjs';
import { findFirstWikilinkToTargetInBody, vaultBasenameTargetKey } from './wikilink.mjs';

/**
 * @param {import('./config.mjs').loadConfig extends () => infer R ? R : never} config
 * @param {string} vaultRelativePath - target note path
 * @returns {{ path: string, backlinks: { path: string, title: string|null, context: string }[] }}
 */
export function runBacklinks(config, vaultRelativePath) {
  const target = vaultRelativePath.replace(/\\/g, '/');
  const targetKey = vaultBasenameTargetKey(target);
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
    const context = findFirstWikilinkToTargetInBody(body, targetKey);
    if (context == null) continue;
    backlinks.push({
      path: rel,
      title: note.frontmatter?.title ?? null,
      context,
    });
  }

  return { path: target, backlinks };
}
