import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createFakeGoogleDriveClient,
  handleBeginDocsConnector,
  handleDocsConnectorCallback,
  handleImportDocsConnectorFiles,
  handleListDocsConnectorFiles,
} from '../lib/docs/google-drive-connector.mjs';

const env = {
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'credential',
  KNOWTATION_DOCS_OAUTH_SECRET: 'v'.repeat(32),
  DOCS_OAUTH_REDIRECT_URI: 'https://hub.example/docs/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: 'https://school.example/connect',
};

test('integration: Drive begin, callback, list, and import create proposals only', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-int-data-'));
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-int-vault-'));
  const client = createFakeGoogleDriveClient({
    files: [{
      id: 'drive_file_1',
      name: 'Plan',
      mimeType: 'text/markdown',
      modifiedTime: '2026-08-17T00:00:00Z',
      size: '7',
    }],
    contents: { drive_file_1: '# Plan\n' },
  });
  const begin = handleBeginDocsConnector({
    dataDir,
    vaultId: 'vault-a',
    body: { provider: 'google-drive', return_url: 'https://school.example/connect' },
    env,
    authorizedOverride: true,
    now: 1_000,
  });
  assert.equal(begin.ok, true);
  const authUrl = new URL(begin.payload.authorization_url);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  const callback = await handleDocsConnectorCallback({
    dataDir,
    query: { state: authUrl.searchParams.get('state'), code: 'authorization-code' },
    googleClient: client,
    env,
    authorizedOverride: true,
    now: 2_000,
  });
  assert.equal(callback.ok, true);
  const list = await handleListDocsConnectorFiles({
    dataDir,
    vaultId: 'vault-a',
    connectorId: begin.payload.connector_id,
    query: {},
    googleClient: client,
    env,
    authorizedOverride: true,
  });
  assert.equal(list.payload.files[0].importable, true);
  assert.equal(Object.hasOwn(list.payload.files[0], 'body'), false);

  const calls = [];
  const imported = await handleImportDocsConnectorFiles({
    dataDir,
    vaultPath,
    vaultId: 'vault-a',
    connectorId: begin.payload.connector_id,
    body: { file_ids: ['drive_file_1'] },
    googleClient: client,
    env,
    authorizedOverride: true,
    createProposalFn: (_dir, input) => {
      calls.push(input);
      return { ...input, proposal_id: 'proposal-1', status: 'proposed' };
    },
    loadProposalsFn: () => [],
    listMarkdownFilesFn: () => [],
  });
  assert.equal(imported.payload.proposed, 1);
  assert.equal(calls[0].source, 'import');
  assert.equal(calls[0].review_queue, 'docs-sync');
  assert.equal(calls[0].path, 'imports/google-drive/drive_file_1.md');
});
