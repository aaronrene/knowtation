#!/usr/bin/env node
/**
 * Lists vault-relative paths where stored frontmatter JSON parses to an empty object.
 * Read-only. Same env as verify-hosted-hub-api.mjs (KNOWTATION_HUB_TOKEN, KNOWTATION_HUB_API, KNOWTATION_HUB_VAULT_ID).
 *
 *   KNOWTATION_HUB_TOKEN='...' node scripts/report-empty-hosted-frontmatter.mjs
 */

import { materializeListFrontmatter } from '../hub/gateway/note-facets.mjs';

const token = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_JWT || '';
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
