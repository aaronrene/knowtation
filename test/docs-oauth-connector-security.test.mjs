import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PKCE_METHOD_S256 } from '../lib/companion-oauth-pkce.mjs';
import { connectorForClient } from '../lib/docs/docs-connector-store.mjs';
import { DOCS_SYNC_REVIEW_QUEUE } from '../lib/docs/docs-import-propose.mjs';
import {
  DOCS_OAUTH_GOOGLE_AUTHORIZED,
  buildDocsGoogleAuthorizationUrl,
  createFakeGoogleDriveClient,
  handleBeginDocsConnector,
  handleDocsConnectorCallback,
  handleImportDocsConnectorFiles,
  handleListDocsConnectorFiles,
  handleSyncDocsConnector,
} from '../lib/docs/google-drive-connector.mjs';
import { oauthTokenVaultPath } from '../lib/docs/oauth-token-vault.mjs';
import {
  DOCS_NOTION_HUB_KEY_AUTHORIZED,
  handleBeginNotionConnector,
} from '../lib/docs/notion-hub-connector.mjs';
import {
  matchesScoolingMediaFingerprint,
  matchesScoolingTaskFingerprint,
  matchesScoolingFlowFingerprint,
  matchesScoolingReviewTrayFingerprint,
} from '../lib/hub-proposal-personal-self-apply.mjs';

const env = {
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'credential',
  KNOWTATION_DOCS_OAUTH_SECRET: 'v'.repeat(32),
  DOCS_OAUTH_REDIRECT_URI: 'https://hub.example/api/v1/docs/connectors/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: 'https://school.example/connect',
};

test('security: Drive override-off and Notion gate short-circuit before I/O', async () => {
  assert.equal(DOCS_OAUTH_GOOGLE_AUTHORIZED, true);
  assert.equal(DOCS_NOTION_HUB_KEY_AUTHORIZED, false);
  let called = false;
  const googleClient = new Proxy({}, { get: () => { called = true; throw new Error('network touched'); } });
  for (const response of [
    await handleListDocsConnectorFiles({ dataDir: '/denied', googleClient, authorizedOverride: false }),
    await handleImportDocsConnectorFiles({ dataDir: '/denied', googleClient, authorizedOverride: false }),
    await handleSyncDocsConnector({ dataDir: '/denied', googleClient, authorizedOverride: false }),
    handleBeginNotionConnector({ dataDir: '/denied', body: { provider: 'notion' } }),
  ]) {
    assert.equal(response.status, 501);
    assert.equal(response.code, 'NOT_AUTHORIZED');
  }
  assert.equal(called, false);
});

