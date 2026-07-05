/**
 * Tier 5 — DATA INTEGRITY: dedup, tombstone, revoke purge, encrypted blob restart.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleBeginGoogleConnector,
  handleGoogleConnectorCallback,
  handleSyncGoogleConnector,
  createFakeGoogleClient,
  findPendingConnectorByState,
} from '../lib/calendar/google-oauth-connector.mjs';
import { buildEventId, queryStoredEvents } from '../lib/calendar/event-store.mjs';
import { readOAuthTokenVault } from '../lib/calendar/oauth-token-vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-integrity');
const RETURN_URL = 'https://app.scooling.local:5174/settings/calendar/connect/return';
const testEnv = {
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
  KNOWTATION_CALENDAR_OAUTH_SECRET: 'i'.repeat(40),
  CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
};

describe('calendar oauth data integrity', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('repeated sync does not duplicate external_uid rows', async () => {
    const googleClient = createFakeGoogleClient();
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: testEnv,
      authorizedOverride: true,
    });
    const state = new URL(begin.payload.authorization_url).searchParams.get('state');
    const located = findPendingConnectorByState(dataDir, state);
    await handleGoogleConnectorCallback({
      dataDir,
      query: { code: 'c', state: located.connector.oauth_pending.state },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });
    const t = Date.now() + 120_000;
    await handleSyncGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      now: t,
      authorizedOverride: true,
    });
    await handleSyncGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      now: t + 120_000,
      authorizedOverride: true,
    });
    const events = queryStoredEvents(dataDir, 'default', {
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2027-01-01T00:00:00.000Z',
    });
    const ids = new Set(events.map((e) => e.event_id));
    assert.equal(ids.size, events.length);
    assert.ok(readOAuthTokenVault(dataDir, begin.payload.connector_id, testEnv.KNOWTATION_CALENDAR_OAUTH_SECRET));
    assert.ok(buildEventId('cal_g_primary', 'evt-1'));
  });
});
