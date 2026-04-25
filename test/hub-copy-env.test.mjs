/**
 * Ensures the Hub "Copy URL, token & vault" block stays short (one doc link, not a wall of # comments).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hubPath = join(root, 'web/hub/hub.js');
const hubSrc = readFileSync(hubPath, 'utf8');

test('web/hub/hub.js: copy block uses INTEGRATION_DOC_URL and a short curl header hint (no long REST/MCP essay)', () => {
  assert.match(hubSrc, /INTEGRATION_DOC_URL/);
  assert.doesNotMatch(hubSrc, /# Hub REST API \(scripts/);
  assert.match(hubSrc, /Example curl/);
  assert.match(hubSrc, /Authorization: Bearer/);
});
