import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createFakeGoogleDriveClient,
  handleListDocsConnectorFiles,
  handleSyncDocsConnector,
} from '../lib/docs/google-drive-connector.mjs';
import { saveConnector } from '../lib/docs/docs-connector-store.mjs';
import { writeOAuthTokenVault } from '../lib/docs/oauth-token-vault.mjs';

test('stress: concurrent sync rejects the second request', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-stress-data-'));
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-stress-vault-'));
  const connectorId = 'conn_0123456789abcdef';
  const env = {
    GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'client',
    GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'credential',
    KNOWTATION_DOCS_OAUTH_SECRET: 'x'.repeat(32),
    DOCS_OAUTH_REDIRECT_URI: 'https://hub.example/callback',
  };
  saveConnector(dataDir, 'vault-s', {
    connector_id: connectorId,
    provider: 'google-drive',
    display_name: 'Drive',
    status: 'connected',
    oauth_ref: connectorId,
    account_sub: 'subject',
    sync_cursor: null,
    last_sync_at: null,
    last_sync_error: 'none',
    file_count: 0,
    revoked_at: null,
    oauth_pending: null,
  });
  writeOAuthTokenVault(dataDir, connectorId, env.KNOWTATION_DOCS_OAUTH_SECRET, {
    refresh_token: 'refresh',
    scope: 'openid https://www.googleapis.com/auth/drive.readonly',
    token_type: 'Bearer',
    obtained_at: '2026-08-17T00:00:00Z',
    account_sub: 'subject',
  });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const client = createFakeGoogleDriveClient({
    filesList: async () => {
      await blocked;
      return { files: [] };
    },
  });
  const ctx = {
    dataDir,
    vaultPath,
    vaultId: 'vault-s',
    connectorId,
    env,
    googleClient: client,
    authorizedOverride: true,
    now: 100_000,
  };
  const first = handleSyncDocsConnector(ctx);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await handleSyncDocsConnector(ctx);
  assert.equal(second.status, 429);
  assert.equal(second.code, 'RATE_LIMITED');
  release();
  assert.equal((await first).ok, true);
});

test('stress: provider rate limiting retries at most three times', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-rate-data-'));
  const connectorId = 'conn_fedcba9876543210';
  const env = {
    GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'client',
    GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'credential',
    KNOWTATION_DOCS_OAUTH_SECRET: 'r'.repeat(32),
    DOCS_OAUTH_REDIRECT_URI: 'https://hub.example/callback',
  };
  saveConnector(dataDir, 'vault-r', {
    connector_id: connectorId,
    provider: 'google-drive',
    display_name: 'Drive',
    status: 'connected',
    oauth_ref: connectorId,
    account_sub: 'subject',
    sync_cursor: null,
    last_sync_at: null,
    last_sync_error: 'none',
    file_count: 0,
    revoked_at: null,
    oauth_pending: null,
  });
  writeOAuthTokenVault(dataDir, connectorId, env.KNOWTATION_DOCS_OAUTH_SECRET, {
    refresh_token: 'refresh',
    scope: 'openid https://www.googleapis.com/auth/drive.readonly',
    token_type: 'Bearer',
    obtained_at: '2026-08-17T00:00:00Z',
    account_sub: 'subject',
  });
  let calls = 0;
  const client = createFakeGoogleDriveClient({
    filesList: () => {
      calls += 1;
      return { status: 429, retryAfterMs: 1 };
    },
  });
  const response = await handleListDocsConnectorFiles({
    dataDir,
    vaultId: 'vault-r',
    connectorId,
    query: {},
    env,
    googleClient: client,
    authorizedOverride: true,
    sleepFn: async () => {},
  });
  assert.equal(response.code, 'RATE_LIMITED');
  assert.equal(calls, 3);
});
