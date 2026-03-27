/**
 * Hub bulk operations by metadata (project slug). Self-hosted Node Hub only; see docs/HUB-METADATA-BULK-OPS.md.
 */

import { runListNotes } from './list-notes.mjs';
import { deleteNote, writeNote } from './write.mjs';
import { readNote, normalizeSlug } from './vault.mjs';

/**
 * @param {string} vaultPath
 * @param {string} projectRaw
 * @param {{ ignore?: string[] }} [options]
 * @returns {{ deleted: number, paths: string[] }}
 */
export function deleteNotesByProjectSlug(vaultPath, projectRaw, options = {}) {
  const slug = normalizeSlug(String(projectRaw ?? '').trim());
  if (!slug) throw new Error('project slug required');
  const vc = { vault_path: vaultPath, ignore: options.ignore || [] };
  const out = runListNotes(vc, { project: slug, limit: 100000, offset: 0, fields: 'path' });
  const paths = (out.notes || []).map((n) => n.path).filter(Boolean);
  const deletedPaths = [];
  for (const rel of paths) {
    try {
      deleteNote(vaultPath, rel);
      deletedPaths.push(String(rel).replace(/\\/g, '/'));
    } catch (e) {
      if (e.message && e.message.includes('not found')) continue;
      throw e;
    }
  }
  return { deleted: deletedPaths.length, paths: deletedPaths };
}

/**
 * @param {string} vaultPath
 * @param {string} fromRaw
 * @param {string} toRaw
 * @param {{ ignore?: string[] }} [options]
 * @returns {{ updated: number, paths: string[] }}
 */
export function renameProjectSlugInVault(vaultPath, fromRaw, toRaw, options = {}) {
  const from = normalizeSlug(String(fromRaw ?? '').trim());
  const to = normalizeSlug(String(toRaw ?? '').trim());
  if (!from || !to) throw new Error('from and to project slugs required');
  if (from === to) return { updated: 0, paths: [] };
  const vc = { vault_path: vaultPath, ignore: options.ignore || [] };
  const out = runListNotes(vc, { project: from, limit: 100000, offset: 0, fields: 'path' });
  const paths = (out.notes || []).map((n) => n.path).filter(Boolean);
  const updatedPaths = [];
  for (const rel of paths) {
    const note = readNote(vaultPath, rel);
    writeNote(vaultPath, rel, { body: note.body, frontmatter: { project: to } });
    updatedPaths.push(String(rel).replace(/\\/g, '/'));
  }
  return { updated: updatedPaths.length, paths: updatedPaths };
}
