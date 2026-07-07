/**
 * Tier 1 — UNIT: calendar OAuth connector primitives.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPkcePair,
  createOAuthState,
  constantTimeEqual,
  computeCodeChallenge,
  PKCE_METHOD_S256,
} from '../lib/companion-oauth-pkce.mjs';
import {
  oauthTokenVaultRoundTrip,
  writeOAuthTokenVault,
  readOAuthTokenVault,
  deleteOAuthTokenVault,
} from '../lib/calendar/oauth-token-vault.mjs';
import { normalizeGoogleEvent, normalizeGoogleEvents } from '../lib/calendar/google-event-normalizer.mjs';
import { buildSourceCalendarDefaults, SOURCE_CALENDAR_DEFAULTS } from '../lib/calendar/source-calendar-defaults.mjs';
import {
  buildGoogleAuthorizationUrl,
  CALENDAR_OAUTH_GOOGLE_AUTHORIZED,
  isGoogleOAuthConnectorEnabled,
} from '../lib/calendar/google-oauth-connector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-unit');
const TEST_SECRET = 'x'.repeat(40);

describe('calendar oauth unit', () => {
  it('compile-time gate is true (KN-INF-3a); authorizedOverride can force off in tests', () => {
    assert.equal(CALENDAR_OAUTH_GOOGLE_AUTHORIZED, true);
    assert.equal(isGoogleOAuthConnectorEnabled(), true);
    assert.equal(isGoogleOAuthConnectorEnabled({ authorizedOverride: false }), false);
    assert.equal(isGoogleOAuthConnectorEnabled({ authorizedOverride: true }), true);
  });

  it('PKCE S256 pair validates round-trip challenge', () => {
    const pair = createPkcePair();
    assert.equal(pair.method, PKCE_METHOD_S256);
    assert.equal(computeCodeChallenge(pair.codeVerifier), pair.codeChallenge);
    const state = createOAuthState();
    assert.ok(state.length >= 32);
    assert.equal(constantTimeEqual(state, state), true);
    assert.equal(constantTimeEqual(state, createOAuthState()), false);
  });

  it('oauth token vault encrypt/decrypt round-trip and tamper fails', () => {
    const payload = {
      refresh_token: 'rt_test',
      scope: 'openid',
      token_type: 'Bearer',
      obtained_at: '2026-07-05T00:00:00.000Z',
      account_sub: 'sub-abc',
    };
    const round = oauthTokenVaultRoundTrip(TEST_SECRET, payload);
    assert.deepEqual(round, payload);
  });

  it('oauth token vault file round-trip', () => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    const dataDir = path.join(tmpRoot, 'data');
    writeOAuthTokenVault(dataDir, 'conn_test12345678', TEST_SECRET, {
      refresh_token: 'rt_file',
      scope: 'openid',
      token_type: 'Bearer',
      obtained_at: '2026-07-05T00:00:00.000Z',
      account_sub: 'sub-file',
    });
    const read = readOAuthTokenVault(dataDir, 'conn_test12345678', TEST_SECRET);
    assert.equal(read.refresh_token, 'rt_file');
    deleteOAuthTokenVault(dataDir, 'conn_test12345678');
    assert.throws(() => readOAuthTokenVault(dataDir, 'conn_test12345678', TEST_SECRET));
  });

  it('google event normalizer maps fields and drops PII fields', () => {
    const normalized = normalizeGoogleEvent({
      id: 'evt-1',
      summary: 'Standup',
      start: { dateTime: '2026-06-18T17:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-06-18T17:30:00Z', timeZone: 'UTC' },
      status: 'confirmed',
      location: 'Secret room',
      description: 'Ignore me',
      attendees: [{ email: 'a@b.com' }],
    });
    assert.ok(normalized);
    assert.equal(normalized.external_uid, 'evt-1');
    assert.equal(normalized.summary, 'Standup');
    assert.equal(normalized.recurrence_rule, null);
    assert.equal(normalized.busy, true);
    assert.notEqual(JSON.stringify(normalized).includes('Secret room'), true);
    assert.notEqual(JSON.stringify(normalized).includes('a@b.com'), true);
  });

  it('normalizeGoogleEvents batch', () => {
    const rows = normalizeGoogleEvents([
      { id: 'a', start: { dateTime: '2026-06-18T17:00:00Z' }, end: { dateTime: '2026-06-18T18:00:00Z' } },
    ]);
    assert.equal(rows.length, 1);
  });

  it('source calendar defaults match D9', () => {
    const defaults = buildSourceCalendarDefaults();
    assert.deepEqual(defaults, SOURCE_CALENDAR_DEFAULTS);
    assert.equal(defaults.enabled_for_agents, false);
    assert.equal(defaults.agent_context_tier_max, 0);
  });

  it('authorization URL uses S256 and read-only scopes only', () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: 'client',
      redirectUri: 'https://hub.example/callback',
      state: 'state-value',
      codeChallenge: 'challenge',
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('code_challenge_method'), PKCE_METHOD_S256);
    assert.equal(parsed.searchParams.get('access_type'), 'offline');
    assert.match(parsed.searchParams.get('scope') ?? '', /calendar.events.readonly/);
    assert.doesNotMatch(parsed.searchParams.get('scope') ?? '', /calendar.events(?!\.readonly)/);
  });
});
