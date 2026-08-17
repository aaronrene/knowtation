import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProposal, getProposal, updateProposalStatus } from '../hub/proposals-store.mjs';
import { writeNote } from '../lib/write.mjs';
import { readNote as readVaultNote } from '../lib/vault.mjs';
import {
  createFakeGoogleDriveClient,
  handleBeginDocsConnector,
  handleDocsConnectorCallback,
  handleImportDocsConnectorFiles,
  handleListDocsConnectorFiles,
  handleRevokeDocsConnector,
  DOCS_OAUTH_GOOGLE_AUTHORIZED,
} from '../lib/docs/google-drive-connector.mjs';
import {
  createFakeNotionClient,
  handleBeginNotionConnector,
  handleImportNotionConnectorFiles,
  handleListNotionConnectorFiles,
  handleRevokeNotionConnector,
  DOCS_NOTION_HUB_KEY_AUTHORIZED,
} from '../lib/docs/notion-hub-connector.mjs';
import {
  handleBeginDocsProvider,
  handleListAllDocsConnectors,
} from '../lib/docs/docs-api.mjs';

const pageId = '01234567-89ab-cdef-0123-456789abcdef';
const driveEnv = {
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'credential',
  KNOWTATION_DOCS_OAUTH_SECRET: 'v'.repeat(32),
  DOCS_OAUTH_REDIRECT_URI: 'https://hub.example/api/v1/docs/connectors/callback',
  SCOOLING_RETURN_URL_ALLOWLIST: 'https://school.example/connect',
};

test('e2e: Notion Hub-key list, review import, and revoke keep notes untouched', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-e2e-data-'));
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-e2e-vault-'));
  const env = { NOTION_API_KEY: 'server-only-value' };
  const notionClient = createFakeNotionClient({
    results: [{
      object: 'page',
      id: pageId,
      last_edited_time: '2026-08-17T00:00:00Z',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Roadmap' }] } },
    }],
    markdownByPage: { [pageId]: '# Roadmap' },
  });
  const begin = handleBeginNotionConnector({
    dataDir,
    vaultId: 'vault-n',
    body: { provider: 'notion', return_url: 'ignored' },
    env,
    authorizedOverride: true,
  });
  assert.equal(begin.payload.status, 'connected');
  const listed = await handleListNotionConnectorFiles({
    dataDir,
    vaultId: 'vault-n',
    connectorId: begin.payload.connector_id,
    query: {},
    env,
    notionClient,
    authorizedOverride: true,
  });
  assert.equal(listed.payload.files[0].name, 'Roadmap');
  const proposals = [];
  const imported = await handleImportNotionConnectorFiles({
    dataDir,
    vaultPath,
    vaultId: 'vault-n',
    connectorId: begin.payload.connector_id,
    body: { file_ids: [pageId] },
    env,
    notionClient,
    authorizedOverride: true,
    createProposalFn: (_dir, input) => {
      proposals.push(input);
      return { ...input, proposal_id: 'notion-proposal', status: 'proposed' };
    },
    loadProposalsFn: () => [],
    listMarkdownFilesFn: () => [],
  });
  assert.equal(imported.payload.proposed, 1);
  assert.equal(proposals[0].path, `imports/notion/${pageId}.md`);
  assert.equal(proposals[0].review_queue, 'docs-sync');
  fs.writeFileSync(path.join(vaultPath, 'kept.md'), '# Canonical note', 'utf8');
  const revoked = handleRevokeNotionConnector({
    dataDir,
    vaultId: 'vault-n',
    connectorId: begin.payload.connector_id,
    authorizedOverride: true,
  });
  assert.equal(revoked.payload.revoked, true);
  assert.equal(fs.existsSync(path.join(vaultPath, 'kept.md')), true);
});

