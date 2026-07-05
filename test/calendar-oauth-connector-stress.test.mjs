/**
 * Tier 4 — STRESS: many calendars/events, rate limit, 410 resync.
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
  CONNECTOR_SYNC_RATE_LIMIT_MS,
} from '../lib/calendar/google-oauth-connector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-stress');
const RETURN_URL = 'https://app.scooling.local:5174/settings/calendar/connect/return';
const testEnv = {
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
  KNOWTATION_CALENDAR_OAUTH_SECRET: 's'.repeat(40),
  CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
};

describe('calendar oauth stress', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('handles many calendars and respects sync rate limit', async () => {
    const calendars = Array.from({ length: 20 }, (_, i) => ({ id: `cal-${i}`, summary: `Cal ${i}` }));
    const eventsByCalendar = Object.fromEntries(
      calendars.map((c) => [c.id, {
        items: Array.from({ length: 5 }, (_, j) => ({
          id: `${c.id}-evt-${j}`,
          summary: `Event ${j}`,
          start: { dateTime: '2026-06-18T17:00:00Z' },
          end: { dateTime: '2026-06-18T18:00:00Z' },
        })),
        nextSyncToken: `token-${c.id}`,
      }]),
    );
    const googleClient = createFakeGoogleClient({ calendars, eventsByCalendar });
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
    const t0 = Date.now() + CONNECTOR_SYNC_RATE_LIMIT_MS + 1;
    const first = await handleSyncGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      now: t0,
      authorizedOverride: true,
    });
    assert.equal(first.ok, true);
    const second = await handleSyncGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient,
      env: testEnv,
      now: t0 + 1000,
      authorizedOverride: true,
    });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'RATE_LIMITED');
  });
});
