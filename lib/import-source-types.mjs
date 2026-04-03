/**
 * Canonical import source_type strings for CLI, Hub API, Hub UI, and MCP.
 * Keep in sync with importers map keys in lib/import.mjs.
 */

/** @type {readonly string[]} */
export const IMPORT_SOURCE_TYPES = Object.freeze([
  'markdown',
  'chatgpt-export',
  'claude-export',
  'mif',
  'mem0-export',
  'notion',
  'jira-export',
  'notebooklm',
  'gdrive',
  'linear-export',
  'audio',
  'video',
  'wallet-csv',
]);

/** Comma-separated list for help text and errors. */
export const IMPORT_SOURCE_TYPES_HELP = IMPORT_SOURCE_TYPES.join(', ');

/**
 * @param {string} sourceType
 * @returns {boolean}
 */
export function isValidImportSourceType(sourceType) {
  return IMPORT_SOURCE_TYPES.includes(sourceType);
}
