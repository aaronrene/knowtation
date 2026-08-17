/**
 * Notion import. Fetches pages as markdown via Notion API (retrieve page as markdown).
 * Requires NOTION_API_KEY. Input: comma-separated page IDs or a single page ID.
 *
 * One note per page; frontmatter: source: notion, source_id: page_id, date, title (if available).
 */

import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28'; // Markdown endpoint may require 2026-03-11 on newer Notion API

/**
 * Fetch one Notion page as Markdown without writing to the vault.
 *
 * @param {string} pageId
 * @param {{ apiKey: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<string>}
 */
export async function fetchNotionPageMarkdown(pageId, { apiKey, fetchImpl = globalThis.fetch }) {
  if (typeof pageId !== 'string' || !pageId.trim()) throw new TypeError('Notion page id is required');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Notion API key is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const url = `${NOTION_API_BASE}/pages/${encodeURIComponent(pageId.trim())}/markdown`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error('Notion page fetch failed');
  const data = await res.json();
  return typeof data.markdown === 'string' ? data.markdown : '';
}

/**
 * @param {string} input - Comma-separated Notion page IDs (e.g. "uuid1,uuid2") or single ID
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importNotion(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('NOTION_API_KEY is required for Notion import. Create an integration at notion.so/my-integrations.');
  }

  const pageIds = input.split(',').map((id) => id.trim()).filter(Boolean);
  if (!pageIds.length) {
    throw new Error('Provide at least one Notion page ID (or comma-separated list).');
  }

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < pageIds.length; i++) {
    const pageId = pageIds[i];
    const body = await fetchNotionPageMarkdown(pageId, { apiKey, fetchImpl: globalThis.fetch });
    const safeId = pageId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 16);
    const safeName = `notion-${safeId}-${i + 1}.md`;
    const outputRel = path.join(outputBase, safeName).replace(/\\/g, '/');

    const frontmatter = {
      source: 'notion',
      source_id: pageId,
      date: now,
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter });
    }
    imported.push({ path: outputRel, source_id: pageId });
  }

  return { imported, count: imported.length };
}
