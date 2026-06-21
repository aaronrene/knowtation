/**
 * Self-hosted Hub calendar routes — contract tests (Phase 1B).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function timelineRouteSource() {
  const src = readRepoFile('hub/server.mjs');
  const start = src.indexOf("app.get('/api/v1/calendar/timeline'");
  const end = src.indexOf('// GET /api/v1/calendar/source-calendars', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return src.slice(start, end);
}

describe('self-hosted Hub calendar timeline route', () => {
  it('unit: registers calendar routes behind auth, rate limit, and vault access', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(src, /app\.use\('\/api\/v1\/calendar', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /buildCalendarTimeline/);
    assert.match(src, /listSourceCalendarsForClient/);
    assert.match(src, /from '\.\.\/lib\/calendar\/timeline\.mjs'/);
    assert.match(src, /app\.get\('\/api\/v1\/calendar\/timeline'/);
    assert.match(src, /app\.post\('\/api\/v1\/calendar\/events\/import'/);
  });

  it('integration: timeline route delegates to buildCalendarTimeline only', () => {
    const route = timelineRouteSource();
    assert.match(route, /buildCalendarTimeline\(/);
    assert.match(route, /req\.vaultPath/);
    assert.doesNotMatch(route, /parseIcsToEvents|oauth|google|microsoft/i);
  });

  it('end-to-end: OpenAPI documents calendar timeline and import endpoints', () => {
    const api = readRepoFile('docs/openapi.yaml');
    assert.match(api, /\/calendar\/timeline:/);
    assert.match(api, /knowtation\.calendar_timeline\/v0/);
    assert.match(api, /\/calendar\/events\/import:/);
    assert.match(api, /\/calendar\/source-calendars\/\{id\}:/);
    assert.match(api, /SourceCalendarPatchRequest/);
  });

  it('security: import route requires editor/admin and never returns oauth_ref', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(src, /app\.post\('\/api\/v1\/calendar\/events\/import', requireRole\('editor', 'admin'\)/);
    assert.match(src, /app\.patch\('\/api\/v1\/calendar\/source-calendars\/:id', requireRole\('editor', 'admin'\)/);
    assert.doesNotMatch(src, /oauth_ref/);
  });
});
