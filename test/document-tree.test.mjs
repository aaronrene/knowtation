/**
 * DocumentTree v0 pure builder tests.
 *
 * Phase 1A is builder-only: no file reads, CLI, MCP, hosted MCP, Hub, search,
 * index, vector, memory, persistence, summaries, PageIndex, or OCR behavior.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_TREE_SCHEMA,
  buildDocumentTree,
  buildDocumentTreeFromMarkdown,
  buildDocumentTreeFromOutline,
} from '../lib/document-tree.mjs';

function outline(overrides = {}) {
  return {
    schema: 'knowtation.note_outline/v1',
    path: 'notes/example.md',
    title: 'Example',
    headings: [],
    truncated: false,
    ...overrides,
  };
}

describe('DocumentTree v0 pure builder', () => {
  it('unit: returns v0 schema, path, title, empty root, and truncation flag', () => {
    const tree = buildDocumentTreeFromOutline(outline());

    assert.equal(tree.schema, DOCUMENT_TREE_SCHEMA);
    assert.equal(tree.path, 'notes/example.md');
    assert.equal(tree.title, 'Example');
    assert.equal(tree.truncated, false);
    assert.deepEqual(tree.root, { children: [] });
  });

  it('unit: nests deeper headings and keeps same-level headings as siblings', () => {
    const tree = buildDocumentTreeFromOutline(
      outline({
        headings: [
          { level: 1, text: 'Intro', id: 'h1-intro-0001' },
          { level: 2, text: 'Background', id: 'h2-background-0002' },
          { level: 2, text: 'Method', id: 'h2-method-0003' },
          { level: 3, text: 'Step One', id: 'h3-step-one-0004' },
        ],
      })
    );

    assert.deepEqual(tree.root.children, [
      {
        id: 'h1-intro-0001',
        level: 1,
        text: 'Intro',
        children: [
          {
            id: 'h2-background-0002',
            level: 2,
            text: 'Background',
            children: [],
          },
          {
            id: 'h2-method-0003',
            level: 2,
            text: 'Method',
            children: [
              {
                id: 'h3-step-one-0004',
                level: 3,
                text: 'Step One',
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('unit: closes ancestors on lower-level headings and allows skipped levels', () => {
    const tree = buildDocumentTreeFromOutline(
      outline({
        headings: [
          { level: 1, text: 'A', id: 'h1-a-0001' },
          { level: 3, text: 'B', id: 'h3-b-0002' },
          { level: 2, text: 'C', id: 'h2-c-0003' },
          { level: 1, text: 'D', id: 'h1-d-0004' },
        ],
      })
    );

    assert.deepEqual(
      tree.root.children.map((node) => ({
        text: node.text,
        children: node.children.map((child) => ({
          text: child.text,
          children: child.children.map((grandchild) => grandchild.text),
        })),
      })),
      [
        {
          text: 'A',
          children: [
            { text: 'B', children: [] },
            { text: 'C', children: [] },
          ],
        },
        { text: 'D', children: [] },
      ]
    );
  });

  it('unit: preserves empty heading text and duplicate heading IDs from NoteOutline', () => {
    const tree = buildDocumentTreeFromOutline(
      outline({
        headings: [
          { level: 2, text: '', id: 'h2-heading-0001' },
          { level: 2, text: 'Install', id: 'h2-install-0002' },
          { level: 2, text: 'Install', id: 'h2-install-0003' },
        ],
      })
    );

    assert.deepEqual(
      tree.root.children.map((node) => ({ id: node.id, text: node.text })),
      [
        { id: 'h2-heading-0001', text: '' },
        { id: 'h2-install-0002', text: 'Install' },
        { id: 'h2-install-0003', text: 'Install' },
      ]
    );
  });

  it('unit: rejects invalid heading records', () => {
    assert.throws(
      () =>
        buildDocumentTreeFromOutline(
          outline({ headings: [{ level: 7, text: 'Bad', id: 'h7-bad-0001' }] })
        ),
      /heading.level/
    );

    assert.throws(
      () =>
        buildDocumentTreeFromOutline(
          outline({ headings: [{ level: 1, text: 'Missing id' }] })
        ),
      /heading.id/
    );
  });

  it('data-integrity: does not mutate the input outline or heading records', () => {
    const input = outline({
      headings: [
        { level: 1, text: 'Root', id: 'h1-root-0001' },
        { level: 2, text: 'Child', id: 'h2-child-0002' },
      ],
    });
    const before = JSON.stringify(input);

    buildDocumentTreeFromOutline(input);

    assert.equal(JSON.stringify(input), before);
  });

  it('security: does not include body, snippets, frontmatter, vectors, or summaries', () => {
    const tree = buildDocumentTreeFromOutline(
      outline({
        path: 'private/secret.md',
        title: 'Private',
        frontmatter: { api_key: 'must-not-appear' },
        body: 'Sensitive body text must not appear.',
        snippet: 'Sensitive snippet must not appear.',
        vectorScore: 0.99,
        summary: 'Sensitive summary must not appear.',
        headings: [{ level: 1, text: '<script> alert(1) </script>', id: 'h1-script-0001' }],
      })
    );
    const serialized = JSON.stringify(tree);

    assert.equal(Object.hasOwn(tree, 'body'), false);
    assert.equal(Object.hasOwn(tree, 'frontmatter'), false);
    assert.equal(Object.hasOwn(tree, 'snippet'), false);
    assert.equal(serialized.includes('must-not-appear'), false);
    assert.equal(serialized.includes('Sensitive body text'), false);
    assert.equal(serialized.includes('Sensitive snippet'), false);
    assert.equal(serialized.includes('Sensitive summary'), false);
    assert.equal(serialized.includes('vectorScore'), false);
    assert.equal(tree.root.children[0].text, '<script> alert(1) </script>');
  });

  it('security: rejects absolute and traversal paths before returning a tree', () => {
    assert.throws(
      () => buildDocumentTreeFromOutline(outline({ path: '/Users/example/vault/secret.md' })),
      /vault-relative/
    );
    assert.throws(
      () => buildDocumentTreeFromOutline(outline({ path: '../secret.md' })),
      /escape vault/
    );
    assert.throws(
      () => buildDocumentTreeFromOutline(outline({ path: '\\Users\\example\\vault\\secret.md' })),
      /vault-relative/
    );
  });

  it('stress: builds a capped heading list deterministically', () => {
    const headings = Array.from({ length: 500 }, (_, index) => ({
      level: (index % 6) + 1,
      text: `Heading ${index + 1}`,
      id: `h${(index % 6) + 1}-heading-${String(index + 1).padStart(4, '0')}`,
    }));
    const input = outline({ headings, truncated: true });

    const first = buildDocumentTreeFromOutline(input);
    const second = buildDocumentTreeFromOutline(input);

    assert.deepEqual(first, second);
    assert.equal(first.truncated, true);
  });

  it('stress: caps untrusted direct outline heading input', () => {
    const headings = Array.from({ length: 501 }, (_, index) => ({
      level: 1,
      text: `Heading ${index + 1}`,
      id: `h1-heading-${String(index + 1).padStart(4, '0')}`,
    }));

    const tree = buildDocumentTreeFromOutline(outline({ headings, truncated: false }));

    assert.equal(tree.root.children.length, 500);
    assert.equal(tree.root.children[499].text, 'Heading 500');
    assert.equal(tree.truncated, true);
  });

  it('performance: tree construction is linear for normal heading counts', () => {
    const headings = Array.from({ length: 500 }, (_, index) => ({
      level: Math.min(6, (index % 4) + 1),
      text: `Heading ${index + 1}`,
      id: `h${Math.min(6, (index % 4) + 1)}-heading-${String(index + 1).padStart(4, '0')}`,
    }));
    const started = Date.now();
    const tree = buildDocumentTreeFromOutline(outline({ headings }));
    const elapsedMs = Date.now() - started;

    assert.equal(tree.root.children.length > 0, true);
    assert.ok(elapsedMs < 200, `expected builder under 200ms, got ${elapsedMs}ms`);
  });
});

describe('DocumentTree v0 Markdown parser integration', () => {
  it('integration: builds a nested tree from Markdown using NoteOutline parsing semantics', () => {
    const tree = buildDocumentTree({
      path: 'notes/markdown.md',
      frontmatter: { title: 'Markdown Tree' },
      body: '# Intro\n\n### Context\n\n## Method\n\n# Outro',
    });

    assert.equal(tree.schema, DOCUMENT_TREE_SCHEMA);
    assert.equal(tree.path, 'notes/markdown.md');
    assert.equal(tree.title, 'Markdown Tree');
    assert.deepEqual(
      tree.root.children.map((node) => ({
        id: node.id,
        level: node.level,
        text: node.text,
        children: node.children.map((child) => child.text),
      })),
      [
        {
          id: 'h1-intro-0001',
          level: 1,
          text: 'Intro',
          children: ['Context', 'Method'],
        },
        {
          id: 'h1-outro-0004',
          level: 1,
          text: 'Outro',
          children: [],
        },
      ]
    );
  });

  it('integration: parses raw Markdown frontmatter and derives the display title', () => {
    const tree = buildDocumentTreeFromMarkdown(
      'projects/tree/frontmatter.md',
      '---\ntitle: Frontmatter Tree\napi_key: must-not-appear\n---\n\n# Root\n\n## Child\n'
    );
    const serialized = JSON.stringify(tree);

    assert.equal(tree.title, 'Frontmatter Tree');
    assert.deepEqual(tree.root.children, [
      {
        id: 'h1-root-0001',
        level: 1,
        text: 'Root',
        children: [
          {
            id: 'h2-child-0002',
            level: 2,
            text: 'Child',
            children: [],
          },
        ],
      },
    ]);
    assert.equal(serialized.includes('api_key'), false);
    assert.equal(serialized.includes('must-not-appear'), false);
  });

  it('integration: keeps NoteOutline block-awareness for code blocks and Setext headings', () => {
    const tree = buildDocumentTree({
      path: 'notes/block-aware.md',
      frontmatter: {},
      body: [
        'Title',
        '=====',
        '',
        '```',
        '## Not a child',
        '```',
        '',
        'Subtitle',
        '--------',
      ].join('\n'),
    });

    assert.deepEqual(tree.root.children, [
      {
        id: 'h1-title-0001',
        level: 1,
        text: 'Title',
        children: [
          {
            id: 'h2-subtitle-0002',
            level: 2,
            text: 'Subtitle',
            children: [],
          },
        ],
      },
    ]);
  });

  it('security: Markdown integration stays body-free and rejects unsafe paths', () => {
    const tree = buildDocumentTreeFromMarkdown(
      'private/secret.md',
      '# Visible\n\nSensitive body text must not appear.'
    );
    const serialized = JSON.stringify(tree);

    assert.equal(Object.hasOwn(tree, 'body'), false);
    assert.equal(Object.hasOwn(tree, 'frontmatter'), false);
    assert.equal(serialized.includes('Sensitive body text'), false);

    assert.throws(
      () => buildDocumentTreeFromMarkdown('../secret.md', '# Secret'),
      /escape vault/
    );
  });

  it('stress: Markdown integration preserves truncation from NoteOutline caps', () => {
    const tree = buildDocumentTree(
      {
        path: 'notes/many-markdown.md',
        frontmatter: {},
        body: Array.from({ length: 10 }, (_, index) => `## Heading ${index + 1}`).join('\n\n'),
      },
      { maxHeadings: 3 }
    );

    assert.equal(tree.truncated, true);
    assert.deepEqual(
      tree.root.children.map((node) => node.text),
      ['Heading 1', 'Heading 2', 'Heading 3']
    );
  });
});
