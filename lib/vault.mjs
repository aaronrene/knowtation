/**
 * Vault utilities: list Markdown files, parse frontmatter + body, normalize project/tags. SPEC §1-2.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Normalize project slug or tag: lowercase, a-z0-9 and hyphen only, no leading/trailing hyphen. SPEC §1.
 * @param {string} s
 * @returns {string}
 */
export function normalizeSlug(s) {
  if (typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalize tags: accept string (comma-sep) or array; return array of normalized strings.
 * @param {string|string[]} tags
 * @returns {string[]}
 */
export function normalizeTags(tags) {
  if (tags == null) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',').map((t) => t.trim());
  return arr.map(normalizeSlug).filter(Boolean);
}

/**
 * Parse frontmatter and body from Markdown content. Returns { frontmatter, body }.
 * @param {string} content
 * @returns {{ frontmatter: object, body: string }}
 */
export function parseFrontmatterAndBody(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trimEnd() };
  }
  let frontmatter = {};
  try {
    frontmatter = yaml.load(match[1]) || {};
  } catch (_) {
    // invalid YAML → treat as empty
  }
  return { frontmatter, body: match[2].trimEnd() };
}

/**
 * List all .md files under vault root, with vault-relative paths. Respects ignore list (folder names).
 * @param {string} vaultPath - Absolute path to vault root
 * @param {{ ignore?: string[] }} options - Folder names to skip (e.g. templates, meta)
 * @returns {string[]} Vault-relative paths (forward slashes)
 */
export function listMarkdownFiles(vaultPath, options = {}) {
  const ignore = new Set((options.ignore || []).map((p) => p.toLowerCase()));
  const out = [];

  function walk(dir, relDir = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (ignore.has(e.name.toLowerCase())) continue;
        walk(path.join(dir, e.name), rel);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  }

  walk(vaultPath);
  return out;
}

/**
 * Read one note from vault. Path must be vault-relative; validated to not escape vault.
 * @param {string} vaultPath - Absolute path to vault root
 * @param {string} relativePath - Vault-relative path (e.g. inbox/foo.md)
 * @returns {{ path: string, frontmatter: object, body: string, project?: string, tags?: string[], date?: string, updated?: string, causal_chain_id?: string, entity?: string[], episode_id?: string }}
 * @throws if path escapes vault or file not found
 */
export function readNote(vaultPath, relativePath) {
  const safe = resolveVaultRelativePath(vaultPath, relativePath);
  const fullPath = path.join(vaultPath, safe);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Note not found: ${relativePath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const { frontmatter, body } = parseFrontmatterAndBody(content);

  const project = frontmatter.project != null ? normalizeSlug(String(frontmatter.project)) : inferProjectFromPath(safe);
  const tags = normalizeTags(frontmatter.tags);
  const date =
    frontmatter.date != null
      ? frontmatter.date instanceof Date
        ? frontmatter.date.toISOString()
        : String(frontmatter.date)
      : undefined;
  const updated =
    frontmatter.updated != null
      ? frontmatter.updated instanceof Date
        ? frontmatter.updated.toISOString()
        : String(frontmatter.updated)
      : undefined;
  const causal_chain_id =
    frontmatter.causal_chain_id != null ? normalizeSlug(String(frontmatter.causal_chain_id)) : undefined;
  const entityRaw = frontmatter.entity;
  const entity =
    entityRaw != null
      ? (Array.isArray(entityRaw) ? entityRaw : [entityRaw]).map((e) => normalizeSlug(String(e))).filter(Boolean)
      : undefined;
  const episode_id =
    frontmatter.episode_id != null ? normalizeSlug(String(frontmatter.episode_id)) : undefined;

  return {
    path: safe.replace(/\\/g, '/'),
    frontmatter,
    body,
    project,
    tags,
    date,
    updated,
    causal_chain_id,
    entity,
    episode_id,
  };
}

/**
 * Ensure path is vault-relative and does not escape (no ..). Returns normalized relative path.
 * @param {string} vaultPath - Absolute vault root
 * @param {string} relativePath - User-provided path
 * @returns {string} Safe vault-relative path
 * @throws if path escapes vault
 */
export function resolveVaultRelativePath(vaultPath, relativePath) {
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid path: path must be vault-relative and cannot escape vault (${relativePath})`);
  }
  const full = path.resolve(vaultPath, normalized);
  if (!full.startsWith(path.resolve(vaultPath))) {
    throw new Error(`Invalid path: path escapes vault (${relativePath})`);
  }
  return path.relative(vaultPath, full).replace(/\\/g, '/');
}

function inferProjectFromPath(relPath) {
  const m = relPath.match(/^projects\/([^/]+)/);
  return m ? normalizeSlug(m[1]) : undefined;
}
