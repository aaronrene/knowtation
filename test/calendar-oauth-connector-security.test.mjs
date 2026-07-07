/**
 * Tier 7 — SECURITY: no secret egress, state tamper, gate off, allowlist.
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
  handleRevokeGoogleConnector,
  createFakeGoogleClient,
  isReturnUrlAllowed,
  isRedirectUriAllowed,
} from '../lib/calendar/google-oauth-connector.mjs';
import { buildAuthorizationUrl, PKCE_METHOD_S256 } from '../lib/companion-oauth-pkce.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-oauth-security');
const RETURN_URL = 'https://app.scooling.local:5174/settings/calendar/connect/return';

describe('calendar oauth security', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('gate off returns NOT_AUTHORIZED without network side effects', () => {
    const result = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: {},
      authorizedOverride: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NOT_AUTHORIZED');
  });

  it('list response never includes tokens or oauth_pending', () => {
    const testEnv = {
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
      KNOWTATION_CALENDAR_OAUTH_SECRET: 'k'.repeat(40),
      CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
      SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
    };
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: testEnv,
      authorizedOverride: true,
    });
    const listed = handleListGoogleConnectors({ dataDir, vaultId: 'default', authorizedOverride: true });
    const json = JSON.stringify(listed.payload);
    assert.doesNotMatch(json, /refresh_token/);
    assert.doesNotMatch(json, /code_verifier/);
    assert.doesNotMatch(json, /oauth_pending/);
    assert.doesNotMatch(json, /client_secret/);
    assert.ok(begin.payload.authorization_url.startsWith('https://'));
  });

  it('rejects open return_url and non-exact redirect', () => {
    assert.equal(isReturnUrlAllowed('https://evil.example/steal', [RETURN_URL]), false);
    assert.equal(isReturnUrlAllowed(RETURN_URL, [RETURN_URL]), true);
    assert.equal(isRedirectUriAllowed('https://evil/cb', 'https://hub.local/cb'), false);
  });

  it('PKCE plain method rejected in companion core', () => {
    assert.throws(
      () => buildAuthorizationUrl({
        authorizationEndpoint: 'https://auth.example/authorize',
        clientId: 'c',
        redirectUri: 'http://127.0.0.1:8765/cb',
        scopes: ['openid'],
        state: 's',
        codeChallenge: 'ch',
        codeChallengeMethod: 'plain',
      }),
    );
    assert.equal(PKCE_METHOD_S256, 'S256');
  });

  it('state replay denied on callback', async () => {
    const testEnv = {
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
      KNOWTATION_CALENDAR_OAUTH_SECRET: 'k'.repeat(40),
      CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
      SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
    };
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: testEnv,
      authorizedOverride: true,
    });
    const state = new URL(begin.payload.authorization_url).searchParams.get('state');
    const googleClient = createFakeGoogleClient();
    const first = await handleGoogleConnectorCallback({
      dataDir,
      query: { code: 'c1', state },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });
    assert.equal(first.ok, true);
    const replay = await handleGoogleConnectorCallback({
      dataDir,
      query: { code: 'c2', state },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });
    assert.equal(replay.ok, false);
  });

  it('revoke calls Google revoke endpoint', async () => {
    const testEnv = {
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: 'sec',
      KNOWTATION_CALENDAR_OAUTH_SECRET: 'k'.repeat(40),
      CALENDAR_OAUTH_REDIRECT_URI: 'https://hub.local/callback',
      SCOOLING_RETURN_URL_ALLOWLIST: RETURN_URL,
    };
    const begin = handleBeginGoogleConnector({
      dataDir,
      vaultId: 'default',
      body: { provider: 'google', return_url: RETURN_URL },
      env: testEnv,
      authorizedOverride: true,
    });
    const state = new URL(begin.payload.authorization_url).searchParams.get('state');
    const googleClient = createFakeGoogleClient();
    const { findPendingConnectorByState } = await import('../lib/calendar/google-oauth-connector.mjs');
    const located = findPendingConnectorByState(dataDir, state);
    await handleGoogleConnectorCallback({
      dataDir,
      query: { code: 'c', state: located.connector.oauth_pending.state },
      googleClient,
      env: testEnv,
      authorizedOverride: true,
    });
    let revokeCalled = false;
    const trackingClient = createFakeGoogleClient();
    trackingClient.fetch = async (input) => {
      if (input.url.includes('revoke')) revokeCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await handleRevokeGoogleConnector({
      dataDir,
      vaultId: 'default',
      connectorId: begin.payload.connector_id,
      googleClient: trackingClient,
      env: testEnv,
      authorizedOverride: true,
    });
    assert.equal(revokeCalled, true);
  });
});
