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

export const METADATA_FACETS_SCHEMA = 'knowtation.metadata_facets/v0';
export const METADATA_FACET_MAX_VALUES = 100;
export const METADATA_FACET_MAX_VALUE_CHARS = 256;

/**
 * Normalize parsed note frontmatter into the body-free MetadataFacets v0 shape.
 * This is intentionally pure: no file reads, no writes, no index updates, and no
 * body/frontmatter echoing.
 * @param {string} relativePath - Vault-relative note path.
 * @param {object} [frontmatter] - Parsed YAML/JSON frontmatter for the note.
 * @returns {{
 *   schema: string,
 *   path: string,
 *   facets: {
 *     project: string|null,
 *     tags: string[],
 *     date: string|null,
 *     updated: string|null,
 *     causal_chain_id: string|null,
 *     entity: string[],
 *     episode_id: string|null,
 *   },
 *   inferred: {
 *     folder: string|null,
 *     source_type: null,
 *   },
 *   truncated: boolean,
 * }}
 */
export function normalizeMetadataFacets(relativePath, frontmatter = {}) {
  const safePath = normalizeFacetRelativePath(relativePath);
  const fm = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter) ? frontmatter : {};
  let truncated = false;

  const capScalar = (value) => {
    const capped = capFacetValue(String(value));
    if (capped.truncated) truncated = true;
    return capped.value;
  };
  const capSlug = (value) => {
    const capped = capFacetSlug(String(value));
    if (capped.truncated) truncated = true;
    return capped.value || null;
  };
  const capSlugArray = (value) => {
    const capped = normalizeFacetSlugArray(value);
    if (capped.truncated) truncated = true;
    return capped.values;
  };

  const projectRaw = fm.project != null ? normalizeSlug(String(fm.project)) : effectiveProjectSlug(safePath, fm);
  const project = projectRaw ? capSlug(projectRaw) : null;
  const tags = capSlugArray(fm.tags);
  const date = fm.date != null ? capScalar(dateFacetString(fm.date)) : null;
  const updated = fm.updated != null ? capScalar(dateFacetString(fm.updated)) : null;
  const causalChainId = fm.causal_chain_id != null ? capSlug(fm.causal_chain_id) : null;
  const entity = fm.entity != null ? capSlugArray(fm.entity) : [];
  const episodeId = fm.episode_id != null ? capSlug(fm.episode_id) : null;
  const folder = inferredFolderForFacetPath(safePath);

  return {
    schema: METADATA_FACETS_SCHEMA,
    path: safePath,
    facets: {
      project,
      tags,
      date,
      updated,
      causal_chain_id: causalChainId,
      entity,
      episode_id: episodeId,
    },
    inferred: {
      folder,
      source_type: null,
    },
    truncated,
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function dateFacetString(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
function normalizeFacetRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('Invalid path: path must be a non-empty vault-relative string');
  }
  if (relativePath.includes('\0')) {
    throw new Error('Invalid path: path contains a null byte');
  }
  const forwardPath = relativePath.replace(/\\/g, '/');
  if (
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(forwardPath) ||
    /^[a-zA-Z]:\//.test(forwardPath) ||
    forwardPath.startsWith('//')
  ) {
    throw new Error('Invalid path: path must be vault-relative');
  }
  const normalized = path.posix.normalize(forwardPath);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Invalid path: path must be vault-relative and cannot escape vault');
  }
  return normalized;
}

/**
 * @param {string} relativePath
 * @returns {string|null}
 */
function inferredFolderForFacetPath(relativePath) {
  const folder = path.posix.dirname(relativePath);
  return folder === '.' ? null : folder;
}

/**
 * @param {string} value
 * @returns {{ value: string, truncated: boolean }}
 */
function capFacetValue(value) {
  if (value.length <= METADATA_FACET_MAX_VALUE_CHARS) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, METADATA_FACET_MAX_VALUE_CHARS), truncated: true };
}

/**
 * @param {string} value
 * @returns {{ value: string, truncated: boolean }}
 */
function capFacetSlug(value) {
  const slug = normalizeSlug(value);
  const capped = capFacetValue(slug);
  return {
    value: capped.value.replace(/-+$/g, ''),
    truncated: capped.truncated,
  };
}

/**
 * @param {unknown} value
 * @returns {{ values: string[], truncated: boolean }}
 */
