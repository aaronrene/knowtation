import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { proposeDocsImports } from '../lib/docs/docs-import-propose.mjs';
import { connectorForClient } from '../lib/docs/docs-connector-store.mjs';

test('performance: list projection and maximum import proposal batch stay bounded', () => {
  const connector = {
    connector_id: 'conn_0123456789abcdef',
    provider: 'google-drive',
    display_name: 'Drive',
    status: 'connected',
    last_sync_at: null,
    last_sync_error: 'none',
    file_count: 50,
    revoked_at: null,
  };
  const start = performance.now();
  for (let i = 0; i < 10_000; i++) connectorForClient(connector);
  const items = Array.from({ length: 20 }, (_, i) => ({
    source_id: `drive_${i}`,
    name: `Document ${i}`,
    markdown: `# Document ${i}`,
    size: 32,
  }));
  const output = proposeDocsImports({
    dataDir: '/unused',
    vaultPath: '/unused',
    vaultId: 'vault-p',
    connectorId: connector.connector_id,
    provider: 'google-drive',
    items,
    createProposalFn: (_dir, input) => ({
      ...input,
      proposal_id: `proposal-${input.frontmatter.source_id}`,
      status: 'proposed',
    }),
    loadProposalsFn: () => [],
    listMarkdownFilesFn: () => [],
  });
  const elapsed = performance.now() - start;
  assert.equal(output.proposed, 20);
  assert.ok(elapsed < 2_000, `local operation exceeded 2s budget: ${elapsed}ms`);
});
