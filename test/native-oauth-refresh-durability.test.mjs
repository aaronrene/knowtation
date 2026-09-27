import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';

import { createNativeOAuthRouter } from '../hub/gateway/native-oauth-provider.mjs';
import { createGatewayRefreshStore } from '../hub/gateway/refresh-token-store.mjs';
import { bindUserToCode, savePendingCode } from '../hub/gateway/native-as-store.mjs';

let dataDir;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowtation-native-refresh-'));
  process.env.KNOWTATION_GATEWAY_DATA_DIR = dataDir;
});

after(async () => {
  delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function startRouter(refreshStore) {
  const app = express();
  const { router } = createNativeOAuthRouter({
    baseUrl: 'http://127.0.0.1',
    issueAccessToken: async (sub) => `access-${sub}`,
    grantedScopes: () => ['vault:read', 'vault:write'],
    refreshStore,
  });
  app.use('/api/v1/auth/native', router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}/api/v1/auth/native`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { status: response.status, json: await response.json() };
}

test('native refresh remains client-bound after the in-memory registration store restarts', async () => {
  const refreshStore = createGatewayRefreshStore({ consistency: 'strong' });
  const first = await startRouter(refreshStore);
  let second;
  try {
    const redirectUri = 'http://127.0.0.1:54123/callback';
    const registration = await fetch(`${first.origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    });
    assert.equal(registration.status, 201);
    const clientId = (await registration.json()).client_id;
    const code = randomUUID();
    const verifier = 'durable-native-refresh-verifier';
    await savePendingCode(code, {
      clientId,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      redirectUri,
      scopes: ['vault:read'],
    });
    await bindUserToCode(code, 'google:durable-user');
    const issued = await postForm(`${first.origin}/token`, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    assert.equal(issued.status, 200);
    assert.ok(issued.json.refresh_token);
    const stored = await refreshStore.peek(issued.json.refresh_token);
    assert.equal(stored.meta.client_id, clientId);
    assert.equal(stored.meta.scopes, 'vault:read');

    await first.close();
    second = await startRouter(refreshStore);
    const wrongClient = await postForm(`${second.origin}/token`, {
      grant_type: 'refresh_token',
      client_id: 'wrong-client',
      refresh_token: issued.json.refresh_token,
    });
    assert.equal(wrongClient.status, 401);

    const refreshed = await postForm(`${second.origin}/token`, {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: issued.json.refresh_token,
    });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.json.refresh_token, issued.json.refresh_token);
    assert.equal(refreshed.json.scope, 'vault:read');
  } finally {
    if (second) await second.close();
    else await first.close().catch(() => {});
  }
});