function normalizeFacetSlugArray(value) {
  if (value == null) {
    return { values: [], truncated: false };
  }
  const rawValues = Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim());
  const values = [];
  let truncated = rawValues.length > METADATA_FACET_MAX_VALUES;
  for (const raw of rawValues.slice(0, METADATA_FACET_MAX_VALUES)) {
    const capped = capFacetSlug(String(raw));
    if (capped.truncated) truncated = true;
    if (capped.value) values.push(capped.value);
  }
  return { values, truncated };
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
  const fullPath = resolveExistingVaultFilePath(vaultPath, safe, relativePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  const { frontmatter, body } = parseFrontmatterAndBody(content);

  const project = effectiveProjectSlug(safe, frontmatter);
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

/**
 * True if relativePath is vault-safe and resolves to an existing regular file under vaultPath.
 * Used by the Hub to drop semantic-search hits that are not on disk for the active vault.
 * @param {string} vaultPath - Absolute vault root
 * @param {string} relativePath - Vault-relative path
 * @returns {boolean}
 */
export function noteFileExistsInVault(vaultPath, relativePath) {
  if (relativePath == null || typeof relativePath !== 'string' || !relativePath.trim()) return false;
  try {
    const safe = resolveVaultRelativePath(vaultPath, relativePath);
    resolveExistingVaultFilePath(vaultPath, safe, relativePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an existing note path and prove the real target stays inside the vault root.
 * This prevents symlinks inside the vault from exposing files outside the vault.
 * @param {string} vaultPath
 * @param {string} safeRelativePath
 * @param {string} originalRelativePath
 * @returns {string}
 */
function resolveExistingVaultFilePath(vaultPath, safeRelativePath, originalRelativePath) {
  const fullPath = path.join(vaultPath, safeRelativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${originalRelativePath}`);
  }

  const vaultReal = fs.realpathSync(vaultPath);
  const fileReal = fs.realpathSync(fullPath);
  if (!isPathInside(vaultReal, fileReal)) {
    throw new Error(`Invalid path: path escapes vault (${originalRelativePath})`);
  }
  if (!fs.statSync(fileReal).isFile()) {
    throw new Error(`Note not found: ${originalRelativePath}`);
  }
  return fileReal;
}

/**
 * @param {string} parentPath
 * @param {string} childPath
 * @returns {boolean}
 */
function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * Top-level directories under the vault (non-hidden) plus each immediate child of `projects/`
 * as `projects/<name>`. Used by Hub “New note” folder picker; includes empty dirs.
 * `inbox` is always listed first when present on disk; if missing, it is still prepended so the UI can default there.
 * @param {string} vaultPath - Absolute vault root
 * @returns {string[]} Vault-relative folder prefixes (no trailing slash)
 */
export function listVaultFolderOptions(vaultPath) {
  const out = new Set();
  if (!vaultPath || typeof vaultPath !== 'string' || !fs.existsSync(vaultPath)) {
    return ['inbox'];
  }
  let dirents;
  try {
    dirents = fs.readdirSync(vaultPath, { withFileTypes: true });
  } catch {
    return ['inbox'];
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    if (d.name.startsWith('.')) continue;
    out.add(d.name.replace(/\\/g, '/'));
  }
  if (out.has('projects')) {
    const projectsRoot = path.join(vaultPath, 'projects');
    try {
      const subs = fs.readdirSync(projectsRoot, { withFileTypes: true });
      for (const s of subs) {
        if (!s.isDirectory() || s.name.startsWith('.')) continue;
        out.add('projects/' + s.name.replace(/\\/g, '/'));
      }
    } catch {
      /* ignore */
    }
  }
  const rest = [...out].filter((x) => x !== 'inbox').sort((a, b) => a.localeCompare(b));
  return ['inbox', ...rest];
}

function inferProjectFromPath(relPath) {
  const m = String(relPath).replace(/\\/g, '/').match(/^projects\/([^/]+)/);
  return m ? normalizeSlug(m[1]) : undefined;
}

/**
 * Effective project slug for list/search/bulk ops: normalized `frontmatter.project` when set, else `projects/<slug>/` path inference.
 * Matches readNote / GET ?project= (see SPEC, docs/HUB-METADATA-BULK-OPS.md).
 * @param {string} relativePath - vault-relative path
 * @param {object} [frontmatter]
 * @returns {string|undefined}
 */
export function effectiveProjectSlug(relativePath, frontmatter) {
  const safe = String(relativePath ?? '').replace(/\\/g, '/');
  const fm = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter) ? frontmatter : {};
  if (fm.project != null) {
    return normalizeSlug(String(fm.project));
  }
  return inferProjectFromPath(safe);
}
