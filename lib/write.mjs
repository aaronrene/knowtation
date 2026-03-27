/**
 * Write a note to the vault. Path validation, frontmatter merge, append. SPEC §4.1.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { resolveVaultRelativePath, readNote, parseFrontmatterAndBody, listMarkdownFiles } from './vault.mjs';

/**
 * Delete a note file under the vault. Path must be vault-relative and safe.
 * @param {string} vaultPath - Absolute path to vault root
 * @param {string} relativePath - Vault-relative path (e.g. inbox/foo.md)
 * @returns {{ path: string, deleted: boolean }}
 * @throws if path escapes vault, or file is missing / not a file
 */
export function deleteNote(vaultPath, relativePath) {
  const safe = resolveVaultRelativePath(vaultPath, relativePath);
  const fullPath = path.join(vaultPath, safe);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Note not found: ${safe}`);
  }
  fs.unlinkSync(fullPath);
  return { path: safe.replace(/\\/g, '/'), deleted: true };
}

/**
 * Normalize vault-relative path prefix for project/folder bulk delete.
 * @param {string} raw
 * @returns {string}
 * @throws if invalid or unsafe
 */
export function normalizePathPrefix(raw) {
  if (raw == null || typeof raw !== 'string') throw new Error('path_prefix required');
  let s = raw.trim().replace(/\\/g, '/');
  while (s.startsWith('/')) s = s.slice(1);
  while (s.endsWith('/')) s = s.slice(0, -1);
  if (!s) throw new Error('path_prefix cannot be empty');
  for (const seg of s.split('/')) {
    if (seg === '..' || seg === '.') throw new Error('Invalid path_prefix');
  }
  return s;
}

/**
 * @param {string} notePath
 * @param {string} prefixNorm
 */
export function notePathMatchesPrefix(notePath, prefixNorm) {
  const p = String(notePath || '').replace(/\\/g, '/');
  if (p === prefixNorm) return true;
  return p.startsWith(prefixNorm + '/');
}

/**
 * @param {string} vaultPath
 * @param {string} pathPrefixRaw
 * @returns {{ deleted: number, paths: string[] }}
 */
export function deleteNotesByPrefix(vaultPath, pathPrefixRaw, options = {}) {
  const prefixNorm = normalizePathPrefix(pathPrefixRaw);
  resolveVaultRelativePath(vaultPath, prefixNorm);
  const paths = listMarkdownFiles(vaultPath, { ignore: options.ignore || [] });
  const toDelete = paths.filter((rel) => notePathMatchesPrefix(rel, prefixNorm));
  const deletedPaths = [];
  for (const rel of toDelete) {
    try {
      deleteNote(vaultPath, rel);
      deletedPaths.push(rel.replace(/\\/g, '/'));
    } catch (e) {
      if (e.message && e.message.includes('not found')) continue;
      throw e;
    }
  }
  return { deleted: deletedPaths.length, paths: deletedPaths };
}


/**
 * Serialize frontmatter and body to Markdown file content.
 * @param {{ [key: string]: unknown }} frontmatter
 * @param {string} body
 * @returns {string}
 */
function toMarkdown(frontmatter, body) {
  const y = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${y}\n---\n${body || ''}`;
}

/**
 * Check if a vault-relative path is under inbox (global or project).
 * @param {string} relativePath - vault-relative, forward slashes
 * @returns {boolean}
 */
export function isInboxPath(relativePath) {
  const n = relativePath.replace(/\\/g, '/');
  return n === 'inbox' || n.startsWith('inbox/') || /^projects\/[^/]+\/inbox(\/|$)/.test(n);
}

/**
 * Write or update a note. Creates parent directories if needed.
 * @param {string} vaultPath - Absolute path to vault root
 * @param {string} relativePath - Vault-relative path (e.g. inbox/foo.md)
 * @param {{ body?: string, frontmatter?: Record<string, string>, append?: boolean }} options
 * @returns {{ path: string, written: boolean }}
 * @throws if path escapes vault or write fails
 */
export function writeNote(vaultPath, relativePath, options = {}) {
  const safe = resolveVaultRelativePath(vaultPath, relativePath);
  const fullPath = path.join(vaultPath, safe);

  let frontmatter = {};
  let body = options.body ?? '';

  const exists = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  if (exists) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const parsed = parseFrontmatterAndBody(content);
    frontmatter = { ...parsed.frontmatter };
    if (options.append) {
      body = (parsed.body || '') + (options.body ?? '');
    } else if (options.body === undefined) {
      body = parsed.body || '';
    }
  }

  const overrides = options.frontmatter ?? {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) continue;
    frontmatter[k] = String(v).trim();
  }

  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const out = toMarkdown(frontmatter, body);
  fs.writeFileSync(fullPath, out, 'utf8');

  return { path: safe.replace(/\\/g, '/'), written: true };
}
