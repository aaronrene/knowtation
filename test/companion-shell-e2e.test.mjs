/**
 * Tier 3 — END TO END: simulated Phase 5 sign-in → verified runtime → local lane.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { makeAsyncKeychain } from './helpers/companion-keychain-fake.mjs';
import { KEYCHAIN_ACCOUNTS } from '../lib/companion-token-custody.mjs';
import { runCompanionOAuthFlow } from '../lib/companion-oauth-flow.mjs';
import {
  createCompanionShell,
  createRuntimeGroup,
  downloadVerifyAndStageModel,
  validateManifestTrustAnchor,
} from '../lib/companion-shell.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('E2E simulated companion shell', () => {
  it('signs in, verifies model bytes, starts runtime, and selects the local lane', async () => {
    const keychain = makeAsyncKeychain();
    let openedAuthUrl = null;

    const tokenFetch = async (_url, opts) => {
      assert.equal(opts.method, 'POST');
      return {
        ok: true,
        async json() {
          return {
            access_token: 'jwt-access-token',
            refresh_token: 'refresh-token',
            token_type: 'Bearer',
            expires_in: 900,
            scope: 'vault:read vault:write',
          };
        },
      };
    };

    const oauthResult = await runCompanionOAuthFlow({
      authorizationEndpoint: 'https://gateway.knowtation.com/api/v1/auth/native/authorize',
      tokenEndpoint: 'https://gateway.knowtation.com/api/v1/auth/native/token',
      expectedIssuer: 'https://gateway.knowtation.com/api/v1/auth/native',
      clientId: 'native-client',
      scopes: ['vault:read', 'vault:write'],
      keychain,
      fetch: tokenFetch,
      now: () => 5000,
      async openBrowser(url) {
        openedAuthUrl = new URL(url);
        const redirectUri = openedAuthUrl.searchParams.get('redirect_uri');
        const state = openedAuthUrl.searchParams.get('state');
        setTimeout(() => {
          const callback = new URL(redirectUri);
          callback.searchParams.set('code', 'auth-code');
          callback.searchParams.set('state', state);
          callback.searchParams.set('iss', 'https://gateway.knowtation.com/api/v1/auth/native');
          fetch(callback).catch(() => {});
        }, 0);
      },
    });
    assert.equal(oauthResult.ok, true);
    assert.equal(await keychain.get(KEYCHAIN_ACCOUNTS.ACCESS_TOKEN), 'jwt-access-token');
    assert.equal(openedAuthUrl.searchParams.get('code_challenge_method'), 'S256');

    const data = Buffer.from('model bytes used by local enrichment');
    const manifest = {
      manifestUrl: 'https://gateway.knowtation.com/models/native.json',
      modelUrl: 'https://cdn.knowtation-models.com/native.gguf',
      expectedDigest: sha256(data),
      expectedSizeBytes: data.length,
      allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
    };
    assert.equal(validateManifestTrustAnchor(manifest).ok, true);

    const tmp = await mkdtemp(path.join(os.tmpdir(), 'knowtation-phase5-e2e-'));
    try {
      const runtimeGroup = createRuntimeGroup({
        async download(_url, onChunk) {
          onChunk(data);
        },
        async spawn(opts) {
          assert.equal(opts.modelPath, path.join(tmp, 'native.gguf'));
          return { pid: 100, port: opts.port, kill: async () => {} };
        },
        async healthCheck() {
          return true;
        },
      });

      const verifiedPath = path.join(tmp, 'native.gguf');
      await downloadVerifyAndStageModel({
        runtimeGroup,
        tempPath: path.join(tmp, 'native.tmp'),
        verifiedPath,
        spec: manifest,
      });
      assert.equal(await readFile(verifiedPath, 'utf8'), data.toString('utf8'));

      let now = 10_000;
      const shell = createCompanionShell({ runtimeGroup, now: () => now });
      shell.markIntegrityVerified();
      shell.setListenerBound(true);
      shell.setLoopbackTokenPresent(true);
      await shell.startRuntime({
        binaryPath: '/opt/knowtation/runtime',
        modelPath: verifiedPath,
        port: 45678,
        maxRamBytes: 1024,
      });

      assert.equal(shell.companionAvailable(), true);
      assert.equal(shell.selectLane({}, { managedKeyAvailable: true }), 'local');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
