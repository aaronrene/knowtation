/**
 * Unit tests for `extractCheckboxTasksFromBody` (shared local + hosted).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCheckboxTasksFromBody } from '../lib/extract-tasks.mjs';

describe('extractCheckboxTasksFromBody', () => {
  it('parses open and done lines with path and line numbers', () => {
    const body = 'intro\n- [ ] Open item\n   - [x] Done item\n';
    const all = extractCheckboxTasksFromBody(body, { path: 'n.md', status: 'all' });
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((t) => ({ text: t.text, line: t.line, status: t.status, path: t.path })),
      [
        { text: 'Open item', line: 2, status: 'open', path: 'n.md' },
        { text: 'Done item', line: 3, status: 'done', path: 'n.md' },
      ]
    );
  });

  it('respects status filter', () => {
    const body = '- [ ] A\n- [x] B\n';
    const openOnly = extractCheckboxTasksFromBody(body, { path: 'p.md', status: 'open' });
    assert.equal(openOnly.length, 1);
    assert.equal(openOnly[0].text, 'A');
  });
});
