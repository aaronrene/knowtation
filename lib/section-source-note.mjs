/**
 * Local note integration for SectionSource v0.
 *
 * This module reads one caller-authorized Markdown note through the existing
 * vault note-read path and derives body-free section source metadata on demand.
 * It intentionally adds no hosted transport, Hub route, search, index,
 * persistence, summaries, Scooling runtime behavior, PageIndex, OCR, LLM calls,
 * provider routing, snippets, or section body output.
 */

import { buildSectionSource } from './section-source.mjs';
import { readNote, resolveVaultRelativePath } from './vault.mjs';

/**
 * Read one vault note through the same local read path used by `get_note`, then
 * return body-free section source metadata for the current note content.
 * @param {string} vaultPath - Absolute path to the local vault root.
 * @param {string} relativePath - Vault-relative Markdown note path.
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{
 *   schema: string,
 *   path: string,
 *   title: string|null,
 *   sections: {
 *     section_id: string,
 *     heading_id: string,
 *     level: number,
 *     heading_path: string[],
 *     heading_text: string,
 *     child_section_ids: string[],
 *     body_available: boolean,
 *     body_returned: false,
 *     snippet_returned: false
 *   }[],
 *   truncated: boolean
 * }}
 */
export function readSectionSource(vaultPath, relativePath, options = {}) {
  resolveVaultRelativePath(vaultPath, relativePath);
  const note = readNote(vaultPath, relativePath);
  return buildSectionSource(note, options);
}
