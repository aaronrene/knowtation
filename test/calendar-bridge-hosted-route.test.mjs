/**
 * Hosted bridge calendar route contract tests (step 12 parity).
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

describe('hosted bridge calendar routes', () => {
  it('unit: registers timeline, agent-context, source-calendars, and import routes', () => {
    const bridge = readRepoFile('hub/bridge/server.mjs');
    const gateway = readRepoFile('hub/gateway/server.mjs');

    assert.match(bridge, /app\.get\('\/api\/v1\/calendar\/timeline', requireBridgeAuth/);
    assert.match(bridge, /app\.get\('\/api\/v1\/calendar\/agent-context', requireBridgeAuth/);
    assert.match(bridge, /app\.get\('\/api\/v1\/calendar\/source-calendars', requireBridgeAuth/);
    assert.match(bridge, /app\.patch\('\/api\/v1\/calendar\/source-calendars\/:id', requireBridgeAuth, requireBridgeEditorOrAdmin/);
    assert.match(bridge, /app\.post\('\/api\/v1\/calendar\/events\/import', requireBridgeAuth, requireBridgeEditorOrAdmin/);
    assert.match(bridge, /fetchCanisterNoteRecordsForTimeline/);

    assert.match(gateway, /app\.get\('\/api\/v1\/calendar\/timeline'/);
    assert.match(gateway, /app\.get\('\/api\/v1\/calendar\/agent-context'/);
    assert.match(gateway, /app\.get\('\/api\/v1\/calendar\/source-calendars'/);
    assert.match(gateway, /app\.patch\('\/api\/v1\/calendar\/source-calendars\/:id'/);
    assert.match(gateway, /app\.post\('\/api\/v1\/calendar\/events\/import'/);
  });

  it('security: bridge calendar routes require auth before hosted context resolution', () => {
    const bridge = readRepoFile('hub/bridge/server.mjs');
    const timelineBlock = bridge.slice(
      bridge.indexOf("app.get('/api/v1/calendar/timeline'"),
      bridge.indexOf("app.get('/api/v1/calendar/agent-context'"),
    );

    assert.match(timelineBlock, /requireBridgeAuth/);
    assert.match(timelineBlock, /resolveHostedBridgeContext/);
    assert.doesNotMatch(timelineBlock, /oauth_ref|refresh_token/);
  });

  it('integration: timeline merge can use canister note records without a local vault path', () => {
    const timeline = readRepoFile('lib/calendar/timeline.mjs');
    assert.match(timeline, /noteRecords/);
    assert.match(timeline, /input\.noteRecords != null/);
  });
});
