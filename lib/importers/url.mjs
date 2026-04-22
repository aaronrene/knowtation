/**
 * Import a public HTTPS URL into a vault note (article extract or bookmark).
 */

import crypto from 'crypto';
import path from 'path';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';
import { fetchUrlForImport } from '../url-fetch-safe.mjs';

/** @typedef {'auto' | 'bookmark' | 'extract'} UrlImportMode */

/**
 * Stable id from canonical URL (hex, 32 chars).
 * @param {string} canonicalUrl
 */
function sourceIdFromUrl(canonicalUrl) {
  return crypto.createHash('sha256').update(canonicalUrl, 'utf8').digest('hex').slice(0, 32);
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{ title: string, bodyMd: string } | null}
 */
function extractArticleMarkdown(html, pageUrl) {
  const { document } = parseHTML(html);
  const reader = new Readability(document, { url: pageUrl });
  const article = reader.parse();
  if (!article || (!article.content && !article.textContent)) return null;
  const title = (article.title || '').trim() || 'Imported page';
  let bodyMd = '';
  if (article.content && String(article.content).trim()) {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    bodyMd = td.turndown(article.content).trim();
  } else if (article.textContent) {
    bodyMd = String(article.textContent).trim();
  }
  if (!bodyMd || bodyMd.length < 40) return null;
  return { title, bodyMd };
}

/**
 * @param {string} url
 * @param {string} finalUrl
 * @param {string} titleGuess
 * @param {UrlImportMode} mode
 */
function bookmarkBody(url, finalUrl, titleGuess, mode) {
  const lines = [
    `[Open original](${finalUrl})`,
    '',
    `_Imported as bookmark (${mode})._`,
  ];
  if (url !== finalUrl) lines.push('', `Requested: ${url}`);
  return lines.join('\n');
}

/**
 * @param {string} input - HTTPS URL string
 * @param {{
 *   vaultPath: string,
 *   outputBase: string,
 *   project?: string | null,
 *   tags: string[],
 *   dryRun: boolean,
 *   urlMode?: UrlImportMode,
 *   onProgress?: (p: { progress: number, total?: number, message?: string }) => void | Promise<void>
 * }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importUrl(input, ctx) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new Error('URL is required');

  const mode = ctx.urlMode === 'bookmark' || ctx.urlMode === 'extract' || ctx.urlMode === 'auto' ? ctx.urlMode : 'auto';
  const { vaultPath, outputBase, project, tags, dryRun, onProgress } = ctx;

  if (onProgress) await onProgress({ progress: 0, total: 1, message: 'Fetching URL…' });

  const fetched = await fetchUrlForImport(raw);
  const canonical = fetched.finalUrl;
  const source_id = sourceIdFromUrl(canonical);
  const now = new Date().toISOString().slice(0, 10);
  const short = source_id.slice(0, 12);
  const outputRel = path.join(outputBase, 'imports', 'url', `${short}.md`).replace(/\\/g, '/');

  const ct = fetched.contentType || '';
  const isHtml = ct.includes('html') || fetched.text.trimStart().toLowerCase().startsWith('<!doctype') || fetched.text.includes('<html');

  let title = 'Imported link';
  let body = '';

  if (mode === 'bookmark') {
    title = new URL(canonical).hostname.replace(/^www\./, '') || title;
    body = bookmarkBody(raw, canonical, title, 'bookmark');
  } else if (mode === 'extract') {
    if (!isHtml) {
      throw new Error(`Extract mode requires HTML; got content-type "${ct || 'unknown'}"`);
    }
    const extracted = extractArticleMarkdown(fetched.text, canonical);
    if (!extracted) throw new Error('Could not extract readable article content from this page');
    title = extracted.title;
    body =
      extracted.bodyMd +
      '\n\n---\n\n' +
      `Source: [${canonical}](${canonical})\n` +
      (raw !== canonical ? `\nRequested URL: ${raw}\n` : '');
  } else {
    // auto
    if (isHtml) {
      const extracted = extractArticleMarkdown(fetched.text, canonical);
      if (extracted && extracted.bodyMd.length >= 80) {
        title = extracted.title;
        body =
          extracted.bodyMd +
          '\n\n---\n\n' +
          `Source: [${canonical}](${canonical})\n` +
          (raw !== canonical ? `\nRequested URL: ${raw}\n` : '');
      } else {
        title = new URL(canonical).hostname.replace(/^www\./, '') || title;
        body = bookmarkBody(raw, canonical, title, 'auto (fallback)');
      }
    } else {
      title = new URL(canonical).hostname.replace(/^www\./, '') || title;
      body =
        bookmarkBody(raw, canonical, title, 'auto (non-HTML)') +
        '\n\n' +
        (fetched.text.trim()
          ? '```\n' + fetched.text.trim().slice(0, 8000) + (fetched.text.length > 8000 ? '\n…' : '') + '\n```'
          : '');
    }
  }

  const merged = {
    title,
    date: now,
    source: 'url-import',
    source_id,
    canonical_url: canonical,
    ...(project && { project: normalizeSlug(project) }),
    ...(tags.length && { tags }),
  };
  if (typeof merged.tags === 'string') merged.tags = tags;
  else if (Array.isArray(merged.tags)) merged.tags = [...new Set([...merged.tags, ...tags])];
  else merged.tags = tags;

  if (!dryRun) {
    writeNote(vaultPath, outputRel, {
      body,
      frontmatter: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    });
  }

  if (onProgress) await onProgress({ progress: 1, total: 1, message: 'Done' });

  return { imported: [{ path: outputRel, source_id }], count: 1 };
}
