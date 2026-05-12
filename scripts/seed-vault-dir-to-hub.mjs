#!/usr/bin/env node
/**
 * Upload all Markdown files under a vault subdirectory to a Hub backend (local Node Hub or hosted gateway → canister).
 *
 * Usage (from repo root):
 *   KNOWTATION_HUB_URL="http://localhost:3333" KNOWTATION_HUB_TOKEN="<jwt>" npm run seed:hosted-showcase
 *   KNOWTATION_HUB_URL="https://knowtation-gateway.netlify.app" KNOWTATION_HUB_TOKEN="<jwt>" npm run seed:hosted-showcase
 *
 * Optional:
 *   KNOWTATION_SEED_DIR=showcase/other   — folder under vault/ (default: showcase)
 *   KNOWTATION_VAULT_ID=default         — X-Vault-Id header (default: default)
 *
 * JWT: after login, copy from localStorage hub_token or from ?token= in the URL.
 */
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const VAULT_ROOT = path.join(REPO_ROOT, 'vault');

const hubUrl = (process.env.KNOWTATION_HUB_URL || process.env.HUB_URL || '').replace(/\/$/, '');
const token = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_TOKEN || '';
const vaultId = process.env.KNOWTATION_VAULT_ID || 'default';
const subdir = (process.env.KNOWTATION_SEED_DIR || process.argv[2] || 'showcase').replace(/^\/+|\/+$/g, '');

if (!hubUrl) {
  console.error('Missing KNOWTATION_HUB_URL (e.g. http://localhost:3333 or https://knowtation-gateway.netlify.app)');
  process.exit(2);
}
if (!token) {
  console.error('Missing KNOWTATION_HUB_TOKEN (JWT from Hub after login)');
  process.exit(2);
}

const sourceDir = path.join(VAULT_ROOT, subdir);
try {
  const st = await stat(sourceDir);
  if (!st.isDirectory()) {
    console.error(`Not a directory: ${sourceDir}`);
    process.exit(2);
  }
} catch {
  console.error(`Missing folder: ${sourceDir}`);
  process.exit(2);
}

/** @returns {AsyncGenerator<string>} */
async function* walkMd(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkMd(full);
    else if (e.isFile() && e.name.endsWith('.md')) yield full;
  }
}

/** @param {string} fileAbs */
function vaultRelativePath(fileAbs) {
  const rel = path.relative(VAULT_ROOT, fileAbs);
  if (rel.startsWith('..')) {
    throw new Error(`Path outside vault: ${fileAbs}`);
  }
  return rel.split(path.sep).join('/');
}

/**
 * @param {string} notePath
 * @param {string} body
 */
async function postNote(notePath, body) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Vault-Id': vaultId,
  };
  const r = await fetch(`${hubUrl}/api/v1/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: notePath, body }),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`POST /api/v1/notes failed (${r.status}) for ${notePath}: ${text}`);
  }
  return text;
}

const paths = [];
for await (const file of walkMd(sourceDir)) {
  paths.push(file);
}

if (paths.length === 0) {
  console.error(`No .md files under ${sourceDir}`);
  process.exit(1);
}

console.log(`Seeding ${paths.length} note(s) from vault/${subdir}/ → ${hubUrl} (vault_id=${vaultId})`);

for (const file of paths) {
  const notePath = vaultRelativePath(file);
  process.stdout.write(`  ${notePath} ... `);
  const body = await readFile(file, 'utf8');
  await postNote(notePath, body);
  process.stdout.write('ok\n');
}

console.log('\nDone. Open the Hub → Notes and browse the showcase folder.');
