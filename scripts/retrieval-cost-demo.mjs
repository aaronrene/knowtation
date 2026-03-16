#!/usr/bin/env node
/**
 * Retrieval cost demo: compare "standard" (broad fetch) vs "refined" (tiered) retrieval.
 * Measures output size (chars) and estimated tokens so we can show cost savings in docs.
 *
 * Usage (from repo root):
 *   node scripts/retrieval-cost-demo.mjs [query]
 *   Query defaults to "project" if omitted.
 *
 * Uses lib directly (no CLI subprocess). Set KNOWTATION_VAULT_PATH or ensure config/local.yaml has vault_path.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
if (!process.env.KNOWTATION_VAULT_PATH) {
  process.env.KNOWTATION_VAULT_PATH = path.join(ROOT, 'vault');
}

import { loadConfig } from '../lib/config.mjs';
import { runListNotes } from '../lib/list-notes.mjs';
import { readNote } from '../lib/vault.mjs';

function countChars(str) {
  return typeof str === 'string' ? str.length : 0;
}

/** Rough token estimate: ~4 chars per token for English/markdown. */
function estTokens(chars) {
  return Math.round(chars / 4);
}

function main() {
  const query = process.argv[2]?.trim() || 'project';
  console.log('Retrieval cost demo: Standard vs Refined');
  console.log('Query:', JSON.stringify(query));
  console.log('');

  let config;
  try {
    config = loadConfig(ROOT);
  } catch (e) {
    console.error('Config error:', e.message);
    console.error('Set KNOWTATION_VAULT_PATH or create config/local.yaml with vault_path.');
    process.exit(2);
  }

  let standardChars = 0;
  let refinedChars = 0;

  // Standard: list-notes with full metadata (path+metadata), limit 10, then get full note for up to 5
  const listStandard = runListNotes(config, { limit: 10, fields: 'path+metadata' });
  const standardJson = JSON.stringify(listStandard);
  standardChars += countChars(standardJson);
  const standardPaths = (listStandard.notes || []).map((n) => n.path).slice(0, 5);

  for (const p of standardPaths) {
    try {
      const note = readNote(config.vault_path, p);
      standardChars += countChars(JSON.stringify({ path: note.path, frontmatter: note.frontmatter, body: note.body }));
    } catch (_) {}
  }

  // Refined: list-notes with path only, limit 3, then get full note for first path only
  const listRefined = runListNotes(config, { limit: 3, fields: 'path' });
  const refinedJson = JSON.stringify(listRefined);
  refinedChars += countChars(refinedJson);
  const refinedPath = (listRefined.notes || [])[0]?.path;

  if (refinedPath) {
    try {
      const note = readNote(config.vault_path, refinedPath);
      refinedChars += countChars(JSON.stringify({ path: note.path, frontmatter: note.frontmatter, body: note.body }));
    } catch (_) {}
  }

  const stdTokens = estTokens(standardChars);
  const refTokens = estTokens(refinedChars);
  const savings = standardChars > 0 ? Math.round((1 - refinedChars / standardChars) * 100) : 0;

  console.log('Strategy              | Chars  | Est. tokens (÷4) | Est. cost @ $0.50/1M');
  console.log('----------------------|--------|------------------|----------------------');
  console.log(`Standard (10+metadata, ${standardPaths.length} get-note) | ${String(standardChars).padStart(6)} | ${String(stdTokens).padStart(16)} | $${(stdTokens / 1e6 * 0.5).toFixed(4)}`);
  console.log(`Refined (3 path, 1 get-note)   | ${String(refinedChars).padStart(6)} | ${String(refTokens).padStart(16)} | $${(refTokens / 1e6 * 0.5).toFixed(4)}`);
  console.log('');
  console.log(`Token reduction: ${savings}% (refined vs standard).`);
  console.log('');
  console.log('Standard = list-notes --limit 10 (path+metadata) + get-note for up to 5 paths.');
  console.log('Refined  = list-notes --limit 3 --fields path + get-note for 1 path.');
}

main();
