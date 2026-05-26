/**
 * Derived read-only outline for a single Markdown note.
 *
 * This module intentionally has no storage, search, vector, memory, MCP, Hub, or
 * PageIndex behavior. It parses current Markdown content and returns a minimal
 * data-only outline.
 */

import path from 'path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { normalizeSlug, parseFrontmatterAndBody } from './vault.mjs';

export const NOTE_OUTLINE_SCHEMA = 'knowtation.note_outline/v1';
export const MAX_NOTE_OUTLINE_INPUT_CHARS = 1_000_000;
export const MAX_NOTE_OUTLINE_HEADINGS = 500;

const parser = unified().use(remarkParse);

/**
 * Build a NoteOutline from a raw Markdown file string.
 * @param {string} notePath
 * @param {string} markdown
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{ schema: string, path: string, title: string|null, headings: { level: number, text: string, id: string }[], truncated: boolean }}
 */
export function buildNoteOutlineFromMarkdown(notePath, markdown, options = {}) {
  if (typeof markdown !== 'string') {
    throw new TypeError('buildNoteOutlineFromMarkdown: markdown must be a string');
  }
  const { frontmatter, body } = parseFrontmatterAndBody(markdown);
  return buildNoteOutline({ path: notePath, frontmatter, body }, options);
}

/**
 * Build a NoteOutline from a parsed vault note.
 * @param {{ path: string, frontmatter?: Record<string, unknown>, body: string }} note
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{ schema: string, path: string, title: string|null, headings: { level: number, text: string, id: string }[], truncated: boolean }}
 */
export function buildNoteOutline(note, options = {}) {
  if (note == null || typeof note !== 'object') {
    throw new TypeError('buildNoteOutline: note is required');
  }
  const safePath = normalizeOutlinePath(note.path);
  if (typeof note.body !== 'string') {
    throw new TypeError('buildNoteOutline: note.body must be a string');
  }

  const maxInputChars = normalizePositiveInteger(
    options.maxInputChars,
    MAX_NOTE_OUTLINE_INPUT_CHARS,
    'maxInputChars'
  );
  const maxHeadings = normalizePositiveInteger(
    options.maxHeadings,
    MAX_NOTE_OUTLINE_HEADINGS,
    'maxHeadings'
  );

  if (note.body.length > maxInputChars) {
    throw new Error(
      `Note outline input exceeds ${maxInputChars} characters; refusing to parse unbounded Markdown.`
    );
  }

  const tree = parser.parse(note.body);
  const headingNodes = [];
  collectHeadings(tree, headingNodes);

  const visibleHeadings = headingNodes.slice(0, maxHeadings);
  const headings = visibleHeadings.map((headingNode, index) => {
    const level = normalizeHeadingDepth(headingNode.depth);
    const text = normalizeHeadingText(extractPlainText(headingNode));
    return {
      level,
      text,
      id: headingId(level, text, index + 1),
    };
  });

  return {
    schema: NOTE_OUTLINE_SCHEMA,
    path: safePath,
    title: displayTitle(note.frontmatter, safePath),
    headings,
    truncated: headingNodes.length > maxHeadings,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {string} name
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback, name) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`buildNoteOutline: ${name} must be a positive integer`);
  }
  return n;
}

/**
 * @param {unknown} rawPath
 * @returns {string}
 */
function normalizeOutlinePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new TypeError('buildNoteOutline: note.path must be a non-empty string');
  }
  const forward = rawPath.trim().replace(/\\/g, '/');
  if (path.isAbsolute(rawPath) || /^[A-Za-z]:\//.test(forward)) {
    throw new Error(`Invalid path: path must be vault-relative (${rawPath})`);
  }
  const parts = forward.split('/').filter(Boolean);
  if (parts.includes('..')) {
    throw new Error(`Invalid path: path cannot escape vault (${rawPath})`);
  }
  return parts.join('/');
}

/**
 * @param {Record<string, unknown>|undefined} frontmatter
 * @param {string} notePath
 * @returns {string|null}
 */
function displayTitle(frontmatter, notePath) {
  const fm = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
    ? frontmatter
    : {};
  if (fm.title != null && String(fm.title).trim() !== '') {
    return String(fm.title).trim();
  }
  const base = path.basename(notePath).replace(/\.(md|markdown)$/i, '');
  const cleaned = base.replace(/[-_]+/g, ' ').trim();
  return cleaned || null;
}

/**
 * @param {unknown} depth
 * @returns {number}
 */
function normalizeHeadingDepth(depth) {
  const n = Number(depth);
  if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
  return 1;
}

/**
 * @param {unknown} node
 * @param {unknown[]} out
 */
function collectHeadings(node, out) {
  if (node == null || typeof node !== 'object') return;
  if (node.type === 'heading') {
    out.push(node);
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectHeadings(child, out);
    }
  }
}

/**
 * @param {unknown} node
 * @returns {string}
 */
function extractPlainText(node) {
  if (node == null || typeof node !== 'object') return '';
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'html') {
    return String(node.value ?? '');
  }
  if (node.type === 'break') return ' ';
  if ((node.type === 'image' || node.type === 'imageReference') && node.alt != null) {
    return String(node.alt);
  }
  if (!Array.isArray(node.children)) return '';
  return node.children.map((child) => extractPlainText(child)).join(' ');
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeHeadingText(raw) {
  return String(raw)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {number} level
 * @param {string} text
 * @param {number} ordinal
 * @returns {string}
 */
function headingId(level, text, ordinal) {
  const slug = normalizeSlug(text) || 'heading';
  return `h${level}-${slug}-${String(ordinal).padStart(4, '0')}`;
}
