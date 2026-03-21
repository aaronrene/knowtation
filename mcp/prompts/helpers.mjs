/**
 * Shared helpers for MCP prompts (Issue #1 Phase B).
 */

import { readNote } from '../../lib/vault.mjs';
import { noteToMarkdown } from '../resources/note.mjs';

export const MAX_EMBEDDED_NOTES = 12;
export const MAX_ENTITY_NOTES = 20;
export const PROJECT_SUMMARY_NOTES = 15;
export const CONTENT_PLAN_NOTES = 25;

/** @param {string} text */
export function textContent(text) {
  return { type: 'text', text };
}

/**
 * @param {string} uri
 * @param {string} text markdown body
 */
export function embeddedMarkdownResource(uri, text) {
  return {
    type: 'resource',
    resource: {
      uri,
      mimeType: 'text/markdown',
      text,
    },
  };
}

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 * @param {string} relPath vault-relative
 */
export function embeddedNoteFromPath(config, relPath) {
  const norm = relPath.replace(/\\/g, '/').replace(/^\//, '');
  const note = readNote(config.vault_path, norm);
  const uri = `knowtation://vault/${norm}`;
  return embeddedMarkdownResource(uri, noteToMarkdown(note));
}

/** @param {string} [body] @param {number} [max] */
export function snippet(body, max = 200) {
  const t = (body || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** @param {string | undefined} s @param {number} def */
export function parseIntSafe(s, def) {
  const n = parseInt(String(s ?? '').trim(), 10);
  return Number.isFinite(n) ? n : def;
}
