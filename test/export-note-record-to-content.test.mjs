import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { exportNoteRecordToContent, exportNoteToContent } from '../lib/export.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('exportNoteRecordToContent', () => {
  test('produces md with yaml frontmatter and source_notes', () => {
    const { content, filename } = exportNoteRecordToContent(
      { body: 'Hello', frontmatter: { title: 'T', tags: ['a'] } },
      'inbox/x.md',
      { format: 'md' },
    );
    assert.equal(filename, 'x.md');
    assert.ok(content.includes('---\n'));
    assert.ok(content.includes('source_notes'));
    assert.ok(content.includes('Hello'));
  });

  test('exportNoteToContent delegates to same shape as record export', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-exp-'));
    const rel = 'a/b.md';
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(
      abs,
      '---\ntitle: One\ntags:\n  - t\n---\nBody here\n',
      'utf8',
    );
    const a = exportNoteToContent(dir, rel, { format: 'md' });
    const b = exportNoteRecordToContent(
      { body: 'Body here', frontmatter: { title: 'One', tags: ['t'] } },
      rel,
      { format: 'md' },
    );
    assert.equal(a.filename, b.filename);
    assert.equal(a.content.replace(/\r?\n/g, '\n').trimEnd(), b.content.replace(/\r?\n/g, '\n').trimEnd());
  });
});
