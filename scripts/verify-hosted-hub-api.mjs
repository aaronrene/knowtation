#!/usr/bin/env node
/**
 * Hosted Hub API probe: list notes, report empty frontmatter, optional GET one path.
 * Use after sign-in: copy JWT from localStorage hub_token (DevTools → Application).
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' node scripts/verify-hosted-hub-api.mjs
 *   KNOWTATION_HUB_API=https://knowtation-gateway.netlify.app KNOWTATION_HUB_VAULT_ID=default \
 *     KNOWTATION_HUB_NOTE_PATH='inbox/note.md' node scripts/verify-hosted-hub-api.mjs
 *
 * Optional write probe (creates/overwrites a probe note — use a throwaway path):
 *   KNOWTATION_HUB_PROBE_PATH='inbox/.hub-probe-delete-me.md' KNOWTATION_HUB_DO_PROBE=1 \
 *     KNOWTATION_HUB_TOKEN='...' node scripts/verify-hosted-hub-api.mjs
 */

import { materializeListFrontmatter, deriveFacetsFromCanisterNotes } from '../hub/gateway/note-facets.mjs';

const token = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_JWT || '';
const apiBase = (process.env.KNOWTATION_HUB_API || 'https://knowtation-gateway.netlify.app').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';
const notePath = process.env.KNOWTATION_HUB_NOTE_PATH || '';
const probePath = process.env.KNOWTATION_HUB_PROBE_PATH || '';
const doProbe = process.env.KNOWTATION_HUB_DO_PROBE === '1' || process.env.KNOWTATION_HUB_DO_PROBE === 'true';

function headers() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Vault-Id': vaultId };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

async function main() {
  if (!token) {
    console.error('Set KNOWTATION_HUB_TOKEN (or HUB_JWT) to your Hub JWT from localStorage hub_token.');
    process.exit(1);
  }

  const listUrl = `${apiBase}/api/v1/notes?limit=200&offset=0`;
  const listRes = await fetch(listUrl, { headers: headers() });
  const listText = await listRes.text();
  console.log('GET /api/v1/notes', listRes.status, listRes.ok ? 'ok' : 'FAIL');
  if (!listRes.ok) {
    console.log(listText.slice(0, 500));
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(listText);
  } catch (e) {
    console.error('List response is not JSON:', e.message);
    console.log(listText.slice(0, 400));
    process.exit(1);
  }
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const total = data.total ?? notes.length;
  console.log('notes.length', notes.length, 'total', total);

  let emptyFm = 0;
  let sampleNonEmpty = 0;
  for (const n of notes) {
    const fm = materializeListFrontmatter(n.frontmatter);
    const keys = Object.keys(fm);
    if (keys.length === 0) emptyFm += 1;
    else if (sampleNonEmpty < 2) {
      sampleNonEmpty += 1;
      console.log('sample path', n.path, 'fm keys', keys.slice(0, 12).join(', '));
    }
  }
  console.log('empty_frontmatter_count', emptyFm, '/', notes.length);
  const facets = deriveFacetsFromCanisterNotes(notes);
  console.log('derived facets projects', facets.projects.length, 'tags', facets.tags.length, 'folders', facets.folders.length);
  if (facets.tags.length) console.log('tags sample', facets.tags.slice(0, 8).join(', '));

  const facetsRes = await fetch(`${apiBase}/api/v1/notes/facets`, { headers: headers() });
  const facetsText = await facetsRes.text();
  console.log('GET /api/v1/notes/facets', facetsRes.status, facetsRes.ok ? 'ok' : 'FAIL');
  if (facetsRes.ok) {
    try {
      const f = JSON.parse(facetsText);
      console.log('gateway facets tags', (f.tags || []).length, 'projects', (f.projects || []).length);
    } catch {
      console.log(facetsText.slice(0, 200));
    }
  } else {
    console.log(facetsText.slice(0, 300));
  }

  if (notePath) {
    const enc = encodeURIComponent(notePath);
    const oneUrl = `${apiBase}/api/v1/notes/${enc}`;
    const oneRes = await fetch(oneUrl, { headers: headers() });
    const oneText = await oneRes.text();
    console.log('GET /api/v1/notes/' + notePath, oneRes.status, oneRes.ok ? 'ok' : 'FAIL');
    if (oneRes.ok) {
      try {
        const note = JSON.parse(oneText);
        const fm = materializeListFrontmatter(note.frontmatter);
        console.log('detail frontmatter keys', Object.keys(fm).join(', ') || '(none)');
        const raw = typeof note.frontmatter === 'string' ? note.frontmatter : JSON.stringify(note.frontmatter);
        console.log('detail frontmatter raw length', raw.length, 'preview', raw.slice(0, 160).replace(/\n/g, ' '));
      } catch (e) {
        console.log(oneText.slice(0, 400));
      }
    } else {
      console.log(oneText.slice(0, 300));
    }
  }

  if (doProbe && probePath) {
    const body = JSON.stringify({
      path: probePath,
      body: '# probe\n',
      frontmatter: JSON.stringify({ title: 'Hub probe', tags: 'probe-tag', date: new Date().toISOString().slice(0, 10) }),
    });
    const postRes = await fetch(`${apiBase}/api/v1/notes`, {
      method: 'POST',
      headers: headers(),
      body,
    });
    const postText = await postRes.text();
    console.log('POST /api/v1/notes (probe)', postRes.status, postText.slice(0, 200));
    const enc = encodeURIComponent(probePath);
    const verify = await fetch(`${apiBase}/api/v1/notes/${enc}`, { headers: headers() });
    const verifyText = await verify.text();
    console.log('GET after probe', verify.status);
    if (verify.ok) {
      const note = JSON.parse(verifyText);
      const fm = materializeListFrontmatter(note.frontmatter);
      console.log('after_probe frontmatter keys', Object.keys(fm).join(', ') || '(none)');
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
