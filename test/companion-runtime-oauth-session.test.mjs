import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPANION_DISCOVERY_URL,
  COMPANION_HUB_ORIGIN,
  COMPANION_NATIVE_ISSUER,
  COMPANION_SESSION_URL,
  discoverCompanionOAuth,
  ensureHostedSession,
  inspectCompanionSession,
  signOutCompanion,
  verifyHostedSession,
} from '../companion/runtime/oauth-session.mjs';
import { buildSessionMeta, createTokenCustody } from '../lib/companion-token-custody.mjs';
import { makeSyncKeychain } from './helpers/companion-keychain-fake.mjs';

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  };
}

function discovery(overrides = {}) {
  return {
    issuer: COMPANION_NATIVE_ISSUER,
    authorization_endpoint: `${COMPANION_NATIVE_ISSUER}/authorize`,
    token_endpoint: `${COMPANION_NATIVE_ISSUER}/token`,
    registration_endpoint: `${COMPANION_NATIVE_ISSUER}/register`,
    revocation_endpoint: `${COMPANION_NATIVE_ISSUER}/revoke`,
    ...overrides,
  };
}

async function storeSession(keychain, {
  now = 0,
  expiresIn = 60,
  accessToken = 'access-old',
  refreshToken = 'refresh-old',
  clientId = 'native-client',
} = {}) {
  const custody = createTokenCustody(keychain);
  const meta = buildSessionMeta(
    { expiresIn, refreshToken, scope: 'vault:read vault:write', tokenType: 'Bearer' },
    {
      now,
      refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
      issuer: COMPANION_NATIVE_ISSUER,
      clientId,
    },
  );
  await custody.storeSession({ accessToken, refreshToken, meta });
}

describe('standalone companion hosted OAuth session', () => {
  it('pins discovery to the production HTTPS issuer and exact endpoints', async () => {
    const oauth = await discoverCompanionOAuth({
      fetchImpl: async (url, options) => {
        assert.equal(url, COMPANION_DISCOVERY_URL);
        assert.equal(options.redirect, 'error');
        return jsonResponse(200, discovery());
      },
    });
    assert.equal(oauth.issuer, COMPANION_NATIVE_ISSUER);
    assert.equal(oauth.tokenEndpoint, `${COMPANION_NATIVE_ISSUER}/token`);

    await assert.rejects(
      discoverCompanionOAuth({
        fetchImpl: async () => jsonResponse(200, discovery({ token_endpoint: 'https://attacker.example/token' })),
      }),
      { code: 'companion_discovery_invalid' },
    );
  });

  it('returns a still-valid stored session without network access', async () => {
    const keychain = makeSyncKeychain();
    await storeSession(keychain, { now: 1_000, expiresIn: 3600 });
    const session = await ensureHostedSession({
      keychain,
      now: () => 2_000,
      fetchImpl: async () => { throw new Error('unexpected network'); },
    });
    assert.equal(session.accessToken, 'access-old');
    assert.equal((await inspectCompanionSession({ keychain, now: () => 2_000 })).session, 'valid');
  });

  it('refreshes an expired session with the durable public client id and rotates custody', async () => {
    const keychain = makeSyncKeychain();
    await storeSession(keychain);
    let refreshBody = '';
    const fetchImpl = async (url, options) => {
      if (url === COMPANION_DISCOVERY_URL) return jsonResponse(200, discovery());
      if (url === `${COMPANION_NATIVE_ISSUER}/token`) {
        refreshBody = options.body;
        return jsonResponse(200, {
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          token_type: 'Bearer',
          expires_in: 900,
          scope: 'vault:read',
        });
      }
      throw new Error('unexpected URL');
    };
    const session = await ensureHostedSession({ keychain, fetchImpl, now: () => 70_000 });
    const params = new URLSearchParams(refreshBody);
    assert.equal(params.get('client_id'), 'native-client');
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(session.accessToken, 'access-new');
    assert.equal(session.refreshToken, 'refresh-new');
    assert.equal(session.clientId, 'native-client');
  });

  it('clears custody when the authorization server rejects refresh', async () => {
    const keychain = makeSyncKeychain();
    await storeSession(keychain);
    const fetchImpl = async (url) => {
      if (url === COMPANION_DISCOVERY_URL) return jsonResponse(200, discovery());
      return jsonResponse(401, { error: 'invalid_grant' });
    };
    await assert.rejects(
      ensureHostedSession({ keychain, fetchImpl, now: () => 70_000 }),
      { code: 'companion_sign_in_required' },
    );
    assert.equal(await createTokenCustody(keychain).loadSession(), null);
  });

  it('verifies authenticated caller posture without returning identity or tokens', async () => {
    const keychain = makeSyncKeychain();
    await storeSession(keychain, { now: 1_000, expiresIn: 3600 });
    const result = await verifyHostedSession({
      keychain,
      now: () => 2_000,
      fetchImpl: async (url, options) => {
        assert.equal(url, COMPANION_SESSION_URL);
        assert.match(options.headers.Authorization, /^Bearer /);
        return jsonResponse(200, {
          type: 'session',
          sub: 'private-user-id',
          scopes: ['vault:read', 'vault:write'],
        });
      },
    });
    assert.deepEqual(result, { authenticated: true, scopes: ['vault:read', 'vault:write'] });
    assert.doesNotMatch(JSON.stringify(result), /private-user-id|access-old/);
  });

  it('attempts remote revocation and always clears local custody', async () => {
    const keychain = makeSyncKeychain();
    await storeSession(keychain);
    let revokeBody = '';
    const result = await signOutCompanion({
      keychain,
      fetchImpl: async (url, options) => {
        if (url === COMPANION_DISCOVERY_URL) return jsonResponse(200, discovery());
        assert.equal(url, `${COMPANION_NATIVE_ISSUER}/revoke`);
        revokeBody = options.body;
        return jsonResponse(200, { ok: true });
      },
    });
    assert.deepEqual(result, { signedOut: true, remoteRevoked: true });
    assert.equal(new URLSearchParams(revokeBody).get('client_id'), 'native-client');
    assert.equal(await createTokenCustody(keychain).loadSession(), null);
  });

  it('keeps the hosted origin fixed and rejects caller environment substitution', () => {
    assert.equal(COMPANION_HUB_ORIGIN, 'https://mcp.knowtation.store');
    assert.equal(COMPANION_SESSION_URL, `${COMPANION_HUB_ORIGIN}/api/v1/auth/session`);
  });
});
