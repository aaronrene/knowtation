/**
 * Derived read-only tree for a single Markdown note outline.
 *
 * This module intentionally has no file reads, storage, search, vector, memory,
 * MCP, Hub, summary, PageIndex, or OCR behavior. It converts an existing
 * heading-only NoteOutline shape into a nested data-only DocumentTree.
 */

import path from 'path';
import {
  buildNoteOutline,
  buildNoteOutlineFromMarkdown,
  MAX_NOTE_OUTLINE_HEADINGS,
} from './note-outline.mjs';

export const DOCUMENT_TREE_SCHEMA = 'knowtation.document_tree/v0';

/**
 * Build a DocumentTree from a raw Markdown file string.
 * @param {string} notePath
 * @param {string} markdown
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{ schema: string, path: string, title: string|null, root: { children: { id: string, level: number, text: string, children: unknown[] }[] }, truncated: boolean }}
 */
export function buildDocumentTreeFromMarkdown(notePath, markdown, options = {}) {
  return buildDocumentTreeFromOutline(
    buildNoteOutlineFromMarkdown(notePath, markdown, options)
  );
}

/**
 * Build a DocumentTree from a parsed vault note.
 * @param {{ path: string, frontmatter?: Record<string, unknown>, body: string }} note
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{ schema: string, path: string, title: string|null, root: { children: { id: string, level: number, text: string, children: unknown[] }[] }, truncated: boolean }}
 */
export function buildDocumentTree(note, options = {}) {
  return buildDocumentTreeFromOutline(buildNoteOutline(note, options));
}

/**
 * Build a DocumentTree from a NoteOutline-compatible object.
 * @param {{ path: string, title: string|null, headings: { level: number, text: string, id: string }[], truncated: boolean }} outline
 * @param {{ maxHeadings?: number }} [options]
 * @returns {{ schema: string, path: string, title: string|null, root: { children: { id: string, level: number, text: string, children: unknown[] }[] }, truncated: boolean }}
 */
export function buildDocumentTreeFromOutline(outline, options = {}) {
  if (outline == null || typeof outline !== 'object') {
    throw new TypeError('buildDocumentTreeFromOutline: outline is required');
  }

  const safePath = normalizeTreePath(outline.path);
  const title = normalizeTitle(outline.title);
  const { headings, truncated } = normalizeHeadings(outline.headings, options);
  const root = { children: [] };
  const stack = [{ level: 0, node: root }];

  for (const heading of headings) {
    const node = {
      id: heading.id,
      level: heading.level,
      text: heading.text,
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    stack[stack.length - 1].node.children.push(node);
    stack.push({ level: heading.level, node });
  }

  return {
    schema: DOCUMENT_TREE_SCHEMA,
    path: safePath,
    title,
    root,
    truncated: outline.truncated === true || truncated,
  };
}

/**
 * @param {unknown} rawPath
 * @returns {string}
 */
function normalizeTreePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new TypeError('buildDocumentTreeFromOutline: outline.path must be a non-empty string');
  }
  const forward = rawPath.trim().replace(/\\/g, '/');
  if (path.isAbsolute(rawPath) || path.isAbsolute(forward) || /^[A-Za-z]:\//.test(forward)) {
    throw new Error(`Invalid path: path must be vault-relative (${rawPath})`);
  }
  const parts = forward.split('/').filter(Boolean);
  if (parts.includes('..')) {
    throw new Error(`Invalid path: path cannot escape vault (${rawPath})`);
  }
  return parts.join('/');
}

/**
 * @param {unknown} title
 * @returns {string|null}
 */
function normalizeTitle(title) {
  if (title == null) return null;
  return String(title);
}

/**
 * @param {unknown} rawHeadings
 * @param {{ maxHeadings?: number }} options
 * @returns {{ headings: { level: number, text: string, id: string }[], truncated: boolean }}
 */
function normalizeHeadings(rawHeadings, options) {
  if (!Array.isArray(rawHeadings)) {
    throw new TypeError('buildDocumentTreeFromOutline: outline.headings must be an array');
  }
  const maxHeadings = normalizeMaxHeadings(options.maxHeadings);
  const visibleHeadings = rawHeadings.slice(0, maxHeadings);
  return {
    headings: visibleHeadings.map((heading, index) => normalizeHeading(heading, index)),
    truncated: rawHeadings.length > maxHeadings,
  };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeMaxHeadings(value) {
  if (value == null) return MAX_NOTE_OUTLINE_HEADINGS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError('buildDocumentTreeFromOutline: maxHeadings must be a positive integer');
  }
  return Math.min(n, MAX_NOTE_OUTLINE_HEADINGS);
}

/**
 * @param {unknown} rawHeading
 * @param {number} index
 * @returns {{ level: number, text: string, id: string }}
 */
function normalizeHeading(rawHeading, index) {
  if (rawHeading == null || typeof rawHeading !== 'object') {
    throw new TypeError(`buildDocumentTreeFromOutline: heading at index ${index} must be an object`);
  }
  const level = Number(rawHeading.level);
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new TypeError(`buildDocumentTreeFromOutline: heading.level at index ${index} must be 1 through 6`);
  }
  if (typeof rawHeading.id !== 'string' || rawHeading.id.trim() === '') {
    throw new TypeError(`buildDocumentTreeFromOutline: heading.id at index ${index} must be a non-empty string`);
  }
  if (typeof rawHeading.text !== 'string') {
    throw new TypeError(`buildDocumentTreeFromOutline: heading.text at index ${index} must be a string`);
  }
  return {
    level,
    text: rawHeading.text,
    id: rawHeading.id,
  };
}
