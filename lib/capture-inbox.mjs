/**
 * Fast inbox capture (Issue #1 Phase C3). No AIR — inbox exempt.
 */

import { loadConfig } from './config.mjs';
import { writeNote } from './write.mjs';
import { normalizeSlug, normalizeTags } from './vault.mjs';

function slugFromText(text, maxLen = 48) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
  return base || 'capture';
}

/**
 * @param {string} text
 * @param {{ source?: string, project?: string, tags?: string[] }} options
 * @returns {{ path: string, written: boolean }}
 */
export function runCaptureInbox(text, options = {}) {
  const config = loadConfig();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${hh}${mm}${ss}`;
  const slug = slugFromText(text);

  let relDir = 'inbox';
  if (options.project) {
    const proj = normalizeSlug(String(options.project));
    if (proj) relDir = `projects/${proj}/inbox`;
  }

  const filename = `${dateStr}-${timeStr}-${slug}.md`.replace(/-+/g, '-');
  const relativePath = `${relDir}/${filename}`;

  const tags = options.tags?.length ? normalizeTags(options.tags) : [];
  const tagStr = tags.length ? tags.join(', ') : undefined;

  const frontmatter = {
    source: options.source || 'mcp-capture',
    date: dateStr,
    inbox: true,
  };
  if (tagStr) frontmatter.tags = tagStr;
  if (options.project) frontmatter.project = normalizeSlug(String(options.project));

  return writeNote(config.vault_path, relativePath, {
    body: String(text || '').trim(),
    frontmatter,
  });
}
