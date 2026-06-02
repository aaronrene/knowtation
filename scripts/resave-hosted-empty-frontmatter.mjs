#!/usr/bin/env node
/**
 * Phase D remediation: re-POST notes whose stored frontmatter parses to {} so the gateway
 * merges provenance (knowtation_edited_at, etc.) and optional title from the path.
 *
 * Use only after verify-hosted-hub-api investigation shows write_path_ok_legacy_data_likely.
 *
 *   KNOWTATION_HUB_TOKEN='...' node scripts/resave-hosted-empty-frontmatter.mjs --dry-run
 *   KNOWTATION_HUB_TOKEN='...' node scripts/resave-hosted-empty-frontmatter.mjs --execute
 *
 * Same env as verify: KNOWTATION_HUB_API, KNOWTATION_HUB_VAULT_ID, KNOWTATION_HUB_TOKEN_FILE
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
const execute = process.argv.includes('--execute');
const dryRun = process.argv.includes('--dry-run') || !execute;

function headers() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Vault-Id': vaultId,
    Authorization: 'Bearer ' + token,
  };
}

function titleFromPath(p) {
  const base = path.posix.basename(String(p || ''), '.md');
  return base || 'note';
}

async function main() {
  if (!token) {
    console.error('Set KNOWTATION_HUB_TOKEN (or HUB_JWT / KNOWTATION_HUB_TOKEN_FILE).');
    process.exit(1);
  }
  if (!execute && !process.argv.includes('--dry-run')) {
    console.error('Pass --dry-run (default) or --execute.');
    process.exit(1);
  }

  const listRes = await fetch(`${apiBase}/api/v1/notes?limit=500&offset=0`, { headers: headers() });
  const listText = await listRes.text();
  if (!listRes.ok) {
    console.error('List failed', listRes.status, listText.slice(0, 400));
    process.exit(1);
  }
  const data = JSON.parse(listText);
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const targets = [];
  for (const n of notes) {
    const fm = materializeListFrontmatter(n.frontmatter);
    if (Object.keys(fm).length === 0 && n.path) targets.push(n.path);
  }
  console.log('empty_frontmatter_paths', targets.length);
  if (dryRun) {
    targets.forEach((p) => console.log('would_resave', p));
    console.log('Dry run only. Re-run with --execute to POST each note (same body, new minimal frontmatter).');
    return;
  }

  for (const p of targets) {
    const enc = encodeURIComponent(p);
    const getRes = await fetch(`${apiBase}/api/v1/notes/${enc}`, { headers: headers() });
    const getText = await getRes.text();
    if (!getRes.ok) {
      console.error('GET failed', p, getRes.status, getText.slice(0, 120));
      continue;
    }
    const note = JSON.parse(getText);
    const body = typeof note.body === 'string' ? note.body : '';
    const fmStr = JSON.stringify({ title: titleFromPath(p) });
    const postBody = JSON.stringify({ path: p, body, frontmatter: fmStr });
    const postRes = await fetch(`${apiBase}/api/v1/notes`, {
      method: 'POST',
      headers: headers(),
      body: postBody,
    });
    const postText = await postRes.text();
    console.log('POST', p, postRes.status, postRes.ok ? 'ok' : postText.slice(0, 80));
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log('Done. Re-run npm run verify:hosted-api to confirm empty_frontmatter_count dropped.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
