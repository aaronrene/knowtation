/**
 * Vault listing JSON for MCP resources (Issue #1 Phase A2).
 */

import fs from 'fs';
import path from 'path';
import { runListNotes } from '../../lib/list-notes.mjs';
import { MCP_RESOURCE_PAGE_SIZE } from './pagination.mjs';

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 * @param {string} folderPrefix - vault-relative folder prefix (e.g. "", "inbox", "projects/foo", "captures")
 */
export function buildVaultListing(config, folderPrefix = '') {
  const folder = folderPrefix.replace(/\\/g, '/').replace(/\/$/, '') || undefined;
  const out = runListNotes(config, {
    folder,
    limit: MCP_RESOURCE_PAGE_SIZE,
    offset: 0,
    order: 'date',
    fields: 'path+metadata',
  });
  return {
    folder: folder || '/',
    notes: out.notes,
    total: out.total,
    limit: MCP_RESOURCE_PAGE_SIZE,
    truncated: out.total > MCP_RESOURCE_PAGE_SIZE,
  };
}

/**
 * List non-markdown media files under vault-relative dir (audio/video).
 * @param {string} vaultPath
 * @param {string} relDir - e.g. media/audio
 * @param {string[]} extensions - e.g. ['.mp3','.m4a']
 */
export function listMediaFiles(vaultPath, relDir, extensions) {
  const dir = path.join(vaultPath, relDir.replace(/\\/g, '/'));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { folder: relDir, files: [], total: 0 };
  }
  const files = [];
  const walk = (d, prefix) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (extensions.includes(ext)) files.push(rel.replace(/\\/g, '/'));
      }
    }
  };
  walk(dir, '');
  files.sort();
  const slice = files.slice(0, MCP_RESOURCE_PAGE_SIZE);
  return {
    folder: relDir,
    files: slice,
    total: files.length,
    limit: MCP_RESOURCE_PAGE_SIZE,
    truncated: files.length > MCP_RESOURCE_PAGE_SIZE,
  };
}

/**
 * List .md files under vault/templates (not using global ignore for this resource).
 */
export function listTemplateFiles(vaultPath) {
  const tdir = path.join(vaultPath, 'templates');
  if (!fs.existsSync(tdir) || !fs.statSync(tdir).isDirectory()) {
    return { templates: [], total: 0 };
  }
  const md = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else if (e.isFile() && e.name.endsWith('.md')) md.push(`templates/${rel.replace(/\\/g, '/')}`);
    }
  };
  walk(tdir, '');
  md.sort();
  return { templates: md, total: md.length };
}
