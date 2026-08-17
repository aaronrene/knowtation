import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  connectorForClient,
  getConnector,
  saveConnector,
} from '../lib/docs/docs-connector-store.mjs';
import { proposeDocsImports } from '../lib/docs/docs-import-propose.mjs';
import { noteStateIdFromParts } from '../lib/note-state-id.mjs';

test('data-integrity: cursor and custody fields never enter client projection', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-docs-data-'));
  const connector = {
    connector_id: 'conn_0123456789abcdef',
    provider: 'google-drive',
    display_name: 'Drive',
    status: 'connected',
    account_sub: 'private-sub',
    oauth_ref: 'secret-ref',
    sync_cursor: 'opaque-cursor',
    last_sync_at: null,
    last_sync_error: 'none',
    file_count: 3,
    revoked_at: null,
    oauth_pending: { state: 'secret-state' },
  };
  saveConnector(dataDir, 'vault-d', connector);
  assert.equal(getConnector(dataDir, 'vault-d', connector.connector_id).sync_cursor, 'opaque-cursor');
  const client = connectorForClient(connector);
  for (const hidden of ['account_sub', 'oauth_ref', 'sync_cursor', 'oauth_pending']) {
    assert.equal(Object.hasOwn(client, hidden), false);
  }
});

test('data-integrity: existing source identity produces an edit proposal state id', () => {
  const note = {
    path: 'archive/existing.md',
    frontmatter: { source: 'google-drive', source_id: 'drive_1', title: 'Old' },
    body: 'Old body',
  };
  const calls = [];
  const output = proposeDocsImports({
    dataDir: '/unused',
    vaultPath: '/vault',
    vaultId: 'vault-d',
    connectorId: 'conn_0123456789abcdef',
    provider: 'google-drive',
    items: [{ source_id: 'drive_1', name: 'New', markdown: 'New body', size: 8 }],
    createProposalFn: (_dataDir, input) => {
      calls.push(input);
      return { ...input, proposal_id: 'edit-proposal', status: 'proposed' };
    },
    loadProposalsFn: () => [],
    listMarkdownFilesFn: () => [note.path],
    readNoteFn: () => note,
  });
  assert.equal(output.proposed, 1);
  assert.equal(calls[0].path, note.path);
  assert.equal(calls[0].base_state_id, noteStateIdFromParts(note.frontmatter, note.body));
});