test('e2e: Drive connect → list metadata → docs-sync proposal → apply note → revoke keeps note', async () => {
  assert.equal(DOCS_OAUTH_GOOGLE_AUTHORIZED, false);
  assert.equal(DOCS_NOTION_HUB_KEY_AUTHORIZED, false);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-e2e-drive-data-'));
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-e2e-drive-vault-'));
  const client = createFakeGoogleDriveClient({
    files: [{
      id: 'drive_file_e2e',
      name: 'Brief',
      mimeType: 'text/markdown',
      modifiedTime: '2026-08-17T00:00:00Z',
      size: '12',
    }],
    contents: { drive_file_e2e: '# Brief body\n' },
  });

  const denied = handleBeginDocsProvider({
    dataDir,
    vaultId: 'vault-d',
    body: { provider: 'google-drive', return_url: 'https://school.example/connect' },
    env: driveEnv,
  });
  assert.equal(denied.code, 'NOT_AUTHORIZED');
  assert.equal(denied.status, 501);

  const begin = handleBeginDocsConnector({
    dataDir,
    vaultId: 'vault-d',
    body: { provider: 'google-drive', return_url: 'https://school.example/connect' },
    env: driveEnv,
    authorizedOverride: true,
    now: 1_000,
  });
  assert.equal(begin.ok, true);
  const state = new URL(begin.payload.authorization_url).searchParams.get('state');
  const callback = await handleDocsConnectorCallback({
    dataDir,
    query: { state, code: 'auth-code' },
    googleClient: client,
    env: driveEnv,
    authorizedOverride: true,
    now: 2_000,
  });
  assert.equal(callback.ok, true);
  assert.match(callback.redirect, /connect=ok/);
  assert.doesNotMatch(callback.redirect, /refresh|access_token|code_verifier/i);

  const listedConnectors = handleListAllDocsConnectors({
    dataDir,
    vaultId: 'vault-d',
    authorizedOverride: true,
  });
  assert.equal(listedConnectors.payload.connectors.length, 1);
  assert.equal(listedConnectors.payload.connectors[0].status, 'connected');
  assert.equal(Object.hasOwn(listedConnectors.payload.connectors[0], 'oauth_ref'), false);
  assert.equal(Object.hasOwn(listedConnectors.payload.connectors[0], 'sync_cursor'), false);

  const files = await handleListDocsConnectorFiles({
    dataDir,
    vaultId: 'vault-d',
    connectorId: begin.payload.connector_id,
    query: {},
    googleClient: client,
    env: driveEnv,
    authorizedOverride: true,
  });
  assert.equal(files.payload.files[0].importable, true);
  assert.equal(Object.hasOwn(files.payload.files[0], 'body'), false);

  const imported = await handleImportDocsConnectorFiles({
    dataDir,
    vaultPath,
    vaultId: 'vault-d',
    connectorId: begin.payload.connector_id,
    body: { file_ids: ['drive_file_e2e'] },
    googleClient: client,
    env: driveEnv,
    authorizedOverride: true,
    createProposalFn: createProposal,
  });
  assert.equal(imported.payload.proposed, 1);
  assert.equal(imported.payload.proposal_ids.length, 1);

  const proposal = getProposal(dataDir, imported.payload.proposal_ids[0]);
  assert.equal(proposal.review_queue, 'docs-sync');
  assert.equal(proposal.source, 'import');
  assert.equal(proposal.frontmatter.source, 'google-drive');
  assert.equal(proposal.frontmatter.source_id, 'drive_file_e2e');

  // Human approve/apply via existing proposal path — live import never writeNote'd.
  writeNote(vaultPath, proposal.path, {
    body: proposal.body,
    frontmatter: proposal.frontmatter,
  });
  updateProposalStatus(dataDir, proposal.proposal_id, 'approved', {});
  const note = readVaultNote(vaultPath, proposal.path);
  assert.equal(note.frontmatter.source, 'google-drive');
  assert.match(note.body, /Brief body/);

  const revoked = await handleRevokeDocsConnector({
    dataDir,
    vaultId: 'vault-d',
    connectorId: begin.payload.connector_id,
    googleClient: client,
    env: driveEnv,
    authorizedOverride: true,
  });
  assert.equal(revoked.payload.revoked, true);
  assert.equal(fs.existsSync(path.join(vaultPath, proposal.path)), true);
});
