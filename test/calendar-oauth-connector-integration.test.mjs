/**
 * Tier 2 — INTEGRATION: full Google OAuth connector lifecycle (fake Google client).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleBeginGoogleConnector,
  handleGoogleConnectorCallback,
  handleListGoogleConnectors,
  handleSyncGoogleConnector,
  handleRevokeGoogleConnector,
  createFakeGoogleClient,
  findPendingConnectorByState,
} from '../lib/calendar/google-oauth-connector.mjs';
import { listSourceCalendars, queryStoredEvents } from '../lib/calendar/event-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-integration');
const vaultId = 'default';
const RETURN_URL = 'https://app.scooling.local:5174/settings/calendar/connect/return';

const testEnv = {
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'test-client-id',
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'test-client-secret',
  KNOWTATION_CALENDAR_OAUTH_SECRET: 'y'.repeat(40),
  CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/api/v1/calendar/connectors/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
};

describe('calendar oauth integration lifecycle', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('POST begin → callback → list → sync → DELETE', async () => {
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId,
      body: { provider: 'google', display_name: 'Work', return_url: RETURN_URL },
      env: testEnv,
      now: Date.now(),
      authorizedOverride: true,
    });
    assert.equal(begin.ok, true);
    assert.ok(begin.payload.connector_id.startsWith('conn_'));
    assert.match(begin.payload.authorization_url, /accounts\.google\.com/);

    const located = findPendingConnectorByState(dataDir, new URL(begin.payload.authorization_url).searchParams.get('state'));
    assert.ok(located);

    const googleClient = createFakeGoogleClient();
    const callback = await handleGoogleConnectorCallback({
      dataDir,
      query: {
        code: 'auth-code-123',
        state: located.connector.oauth_pending.state,
      },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });
    assert.equal(callback.ok, true);
    assert.match(callback.redirect, /connect=ok/);

    const listed = handleListGoogleConnectors({ dataDir, vaultId, authorizedOverride: true });
    assert.equal(listed.ok, true);
    assert.equal(listed.payload.connectors.length, 1);
    assert.equal(listed.payload.connectors[0].status, 'connected');
    assert.equal(listed.payload.connectors[0].source_calendar_count, 1);

    const calendars = listSourceCalendars(dataDir, vaultId);
    assert.equal(calendars.length, 1);
    assert.equal(calendars[0].provider, 'google');

    const sync = await handleSyncGoogleConnector({
      dataDir,
      vaultId,
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      now: Date.now() + 120_000,
      authorizedOverride: true,
    });
    assert.equal(sync.ok, true);

    const events = queryStoredEvents(dataDir, vaultId, {
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2027-01-01T00:00:00.000Z',
    });
    assert.ok(events.length >= 1);

    const revoke = await handleRevokeGoogleConnector({
      dataDir,
      vaultId,
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });
    assert.equal(revoke.ok, true);
    assert.equal(revoke.payload.revoked, true);
    assert.ok(revoke.payload.events_deleted >= 1);
  });
});
