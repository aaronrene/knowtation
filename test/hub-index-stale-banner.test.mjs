/**
 * Contract: Hub shows a client-side hint when vault edits may have outpaced Meaning (semantic) search until Re-index.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hubJs = readFileSync(join(root, 'web/hub/hub.js'), 'utf8');
const hubHtml = readFileSync(join(root, 'web/hub/index.html'), 'utf8');

test('Hub index-stale banner: markup + JS wiring', () => {
  assert.match(hubHtml, /id="hub-index-stale-banner"/);
  assert.match(hubHtml, /id="hub-index-stale-run"/);
  assert.match(hubHtml, /id="hub-index-stale-dismiss"/);
  assert.match(hubJs, /HUB_SEMANTIC_INDEX_STALE_PREFIX/);
  assert.match(hubJs, /function hubMarkSemanticIndexStale\b/);
  assert.match(hubJs, /function hubClearSemanticIndexStale\b/);
  assert.match(hubJs, /function hubRefreshIndexStaleBanner\b/);
  assert.match(hubJs, /hubClearSemanticIndexStale\(\)/);
});
