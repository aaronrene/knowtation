#!/usr/bin/env node
/**
 * Push voice-and-boundaries notes from the local vault to the hosted Hub via REST.
 * Uses the same contract as POST /api/v1/notes (docs/HUB-API.md).
 *
 * Auth (pick one):
 *   export KNOWTATION_HUB_TOKEN='...'   # raw JWT from Settings → Copy Hub API
 *   export KNOWTATION_HUB_URL='https://knowtation-gateway.netlify.app'  # optional
 *
 * Or rely on Authorization in ~/.cursor/mcp.json → mcpServers.knowtation-hosted.headers.Authorization
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = (process.env.KNOWTATION_HUB_URL || 'https://knowtation-gateway.netlify.app').replace(/\/$/, '');
const VAULT_ID = process.env.KNOWTATION_HUB_VAULT_ID || 'default';

let authHeader = process.env.KNOWTATION_HUB_TOKEN
  ? `Bearer ${process.env.KNOWTATION_HUB_TOKEN.trim()}`
  : null;

if (!authHeader) {
  const mcpPath = join(homedir(), '.cursor', 'mcp.json');
  if (existsSync(mcpPath)) {
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
    const h = mcp?.mcpServers?.['knowtation-hosted']?.headers?.Authorization;
    if (h && String(h).startsWith('Bearer ')) authHeader = h;
  }
}

if (!authHeader) {
  console.error('Set KNOWTATION_HUB_TOKEN or configure knowtation-hosted in ~/.cursor/mcp.json');
  process.exit(1);
}

const roots = [
  'vault/projects/store-free/style-guide/voice-and-boundaries.md',
  'vault/projects/knowtation/style-guide/voice-and-boundaries.md',
];

function parseNote(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const fmBlock = m[1];
  const body = m[2];
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const col = line.indexOf(':');
    if (col === -1) continue;
    const key = line.slice(0, col).trim();
    let val = line.slice(col + 1).trim();
    if (key === 'tags' && val.startsWith('[') && val.endsWith(']')) {
      frontmatter.tags = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      try {
        frontmatter[key] = JSON.parse(val);
      } catch {
        frontmatter[key] = val.slice(1, -1);
      }
    } else {
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

for (const rel of roots) {
  const abs = join(repoRoot, rel);
  const raw = readFileSync(abs, 'utf8');
  const { frontmatter, body } = parseNote(raw);
  const path = rel.replace(/^vault\//, '');
  const payload = { path, body, frontmatter };

  const res = await fetch(`${HUB}/api/v1/notes`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'X-Vault-Id': VAULT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${path} → ${res.status} ${text}`);
    process.exitCode = 1;
  } else {
    console.log(`${path} → ${res.status} ${text.slice(0, 200)}`);
  }
}
