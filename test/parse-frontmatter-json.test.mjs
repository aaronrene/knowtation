import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatterJsonText, materializeWireFrontmatter } from '../lib/parse-frontmatter-json.mjs';

test('plain object', () => {
  assert.equal(parseFrontmatterJsonText('{"title":"x"}').title, 'x');
});

test('BOM + object', () => {
  assert.equal(parseFrontmatterJsonText('\uFEFF{"title":"x"}').title, 'x');
});

test('JSON string whose value is JSON object text', () => {
  const wire = JSON.stringify(JSON.stringify({ title: 'Hub probe', tags: 't' }));
  const fm = parseFrontmatterJsonText(wire);
  assert.equal(fm.title, 'Hub probe');
  assert.equal(fm.tags, 't');
});

test('materialize passes object through', () => {
  assert.equal(materializeWireFrontmatter({ a: 1 }).a, 1);
});

test('empty and legacy', () => {
  assert.deepEqual(parseFrontmatterJsonText(''), {});
  assert.deepEqual(parseFrontmatterJsonText('{}'), {});
});