test('security: query injection, id injection, secrets, PKCE, allowlist, namespace, no T5', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-sec-'));
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-sec-vault-'));

  const connector = {
    connector_id: 'conn_0123456789abcdef',
    provider: 'google-drive',
    display_name: 'Drive',
    status: 'connected',
    account_sub: 'private-sub',
    oauth_ref: 'private-ref',
    sync_cursor: 'private-cursor',
    oauth_pending: { state: 'private-state' },
    last_sync_error: 'none',
    file_count: 0,
  };
  const json = JSON.stringify(connectorForClient(connector));
  for (const secret of ['account_sub', 'oauth_ref', 'sync_cursor', 'oauth_pending', 'private-sub', 'private-ref', 'private-cursor']) {
    assert.equal(json.includes(secret), false);
  }

  const driveSource = fs.readFileSync(new URL('../lib/docs/google-drive-connector.mjs', import.meta.url), 'utf8');
  const notionSource = fs.readFileSync(new URL('../lib/docs/notion-hub-connector.mjs', import.meta.url), 'utf8');
  const vaultSource = fs.readFileSync(new URL('../lib/docs/oauth-token-vault.mjs', import.meta.url), 'utf8');
  assert.match(driveSource, /DOCS_OAUTH_GOOGLE_AUTHORIZED = true/);
  assert.match(notionSource, /DOCS_NOTION_HUB_KEY_AUTHORIZED = false/);
  assert.doesNotMatch(driveSource, /from ['"]\.\.\/write\.mjs['"]/);
  assert.doesNotMatch(notionSource, /from ['"]\.\.\/write\.mjs['"]/);
  assert.match(vaultSource, /docs_oauth/);
  assert.doesNotMatch(vaultSource, /calendar_oauth/);
  assert.equal(oauthTokenVaultPath(dataDir, 'conn_0123456789abcdef').includes(`${path.sep}docs_oauth${path.sep}`), true);
  assert.equal(oauthTokenVaultPath(dataDir, 'conn_0123456789abcdef').includes('calendar_oauth'), false);

  const authUrl = buildDocsGoogleAuthorizationUrl({
    clientId: 'client',
    redirectUri: env.DOCS_OAUTH_REDIRECT_URI,
    state: 'state-value',
    codeChallenge: 'challenge',
  });
  const parsed = new URL(authUrl);
  assert.equal(parsed.searchParams.get('code_challenge_method'), PKCE_METHOD_S256);
  assert.notEqual(parsed.searchParams.get('code_challenge_method'), 'plain');

  const deniedReturn = handleBeginDocsConnector({
    dataDir,
    vaultId: 'v',
    body: { provider: 'google-drive', return_url: 'https://evil.example/phish' },
    env,
    authorizedOverride: true,
  });
  assert.equal(deniedReturn.code, 'RETURN_URL_DENIED');

  const begin = handleBeginDocsConnector({
    dataDir,
    vaultId: 'v',
    body: { provider: 'google-drive', return_url: 'https://school.example/connect' },
    env,
    authorizedOverride: true,
    now: 1_000,
  });
  assert.equal(begin.ok, true);
  const state = new URL(begin.payload.authorization_url).searchParams.get('state');
  const client = createFakeGoogleDriveClient({
    files: [{ id: 'ok_file', name: 'Ok', mimeType: 'text/markdown', size: '3', modifiedTime: '2026-08-17T00:00:00Z' }],
    contents: { ok_file: '# Ok' },
  });
  const okCb = await handleDocsConnectorCallback({
    dataDir,
    query: { state, code: 'code-1' },
    googleClient: client,
    env,
    authorizedOverride: true,
    now: 2_000,
  });
  assert.equal(okCb.ok, true);
  assert.doesNotMatch(okCb.redirect, /refresh|access_token|code_verifier|credential/i);

  // Replay same state → deny
  const replay = await handleDocsConnectorCallback({
    dataDir,
    query: { state, code: 'code-2' },
    googleClient: client,
    env,
    authorizedOverride: true,
    now: 3_000,
  });
  assert.equal(replay.ok, false);
  assert.match(replay.redirect ?? '', /reason=state_invalid/);

  // Tampered state
  const tamper = await handleDocsConnectorCallback({
    dataDir,
    query: { state: 'not-the-real-state', code: 'code-3' },
    googleClient: client,
    env,
    authorizedOverride: true,
    now: 4_000,
  });
  assert.equal(tamper.ok, false);
  assert.match(tamper.redirect ?? '', /reason=state_invalid/);

  // Expiry: new begin then callback past TTL
  const begin2 = handleBeginDocsConnector({
    dataDir,
    vaultId: 'v2',
    body: { provider: 'google-drive', return_url: 'https://school.example/connect' },
    env,
    authorizedOverride: true,
    now: 10_000,
  });
  const state2 = new URL(begin2.payload.authorization_url).searchParams.get('state');
  const expired = await handleDocsConnectorCallback({
    dataDir,
    query: { state: state2, code: 'code-4' },
    googleClient: client,
    env,
    authorizedOverride: true,
    now: 10_000 + 11 * 60_000,
  });
  assert.equal(expired.ok, false);
  assert.match(expired.redirect ?? '', /reason=state_invalid/);

  const qBad = await handleListDocsConnectorFiles({
    dataDir,
    vaultId: 'v',
    connectorId: begin.payload.connector_id,
    query: { q: "name contains 'x' or trashed=true" },
    googleClient: client,
    env,
    authorizedOverride: true,
  });
  assert.equal(qBad.status, 400);
  assert.equal(qBad.code, 'BAD_REQUEST');

  const idBad = await handleImportDocsConnectorFiles({
    dataDir,
    vaultPath,
    vaultId: 'v',
    connectorId: begin.payload.connector_id,
    body: { file_ids: ["../etc/passwd", "ok;drop"] },
    googleClient: client,
    env,
    authorizedOverride: true,
  });
  assert.equal(idBad.status, 400);
  assert.equal(idBad.code, 'BAD_REQUEST');

  // Scooling-shaped POST import gdrive/notion is not this route (no source_type field accepted)
  const shaped = await handleImportDocsConnectorFiles({
    dataDir,
    vaultPath,
    vaultId: 'v',
    connectorId: begin.payload.connector_id,
    body: { source_type: 'gdrive', file_ids: ['ok_file'] },
    googleClient: client,
    env,
    authorizedOverride: true,
  });
  assert.equal(shaped.status, 400);
  assert.equal(shaped.code, 'BAD_REQUEST');

  const notionBegin = handleBeginNotionConnector({
    dataDir,
    vaultId: 'vn',
    body: { provider: 'notion' },
    env: { NOTION_API_KEY: 'super-secret-notion-key' },
    authorizedOverride: true,
  });
  const notionJson = JSON.stringify(notionBegin.payload);
  assert.equal(notionJson.includes('super-secret-notion-key'), false);
  assert.equal(notionJson.includes('NOTION_API_KEY'), false);

  // docs-sync has no T5 fingerprint admission helpers
  const fakeProposal = {
    source: 'import',
    review_queue: DOCS_SYNC_REVIEW_QUEUE,
    path: 'imports/google-drive/ok_file.md',
    intent: 'docs-sync import: Ok',
    frontmatter: { source: 'google-drive', source_id: 'ok_file' },
  };
  assert.equal(matchesScoolingReviewTrayFingerprint(fakeProposal), false);
  assert.equal(matchesScoolingTaskFingerprint(fakeProposal), false);
  assert.equal(matchesScoolingMediaFingerprint(fakeProposal), false);
  assert.equal(matchesScoolingFlowFingerprint(fakeProposal), false);
  const selfApplySrc = fs.readFileSync(new URL('../lib/hub-proposal-personal-self-apply.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(selfApplySrc, /docs-sync/);
  assert.doesNotMatch(selfApplySrc, /google-drive/);
});
