#!/usr/bin/env node
/**
 * Lists vault-relative paths where stored frontmatter JSON parses to an empty object.
 * Read-only. Same env as verify-hosted-hub-api.mjs (KNOWTATION_HUB_TOKEN, KNOWTATION_HUB_API, KNOWTATION_HUB_VAULT_ID).
 *
 *   KNOWTATION_HUB_TOKEN='...' node scripts/report-empty-hosted-frontmatter.mjs
 *   KNOWTATION_HUB_TOKEN_FILE=~/.config/knowtation/hub_jwt.txt node scripts/report-empty-hosted-frontmatter.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { materializeListFrontmatter } from '../hub/gateway/note-facets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

function resolveToken() {
  let t = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_JWT || '';
  const fp = (process.env.KNOWTATION_HUB_TOKEN_FILE || '').trim();
  if (!t && fp) {
    const expanded = fp.startsWith('~') ? path.join(process.env.HOME || '', fp.slice(1)) : fp;
    t = fs.readFileSync(expanded, 'utf8').trim();
  }
  return t;
}

const token = resolveToken();
const apiBase = (process.env.KNOWTATION_HUB_API || 'https://knowtation-gateway.netlify.app').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';

async function main() {
  if (!token) {
    console.error('Set KNOWTATION_HUB_TOKEN (or HUB_JWT).');
    process.exit(1);
  }
  const res = await fetch(`${apiBase}/api/v1/notes?limit=500&offset=0`, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'X-Vault-Id': vaultId,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(res.status, text.slice(0, 400));
    process.exit(1);
  }
  const data = JSON.parse(text);
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const emptyPaths = [];
  for (const n of notes) {
    const fm = materializeListFrontmatter(n.frontmatter);
    if (Object.keys(fm).length === 0) emptyPaths.push(n.path || '(no path)');
  }
  console.log('total_notes', notes.length);
  console.log('empty_frontmatter_paths', emptyPaths.length);
  emptyPaths.forEach((p) => console.log(p));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
