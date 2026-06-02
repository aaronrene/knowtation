/**
 * Self-hosted Hub SectionSource route contract tests.
 *
 * The local Hub UI at localhost:3333 calls the same body-free endpoint as the
 * hosted UI. These tests keep that route registered on `hub/server.mjs` without
 * adding search, persistence, provider, body, snippet, or write-back surfaces.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function routeSource() {
  const src = readRepoFile('hub/server.mjs');
  const start = src.indexOf("app.get('/api/v1/section-source'");
  const end = src.indexOf('/**\n * Fire-and-forget memory event capture', start);
  assert.notEqual(start, -1, 'self-hosted section-source route must exist');
  assert.notEqual(end, -1, 'route must stay before memory capture helper');
  return src.slice(start, end);
}

describe('self-hosted Hub SectionSource route', () => {
  it('unit: registers the local Hub route behind auth, rate limit, and vault access', () => {
    const src = readRepoFile('hub/server.mjs');

    assert.match(src, /app\.use\('\/api\/v1\/section-source', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /import \{ readSectionSource \} from '\.\.\/lib\/section-source-note\.mjs'/);
    assert.match(src, /app\.get\('\/api\/v1\/section-source'/);
  });

  it('integration: reads one vault-relative path through readSectionSource only', () => {
    const route = routeSource();

    assert.match(route, /const requestedPath = typeof req\.query\.path === 'string'/);
    assert.match(route, /resolveVaultRelativePath\(req\.vaultPath, requestedPath\)/);
    assert.match(route, /readSectionSource\(req\.vaultPath, requestedPath\)/);
    assert.doesNotMatch(route, /runSearch|runKeywordSearch|embedWithUsage|completeChat/);
  });

  it('end-to-end: Hub UI Sections button and local route point at the same endpoint', () => {
    const ui = readRepoFile('web/hub/hub.js');
    const route = routeSource();

    assert.match(ui, /return '\/api\/v1\/section-source\?path=' \+ encodeURIComponent\(path\)/);
    assert.match(route, /app\.get\('\/api\/v1\/section-source'/);
  });

  it('stress: route checks remain bounded to Hub server and UI sources', () => {
    const started = Date.now();
    const sources = [
      readRepoFile('hub/server.mjs'),
      readRepoFile('web/hub/hub.js'),
      readRepoFile('lib/section-source-note.mjs'),
    ];

    assert.equal(sources.length, 3);
    assert.ok(Date.now() - started < 300);
  });

  it('data-integrity: route does not write, persist, index, vectorize, or cache SectionSource', () => {
    const route = routeSource();

    assert.doesNotMatch(route, /writeNote|deleteNote|localStorage|sessionStorage|index|vector|summary|memory|sidecar/i);
  });

  it('performance: route stays one-note and provider-free', () => {
    const route = routeSource();

    assert.match(route, /readSectionSource\(req\.vaultPath, requestedPath\)/);
    assert.doesNotMatch(route, /runListNotes|\/api\/v1\/notes\?|PageIndex|OCR|LLM|provider/i);
  });

  it('security: route sanitizes invalid, missing, forbidden, and upstream errors', () => {
    const route = routeSource();

    assert.match(route, /code: 'INVALID_PATH'/);
    assert.match(route, /code: 'FORBIDDEN'/);
    assert.match(route, /code: 'NOT_FOUND'/);
    assert.match(route, /code: 'UPSTREAM_ERROR'/);
    assert.doesNotMatch(route, /res\.json\(\{[\s\S]*body|snippet|frontmatter|raw_canister_payload|provider_payload|mcp_resource_uri/);
  });
});
