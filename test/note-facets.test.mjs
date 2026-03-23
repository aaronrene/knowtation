import test from 'node:test';
import assert from 'node:assert';
import { materializeListFrontmatter, parseFrontmatterJsonText } from '../hub/gateway/note-facets.mjs';

test('materializeListFrontmatter parses plain JSON object string', () => {
  const fm = materializeListFrontmatter(JSON.stringify({ title: 'x', tags: 'a,b' }));
  assert.equal(fm.title, 'x');
  assert.equal(fm.tags, 'a,b');
});

test('materializeListFrontmatter unwraps double JSON-encoded string (hosted persistence quirk)', () => {
  const inner = JSON.stringify({ title: 'Hub probe', tags: 'probe-tag', date: '2026-03-22' });
  const doubleEncoded = JSON.stringify(inner);
  const fm = materializeListFrontmatter(doubleEncoded);
  assert.equal(fm.title, 'Hub probe');
  assert.equal(fm.tags, 'probe-tag');
  assert.equal(fm.date, '2026-03-22');
});

test('parseFrontmatterJsonText returns {} on invalid JSON', () => {
  assert.deepStrictEqual(parseFrontmatterJsonText('not json'), {});
});
