/**
 * Mirrors web/hub/hub.js project similarity for create-path guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

function normSlug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeProjectKeyForSimilarity(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function levenshteinHub(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[n];
}

function findSimilarFacetProject(userSlug, projectsArr) {
  if (!userSlug || !projectsArr || !projectsArr.length) return null;
  const uNorm = normSlug(String(userSlug));
  if (!uNorm) return null;
  for (const p of projectsArr) {
    if (normSlug(String(p)) === uNorm) return null;
  }
  const uCompact = normalizeProjectKeyForSimilarity(userSlug).replace(/-/g, '');
  let best = null;
  let bestScore = Infinity;
  for (const p of projectsArr) {
    const pv = String(p).trim();
    if (!pv) continue;
    const pNorm = normSlug(pv);
    if (!pNorm) continue;
    const pCompact = normalizeProjectKeyForSimilarity(pv).replace(/-/g, '');
    let score = Infinity;
    if (uCompact.length >= 3 && pCompact.length >= 3 && uCompact === pCompact) score = 0;
    if (score > 0) {
      const a = normalizeProjectKeyForSimilarity(userSlug);
      const b = normalizeProjectKeyForSimilarity(pv);
      const d = levenshteinHub(a, b);
      if (d <= 2 && Math.abs(a.length - b.length) <= 3) score = Math.min(score, d + 0.1);
    }
    if (score > 0) {
      const a = normalizeProjectKeyForSimilarity(userSlug);
      const b = normalizeProjectKeyForSimilarity(pv);
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length <= b.length ? b : a;
      if (shorter.length >= 3 && longer.startsWith(shorter) && longer.length - shorter.length <= 2) {
        score = Math.min(score, longer.length - shorter.length + 0.5);
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = pv;
    }
  }
  return bestScore < 10 ? best : null;
}

function collectProjectSubroots(slug, folderStrings) {
  const prefix = 'projects/' + slug.replace(/^\/+|\/+$/g, '') + '/';
  const subs = new Set();
  for (const f of folderStrings || []) {
    if (!f || typeof f !== 'string') continue;
    const n = f.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!n.startsWith(prefix)) continue;
    const rest = n.slice(prefix.length);
    if (!rest) continue;
    const first = rest.split('/')[0];
    if (first) subs.add(first);
  }
  return [...subs].sort((a, b) => a.localeCompare(b));
}

describe('findSimilarFacetProject', () => {
  const facets = ['born-free', 'store-free'];

  it('returns null when slug matches a facet (normSlug)', () => {
    assert.strictEqual(findSimilarFacetProject('born-free', facets), null);
    assert.strictEqual(findSimilarFacetProject('Born-Free', facets), null);
  });

  it('maps hyphen-less typo to existing slug', () => {
    assert.strictEqual(findSimilarFacetProject('bornfree', facets), 'born-free');
    assert.strictEqual(findSimilarFacetProject('storefree', facets), 'store-free');
  });

  it('returns null when unrelated', () => {
    assert.strictEqual(findSimilarFacetProject('completely-other', ['alpha', 'beta']), null);
  });
});

describe('collectProjectSubroots', () => {
  it('collects first path segment under projects/slug/', () => {
    const folders = ['projects/acme/inbox', 'projects/acme/research/deep', 'inbox', 'projects/other/x'];
    assert.deepStrictEqual(collectProjectSubroots('acme', folders), ['inbox', 'research']);
  });
});
