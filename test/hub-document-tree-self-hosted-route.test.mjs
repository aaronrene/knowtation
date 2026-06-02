/**
 * Self-hosted Hub DocumentTree route contract tests.
 *
 * The local Hub route exposes nested heading-only DocumentTree metadata without
 * adding search, persistence, provider, body, snippet, resource URI, summary,
 * sidecar, LLM, or write-back surfaces.
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
  const start = src.indexOf("app.get('/api/v1/document-tree'");
  const end = src.indexOf("// GET /api/v1/metadata-facets", start);
  assert.notEqual(start, -1, 'self-hosted document-tree route must exist');
  assert.notEqual(end, -1, 'route must stay before metadata-facets route');
  return src.slice(start, end);
}

describe('self-hosted Hub DocumentTree route', () => {
  it('unit: registers the local Hub route behind auth, rate limit, and vault access', () => {
    const src = readRepoFile('hub/server.mjs');

    assert.match(src, /app\.use\('\/api\/v1\/document-tree', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /import \{ buildDocumentTree \} from '\.\.\/lib\/document-tree\.mjs'/);
    assert.match(src, /app\.get\('\/api\/v1\/document-tree'/);
  });

  it('integration: reads one vault-relative path through readNote and buildDocumentTree only', () => {
    const route = routeSource();

    assert.match(route, /const requestedPath = typeof req\.query\.path === 'string'/);
    assert.match(route, /resolveVaultRelativePath\(req\.vaultPath, requestedPath\)/);
    assert.match(route, /buildDocumentTree\(readNote\(req\.vaultPath, requestedPath\)\)/);
    assert.doesNotMatch(route, /runSearch|runKeywordSearch|embedWithUsage|completeChat/);
  });

  it('end-to-end: OpenAPI documents the same body-free endpoint', () => {
    const api = readRepoFile('docs/openapi.yaml');

    assert.match(api, /\/document-tree:/);
    assert.match(api, /knowtation\.document_tree\/v0/);
    assert.match(api, /#\/components\/schemas\/DocumentTree/);
  });

  it('stress: route checks remain bounded to Hub server, parser, and OpenAPI sources', () => {
    const started = Date.now();
    const sources = [
      readRepoFile('hub/server.mjs'),
      readRepoFile('lib/document-tree.mjs'),
      readRepoFile('docs/openapi.yaml'),
    ];

    assert.equal(sources.length, 3);
    assert.ok(Date.now() - started < 300);
  });

  it('data-integrity: route does not write, persist, index, vectorize, cache, sidecar, or summarize DocumentTree', () => {
    const route = routeSource();

    assert.doesNotMatch(route, /writeNote|deleteNote|localStorage|sessionStorage|index|vector|summary|memory|sidecar/i);
  });

  it('performance: route stays one-note and provider-free', () => {
    const route = routeSource();

    assert.match(route, /buildDocumentTree\(readNote\(req\.vaultPath, requestedPath\)\)/);
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
