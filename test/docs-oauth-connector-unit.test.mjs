import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DOCS_OAUTH_GOOGLE_AUTHORIZED,
  GOOGLE_DRIVE_OAUTH_SCOPES,
  handleBeginDocsConnector,
} from '../lib/docs/google-drive-connector.mjs';
import {
  ALLOWED_DRIVE_MIMES,
  buildDriveNameContainsQuery,
  isImportableMime,
  safeId,
} from '../lib/docs/google-drive-normalizer.mjs';
import {
  oauthTokenVaultPath,
  oauthTokenVaultRoundTrip,
  readOAuthTokenVault,
  writeOAuthTokenVault,
} from '../lib/docs/oauth-token-vault.mjs';

test('unit: frozen gates, scopes, MIME and query validation', () => {
  assert.equal(DOCS_OAUTH_GOOGLE_AUTHORIZED, false);
  assert.deepEqual(GOOGLE_DRIVE_OAUTH_SCOPES, [
    'openid',
    'https://www.googleapis.com/auth/drive.readonly',
  ]);
  for (const mime of ALLOWED_DRIVE_MIMES) assert.equal(isImportableMime(mime), true);
  assert.equal(isImportableMime('application/vnd.google-apps.folder'), false);
  assert.equal(buildDriveNameContainsQuery('Quarterly plan'), "name contains 'Quarterly plan'");
  assert.equal(buildDriveNameContainsQuery("x' or trashed = false"), null);
  assert.equal(safeId('../bad:id'), 'badid');
  assert.equal(safeId('a'.repeat(100)).length, 64);
  assert.deepEqual(handleBeginDocsConnector({ dataDir: '/unreadable', vaultId: 'v', body: {} }), {
    ok: false,
    status: 501,
    code: 'NOT_AUTHORIZED',
  });
});

test('unit: docs OAuth vault encrypts, authenticates, and isolates namespace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-unit-'));
  const connectorId = 'conn_0123456789abcdef';
  const secret = 's'.repeat(32);
  const payload = {
    refresh_token: 'refresh-secret',
    scope: GOOGLE_DRIVE_OAUTH_SCOPES.join(' '),
    token_type: 'Bearer',
    obtained_at: '2026-08-17T00:00:00.000Z',
    account_sub: 'subject',
  };
  assert.deepEqual(oauthTokenVaultRoundTrip(secret, payload), payload);
  writeOAuthTokenVault(dir, connectorId, secret, payload);
  assert.equal(oauthTokenVaultPath(dir, connectorId).includes(`${path.sep}docs_oauth${path.sep}`), true);
  assert.deepEqual(readOAuthTokenVault(dir, connectorId, secret), payload);
  assert.equal(fs.readFileSync(oauthTokenVaultPath(dir, connectorId), 'utf8').includes('refresh-secret'), false);
});
