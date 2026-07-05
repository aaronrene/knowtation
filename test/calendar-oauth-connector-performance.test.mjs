/**
 * Tier 6 — PERFORMANCE: sync + decrypt within budget.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleBeginGoogleConnector,
  handleGoogleConnectorCallback,
  createFakeGoogleClient,
  findPendingConnectorByState,
} from '../lib/calendar/google-oauth-connector.mjs';
import { queryStoredEvents } from '../lib/calendar/event-store.mjs';
import { oauthTokenVaultRoundTrip } from '../lib/calendar/oauth-token-vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-perf');
const RETURN_URL = 'https://app.scooling.local:5174/settings/calendar/connect/return';
const testEnv = {
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
  KNOWTATION_CALENDAR_OAUTH_SECRET: 'p'.repeat(40),
  CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
};

describe('calendar oauth performance', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('initial sync of 100 events completes under 2s', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `evt-${i}`,
      summary: `E ${i}`,
      start: { dateTime: '2026-06-18T17:00:00Z' },
      end: { dateTime: '2026-06-18T18:00:00Z' },
    }));
    const googleClient = createFakeGoogleClient({
      eventsByCalendar: { primary: { items, nextSyncToken: 't1' } },
    });
    const t0 = performance.now();
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
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 2000, `elapsed ${elapsed}ms`);
    const events = queryStoredEvents(dataDir, 'default', {
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2027-01-01T00:00:00.000Z',
    });
    assert.equal(events.length, 100);
  });

  it('20 vault round-trips under 1500ms', () => {
    const secret = 'q'.repeat(40);
    const payload = {
      refresh_token: 'rt',
      scope: 'openid',
      token_type: 'Bearer',
      obtained_at: '2026-07-05T00:00:00.000Z',
      account_sub: 'sub',
    };
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) {
      oauthTokenVaultRoundTrip(secret, payload);
    }
    assert.ok(performance.now() - t0 < 1500);
  });
});
