/**
 * NoteOutline parser tests.
 *
 * Phase 1A is parser-only: no CLI, MCP, Hub, search, index, memory, or
 * persistence behavior is expected here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NOTE_OUTLINE_HEADINGS,
  MAX_NOTE_OUTLINE_INPUT_CHARS,
  NOTE_OUTLINE_SCHEMA,
  buildNoteOutline,
  buildNoteOutlineFromMarkdown,
} from '../lib/note-outline.mjs';

describe('NoteOutline parser', () => {
  it('unit: returns the v1 schema, path, title, and ATX heading order', () => {
    const outline = buildNoteOutline({
      path: 'inbox/example.md',
      frontmatter: { title: 'Example Note' },
      body: '# Intro\n\n## Details\n\n### Next',
    });

    assert.equal(outline.schema, NOTE_OUTLINE_SCHEMA);
    assert.equal(outline.path, 'inbox/example.md');
    assert.equal(outline.title, 'Example Note');
    assert.equal(outline.truncated, false);
    assert.deepEqual(outline.headings, [
      { level: 1, text: 'Intro', id: 'h1-intro-0001' },
      { level: 2, text: 'Details', id: 'h2-details-0002' },
      { level: 3, text: 'Next', id: 'h3-next-0003' },
    ]);
  });

  it('unit: ignores YAML frontmatter as outline content', () => {
    const outline = buildNoteOutlineFromMarkdown(
      'inbox/frontmatter.md',
      '---\ntitle: Frontmatter Title\nnote: "# not a heading"\n---\n\n# Body Heading\n'
    );

    assert.equal(outline.title, 'Frontmatter Title');
    assert.deepEqual(outline.headings, [
      { level: 1, text: 'Body Heading', id: 'h1-body-heading-0001' },
    ]);
  });

  it('unit: supports Setext headings', () => {
    const outline = buildNoteOutline({
      path: 'notes/setext.md',
      body: 'Title\n=====\n\nSubtitle\n--------\n\nText',
      frontmatter: {},
    });

    assert.deepEqual(outline.headings, [
      { level: 1, text: 'Title', id: 'h1-title-0001' },
      { level: 2, text: 'Subtitle', id: 'h2-subtitle-0002' },
    ]);
  });

  it('unit: ignores heading-looking text inside fenced and indented code blocks', () => {
    const outline = buildNoteOutline({
      path: 'notes/code.md',
      frontmatter: {},
      body: [
        '# Real',
        '',
        '```',
        '# Not real',
        '```',
        '',
        '    ## Also not real',
        '',
        '## Real Child',
      ].join('\n'),
    });

    assert.deepEqual(outline.headings, [
      { level: 1, text: 'Real', id: 'h1-real-0001' },
      { level: 2, text: 'Real Child', id: 'h2-real-child-0002' },
    ]);
  });

  it('unit: gives duplicate headings deterministic distinct IDs', () => {
    const note = {
      path: 'notes/duplicates.md',
      frontmatter: {},
      body: '## Install\n\nText\n\n## Install\n\nMore',
    };

    const first = buildNoteOutline(note);
    const second = buildNoteOutline(note);

    assert.deepEqual(first, second);
    assert.deepEqual(first.headings, [
      { level: 2, text: 'Install', id: 'h2-install-0001' },
      { level: 2, text: 'Install', id: 'h2-install-0002' },
    ]);
  });

  it('unit: extracts plain text from inline heading formatting', () => {
    const outline = buildNoteOutline({
      path: 'notes/inline.md',
      frontmatter: {},
      body: '## **Bold** [Link](https://example.com) `code`',
    });

    assert.deepEqual(outline.headings, [
      { level: 2, text: 'Bold Link code', id: 'h2-bold-link-code-0001' },
    ]);
  });

  it('security: treats HTML/script-looking heading content as plain text data', () => {
    const outline = buildNoteOutline({
      path: 'notes/html.md',
      frontmatter: {},
      body: '## <script>alert(1)</script>',
    });

    assert.equal(outline.headings.length, 1);
    assert.equal(outline.headings[0].level, 2);
    assert.equal(outline.headings[0].text, '<script> alert(1) </script>');
    assert.equal(outline.headings[0].id, 'h2-script-alert-1-script-0001');
  });

  it('security: does not include body, snippets, frontmatter, or absolute paths', () => {
    const outline = buildNoteOutline({
      path: 'private/secret.md',
      frontmatter: { title: 'Private', api_key: 'must-not-appear' },
      body: '# Visible Heading\n\nSensitive body text must not appear.',
    });

    const serialized = JSON.stringify(outline);
    assert.equal(Object.hasOwn(outline, 'body'), false);
    assert.equal(Object.hasOwn(outline, 'frontmatter'), false);
    assert.equal(Object.hasOwn(outline, 'snippet'), false);
    assert.equal(serialized.includes('must-not-appear'), false);
    assert.equal(serialized.includes('Sensitive body text'), false);
    assert.equal(serialized.includes('/Users/'), false);
  });

  it('data-integrity: does not mutate the input note object', () => {
    const note = {
      path: 'notes/immutable.md',
      frontmatter: { title: 'Immutable' },
      body: '# Heading',
    };
    const before = JSON.stringify(note);

    buildNoteOutline(note);

    assert.equal(JSON.stringify(note), before);
  });

  it('unit: returns an empty headings array for empty and no-heading notes', () => {
    assert.deepEqual(
      buildNoteOutline({ path: 'notes/empty.md', frontmatter: {}, body: '' }).headings,
      []
    );
    assert.deepEqual(
      buildNoteOutline({ path: 'notes/no-heading.md', frontmatter: {}, body: 'plain text' }).headings,
      []
    );
  });

  it('unit: handles CRLF line endings', () => {
    const outline = buildNoteOutline({
      path: 'notes/crlf.md',
      frontmatter: {},
      body: '# First\r\n\r\n## Second\r\n',
    });

    assert.deepEqual(outline.headings, [
      { level: 1, text: 'First', id: 'h1-first-0001' },
      { level: 2, text: 'Second', id: 'h2-second-0002' },
    ]);
  });

  it('stress: caps returned headings and sets truncated', () => {
    const maxHeadings = 3;
    const outline = buildNoteOutline(
      {
        path: 'notes/many.md',
        frontmatter: {},
        body: Array.from({ length: 10 }, (_, index) => `## Heading ${index + 1}`).join('\n\n'),
      },
      { maxHeadings }
    );

    assert.equal(outline.headings.length, maxHeadings);
    assert.equal(outline.truncated, true);
    assert.deepEqual(outline.headings.map((heading) => heading.text), [
      'Heading 1',
      'Heading 2',
      'Heading 3',
    ]);
  });

  it('stress: rejects input above the configured character cap', () => {
    assert.throws(
      () =>
        buildNoteOutline(
          {
            path: 'notes/huge.md',
            frontmatter: {},
            body: 'x'.repeat(11),
          },
          { maxInputChars: 10 }
        ),
      /exceeds/
    );
  });

  it('performance: parses a large but bounded heading set quickly', () => {
    const body = Array.from(
      { length: Math.min(1000, MAX_NOTE_OUTLINE_HEADINGS * 2) },
      (_, index) => `## Heading ${index + 1}\n\nText ${index + 1}`
    ).join('\n\n');
    const started = Date.now();
    const outline = buildNoteOutline({ path: 'notes/perf.md', frontmatter: {}, body });
    const elapsedMs = Date.now() - started;

    assert.equal(outline.headings.length, MAX_NOTE_OUTLINE_HEADINGS);
    assert.equal(outline.truncated, true);
    assert.ok(elapsedMs < 2000, `expected parser under 2s, got ${elapsedMs}ms`);
  });

  it('unit: exposes documented default caps', () => {
    assert.equal(MAX_NOTE_OUTLINE_INPUT_CHARS, 1_000_000);
    assert.equal(MAX_NOTE_OUTLINE_HEADINGS, 500);
  });
});
