/**
 * Body-free section source metadata for one Markdown note.
 *
 * This module is intentionally pure: no file reads, writes, CLI, MCP, hosted
 * transport, Hub, search, indexes, vectors, memory, summaries, PageIndex, OCR,
 * LLM calls, provider routing, snippets, or section body output.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { buildDocumentTreeFromOutline } from './document-tree.mjs';
import { buildNoteOutline, buildNoteOutlineFromMarkdown } from './note-outline.mjs';
import { normalizeSlug, parseFrontmatterAndBody } from './vault.mjs';

export const SECTION_SOURCE_SCHEMA = 'knowtation.section_source/v0';

const parser = unified().use(remarkParse);

/**
 * Build body-free SectionSource metadata from a raw Markdown file string.
 * @param {string} notePath
 * @param {string} markdown
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{
 *   schema: string,
 *   path: string,
 *   title: string|null,
 *   sections: {
 *     section_id: string,
 *     heading_id: string,
 *     level: number,
 *     heading_path: string[],
 *     heading_text: string,
 *     child_section_ids: string[],
 *     body_available: boolean,
 *     body_returned: false,
 *     snippet_returned: false
 *   }[],
 *   truncated: boolean
 * }}
 */
export function buildSectionSourceFromMarkdown(notePath, markdown, options = {}) {
  if (typeof markdown !== 'string') {
    throw new TypeError('buildSectionSourceFromMarkdown: markdown must be a string');
  }
  const { frontmatter, body } = parseFrontmatterAndBody(markdown);
  return buildSectionSource({ path: notePath, frontmatter, body }, options);
}

/**
 * Build body-free SectionSource metadata from a parsed vault note.
 * @param {{ path: string, frontmatter?: Record<string, unknown>, body: string }} note
 * @param {{ maxInputChars?: number, maxHeadings?: number }} [options]
 * @returns {{
 *   schema: string,
 *   path: string,
 *   title: string|null,
 *   sections: {
 *     section_id: string,
 *     heading_id: string,
 *     level: number,
 *     heading_path: string[],
 *     heading_text: string,
 *     child_section_ids: string[],
 *     body_available: boolean,
 *     body_returned: false,
 *     snippet_returned: false
 *   }[],
 *   truncated: boolean
 * }}
 */
export function buildSectionSource(note, options = {}) {
  if (note == null || typeof note !== 'object') {
    throw new TypeError('buildSectionSource: note is required');
  }
  if (typeof note.body !== 'string') {
    throw new TypeError('buildSectionSource: note.body must be a string');
  }

  const outline = buildNoteOutline(note, options);
  return buildSectionSourceFromOutlineAndBody(outline, note.body, options);
}

/**
 * Build SectionSource metadata from a NoteOutline-compatible object plus the
 * current Markdown body. The body is parsed only to derive body availability and
 * is never returned.
 * @param {{ path: string, title: string|null, headings: { level: number, text: string, id: string }[], truncated: boolean }} outline
 * @param {string} markdownBody
 * @param {{ maxHeadings?: number }} [options]
 * @returns {{
 *   schema: string,
 *   path: string,
 *   title: string|null,
 *   sections: {
 *     section_id: string,
 *     heading_id: string,
 *     level: number,
 *     heading_path: string[],
 *     heading_text: string,
 *     child_section_ids: string[],
 *     body_available: boolean,
 *     body_returned: false,
 *     snippet_returned: false
 *   }[],
 *   truncated: boolean
 * }}
 */
export function buildSectionSourceFromOutlineAndBody(outline, markdownBody, options = {}) {
  if (typeof markdownBody !== 'string') {
    throw new TypeError('buildSectionSourceFromOutlineAndBody: markdownBody must be a string');
  }

  const tree = buildDocumentTreeFromOutline(outline, options);
  const bodyAvailability = bodyAvailabilityByHeadingId(markdownBody, tree.root.children);
  const sectionIds = new Map();
  const pathSlug = normalizeSlug(tree.path) || 'note';

  assignSectionIds(tree.root.children, pathSlug, sectionIds);

  return {
    schema: SECTION_SOURCE_SCHEMA,
    path: tree.path,
    title: tree.title,
    sections: flattenSections(tree.root.children, [], sectionIds, bodyAvailability),
    truncated: tree.truncated,
  };
}

/**
 * @param {{ id: string, children: unknown[] }[]} nodes
 * @param {string} pathSlug
 * @param {Map<string, string>} sectionIds
 */
function assignSectionIds(nodes, pathSlug, sectionIds) {
  for (const node of nodes) {
    const sectionId = `${pathSlug}:${node.id}`;
    sectionIds.set(node.id, sectionId);
    assignSectionIds(node.children, pathSlug, sectionIds);
  }
}

