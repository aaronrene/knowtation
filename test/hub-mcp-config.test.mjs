import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'web/hub/config.js');
const configSrc = readFileSync(configPath, 'utf8');

test('web/hub/config.js: hosted knowtation.store sets HUB_MCP_PUBLIC_URL for Copy Hub / KNOWTATION_MCP_URL', () => {
  assert.match(configSrc, /knowtation\.store/);
  assert.match(configSrc, /HUB_MCP_PUBLIC_URL/);
  assert.match(configSrc, /mcp\.knowtation\.store/);
});
