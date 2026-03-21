/**
 * Single-note markdown serialization for MCP note resources (Issue #1 Phase A1).
 */

import yaml from 'js-yaml';

/**
 * @param {{ path: string, frontmatter: object, body: string }} note
 * @returns {string}
 */
export function noteToMarkdown(note) {
  const fm = note.frontmatter && Object.keys(note.frontmatter).length > 0
    ? `---\n${yaml.dump(note.frontmatter).trimEnd()}\n---\n`
    : '';
  return `${fm}${note.body || ''}`;
}