/**
 * @param {{ id: string, level: number, text: string, children: unknown[] }[]} nodes
 * @param {string[]} ancestors
 * @param {Map<string, string>} sectionIds
 * @param {Map<string, boolean>} bodyAvailability
 * @returns {{
 *   section_id: string,
 *   heading_id: string,
 *   level: number,
 *   heading_path: string[],
 *   heading_text: string,
 *   child_section_ids: string[],
 *   body_available: boolean,
 *   body_returned: false,
 *   snippet_returned: false
 * }[]}
 */
function flattenSections(nodes, ancestors, sectionIds, bodyAvailability) {
  const out = [];
  for (const node of nodes) {
    const headingPath = [...ancestors, node.text];
    out.push({
      section_id: sectionIds.get(node.id),
      heading_id: node.id,
      level: node.level,
      heading_path: headingPath,
      heading_text: node.text,
      child_section_ids: node.children.map((child) => sectionIds.get(child.id)),
      body_available: bodyAvailability.get(node.id) === true,
      body_returned: false,
      snippet_returned: false,
    });
    out.push(...flattenSections(node.children, headingPath, sectionIds, bodyAvailability));
  }
  return out;
}

/**
 * @param {string} markdownBody
 * @param {{ id: string }[]} visibleTreeNodes
 * @returns {Map<string, boolean>}
 */
function bodyAvailabilityByHeadingId(markdownBody, visibleTreeNodes) {
  const visibleHeadingIds = flattenTreeHeadingIds(visibleTreeNodes);
  const ast = parser.parse(markdownBody);
  const headingNodes = [];
  collectHeadingNodes(ast, headingNodes);
  const topLevelBlocks = Array.isArray(ast.children) ? ast.children : [];
  const out = new Map();

  visibleHeadingIds.forEach((headingId, visibleIndex) => {
    const headingNode = headingNodes[visibleIndex];
    if (!headingNode) {
      out.set(headingId, false);
      return;
    }
    out.set(headingId, hasBodyContentInBoundary(headingNode, headingNodes, visibleIndex, topLevelBlocks));
  });

  return out;
}

/**
 * @param {{ id: string, children?: unknown[] }[]} nodes
 * @returns {string[]}
 */
function flattenTreeHeadingIds(nodes) {
  const out = [];
  for (const node of nodes) {
    out.push(node.id);
    out.push(...flattenTreeHeadingIds(Array.isArray(node.children) ? node.children : []));
  }
  return out;
}

/**
 * @param {unknown} node
 * @param {unknown[]} out
 */
function collectHeadingNodes(node, out) {
  if (node == null || typeof node !== 'object') return;
  if (node.type === 'heading') {
    out.push(node);
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectHeadingNodes(child, out);
    }
  }
}

/**
 * @param {unknown} headingNode
 * @param {unknown[]} headingNodes
 * @param {number} headingIndex
 * @param {unknown[]} topLevelBlocks
 * @returns {boolean}
 */
function hasBodyContentInBoundary(headingNode, headingNodes, headingIndex, topLevelBlocks) {
  const startOffset = endOffset(headingNode);
  const endBoundary = nextPeerOrAncestorStartOffset(headingNode, headingNodes, headingIndex);

  return topLevelBlocks.some((node) => {
    if (node == null || typeof node !== 'object' || node.type === 'heading') return false;
    const nodeStart = startOffsetOf(node);
    if (nodeStart == null || nodeStart < startOffset || nodeStart >= endBoundary) return false;
    return hasSubstantiveContent(node);
  });
}

/**
 * @param {unknown} headingNode
 * @param {unknown[]} headingNodes
 * @param {number} headingIndex
 * @returns {number}
 */
function nextPeerOrAncestorStartOffset(headingNode, headingNodes, headingIndex) {
  const currentDepth = Number(headingNode.depth);
  for (let index = headingIndex + 1; index < headingNodes.length; index += 1) {
    const candidate = headingNodes[index];
    if (Number(candidate.depth) <= currentDepth) {
      const offset = startOffsetOf(candidate);
      if (offset != null) return offset;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * @param {unknown} node
 * @returns {boolean}
 */
function hasSubstantiveContent(node) {
  if (node == null || typeof node !== 'object') return false;
  if (typeof node.value === 'string' && node.value.trim() !== '') return true;
  if (typeof node.alt === 'string' && node.alt.trim() !== '') return true;
  if (Array.isArray(node.children)) {
    return node.children.some((child) => hasSubstantiveContent(child));
  }
  return node.type === 'thematicBreak';
}

/**
 * @param {unknown} node
 * @returns {number|null}
 */
function startOffsetOf(node) {
  const offset = node?.position?.start?.offset;
  return Number.isInteger(offset) ? offset : null;
}

/**
 * @param {unknown} node
 * @returns {number}
 */
function endOffset(node) {
  const offset = node?.position?.end?.offset;
  return Number.isInteger(offset) ? offset : 0;
}
