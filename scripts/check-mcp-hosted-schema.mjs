#!/usr/bin/env node
/**
 * CI guard: z.record(z.unknown()) breaks Zod v4 JSON Schema export in @modelcontextprotocol/sdk
 * for hosted tools/list — one bad schema fails the entire tool list.
 * Scope: hub/gateway/mcp-hosted*.mjs only.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const gatewayDir = join(root, 'hub', 'gateway');
const FORBIDDEN = 'z.record(z.unknown())';

const files = readdirSync(gatewayDir).filter((f) => f.startsWith('mcp-hosted') && f.endsWith('.mjs'));
let failed = false;

for (const name of files) {
  const path = join(gatewayDir, name);
  const src = readFileSync(path, 'utf8');
  if (src.includes(FORBIDDEN)) {
    console.error(`[check-mcp-hosted-schema] Forbidden pattern ${JSON.stringify(FORBIDDEN)} in ${path}`);
    failed = true;
  }
}

if (failed) {
  console.error('[check-mcp-hosted-schema] Use z.record(z.string(), z.unknown()) or explicit object shapes.');
  process.exit(1);
}

console.log(`[check-mcp-hosted-schema] OK (${files.length} file(s))`);
