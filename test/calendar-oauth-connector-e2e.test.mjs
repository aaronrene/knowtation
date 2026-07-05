/**
 * Tier 3 — E2E: connect → timeline events → revoke purge (handler-level walkthrough).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleBeginGoogleConnector,
  handleGoogleConnectorCallback,
  handleRevokeGoogleConnector,
  createFakeGoogleClient,
  findPendingConnectorByState,
} from '../lib/calendar/google-oauth-connector.mjs';
import { buildCalendarTimeline } from '../lib/calendar/timeline.mjs';
import { queryStoredEvents } from '../lib/calendar/event-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-e2e');
const RETURN_URL = 'https://app.scooling.local:5174/settings/calendar/connect/return';
const testEnv = {
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
  KNOWTATION_CALENDAR_OAUTH_SECRET: 'z'.repeat(40),
  CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
};

describe('calendar oauth e2e walkthrough', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('connected Google events appear on timeline then revoke empties store', async () => {
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: testEnv,
      authorizedOverride: true,
    });
    const state = new URL(begin.payload.authorization_url).searchParams.get('state');
    const located = findPendingConnectorByState(dataDir, state);
    const googleClient = createFakeGoogleClient();
    await handleGoogleConnectorCallback({
      dataDir,
      query: { code: 'code', state: located.connector.oauth_pending.state },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });

    const before = queryStoredEvents(dataDir, 'default', {
      fromIso: '2026-06-01T00:00:00.000Z',
      toIso: '2026-06-30T23:59:59.999Z',
      displayOnly: true,
    });
    assert.ok(before.length >= 1);

    await handleRevokeGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });

    const after = queryStoredEvents(dataDir, 'default', {
      fromIso: '2026-06-01T00:00:00.000Z',
      toIso: '2026-06-30T23:59:59.999Z',
    });
    assert.equal(after.length, 0);
  });

  it('invalid_grant on refresh sets needs_reauth', async () => {
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: testEnv,
      authorizedOverride: true,
    });
    const state = new URL(begin.payload.authorization_url).searchParams.get('state');
    const located = findPendingConnectorByState(dataDir, state);
    const googleClient = createFakeGoogleClient();
    await handleGoogleConnectorCallback({
      dataDir,
      query: { code: 'code', state: located.connector.oauth_pending.state },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });

    const badClient = createFakeGoogleClient({
      tokenResponse: { error: 'invalid_grant' },
    });
    const { handleSyncGoogleConnector } = await import('../lib/calendar/google-oauth-connector.mjs');
    const sync = await handleSyncGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient: badClient,
      env: testEnv,
      now: Date.now() + 120_000,
      authorizedOverride: true,
    });
    assert.equal(sync.ok, false);
    assert.equal(sync.code, 'AUTH_EXPIRED');
  });
});
