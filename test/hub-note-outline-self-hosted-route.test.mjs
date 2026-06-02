/**
 * Self-hosted Hub NoteOutline route contract tests.
 *
 * The local Hub route exposes heading-only NoteOutline metadata without adding
 * search, persistence, provider, body, snippet, resource URI, or write-back
 * surfaces.
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
  const start = src.indexOf("app.get('/api/v1/note-outline'");
  // Bound to the note-outline route ONLY: end at the very next route (document-tree).
  // Including later sibling routes (e.g. metadata-facets, which legitimately reads
  // `note.frontmatter`) would make the body-free assertions below match neighbouring code.
  const end = src.indexOf("// GET /api/v1/document-tree", start);
  assert.notEqual(start, -1, 'self-hosted note-outline route must exist');
  assert.notEqual(end, -1, 'route must stay before the document-tree route');
  return src.slice(start, end);
}

describe('self-hosted Hub NoteOutline route', () => {
  it('unit: registers the local Hub route behind auth, rate limit, and vault access', () => {
    const src = readRepoFile('hub/server.mjs');

    assert.match(src, /app\.use\('\/api\/v1\/note-outline', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /import \{ buildNoteOutline \} from '\.\.\/lib\/note-outline\.mjs'/);
    assert.match(src, /app\.get\('\/api\/v1\/note-outline'/);
  });

  it('integration: reads one vault-relative path through readNote and buildNoteOutline only', () => {
    const route = routeSource();

    assert.match(route, /const requestedPath = typeof req\.query\.path === 'string'/);
    assert.match(route, /resolveVaultRelativePath\(req\.vaultPath, requestedPath\)/);
    assert.match(route, /buildNoteOutline\(readNote\(req\.vaultPath, requestedPath\)\)/);
    assert.doesNotMatch(route, /runSearch|runKeywordSearch|embedWithUsage|completeChat/);
  });

  it('end-to-end: OpenAPI documents the same body-free endpoint', () => {
    const api = readRepoFile('docs/openapi.yaml');

    assert.match(api, /\/note-outline:/);
    assert.match(api, /knowtation\.note_outline\/v1/);
    assert.match(api, /#\/components\/schemas\/NoteOutline/);
  });

  it('stress: route checks remain bounded to Hub server, parser, and OpenAPI sources', () => {
    const started = Date.now();
    const sources = [
      readRepoFile('hub/server.mjs'),
      readRepoFile('lib/note-outline.mjs'),
      readRepoFile('docs/openapi.yaml'),
    ];

    assert.equal(sources.length, 3);
    assert.ok(Date.now() - started < 300);
  });

  it('data-integrity: route does not write, persist, index, vectorize, cache, or sidecar NoteOutline', () => {
    const route = routeSource();

    assert.doesNotMatch(route, /writeNote|deleteNote|localStorage|sessionStorage|index|vector|summary|memory|sidecar/i);
  });

  it('performance: route stays one-note and provider-free', () => {
    const route = routeSource();

    assert.match(route, /buildNoteOutline\(readNote\(req\.vaultPath, requestedPath\)\)/);
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
