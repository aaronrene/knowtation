/**
 * Self-hosted MCP tests for get_metadata_facets.
 *
 * Phase 1C mirrors the approved CLI MetadataFacets v0 contract over MCP only.
 * It must not introduce hosted behavior, persistence, search, memory, indexing,
 * label text, OCR, PageIndex, media metadata, or note body output.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
process.env.KNOWTATION_VAULT_PATH = fixtureVault;

const { createKnowtationMcpServer } = await import('../mcp/create-server.mjs');

async function connectPair() {
  process.env.KNOWTATION_VAULT_PATH = fixtureVault;
  const mcpServer = createKnowtationMcpServer();
  const client = new Client({ name: 'metadata-facets-local', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function parseToolResult(result) {
  const text = result.content?.[0]?.text;
  assert.equal(typeof text, 'string');
  return JSON.parse(text);
}

describe('MCP get_metadata_facets', () => {
  it('returns the MetadataFacets v0 JSON contract without body or frontmatter', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_metadata_facets',
        arguments: { path: 'inbox/one.md' },
      });
      const data = parseToolResult(result);
      const serialized = JSON.stringify(data);

      assert.equal(result.isError, undefined);
      assert.deepEqual(data, {
        schema: 'knowtation.metadata_facets/v0',
        path: 'inbox/one.md',
        facets: {
          project: 'foo',
          tags: ['a', 'b'],
          date: '2025-03-01T00:00:00.000Z',
          updated: null,
          causal_chain_id: null,
          entity: [],
          episode_id: null,
        },
        inferred: {
          folder: 'inbox',
          source_type: null,
        },
        truncated: false,
      });
      assert.equal(Object.hasOwn(data, 'body'), false);
      assert.equal(Object.hasOwn(data, 'frontmatter'), false);
      assert.equal(Object.hasOwn(data, 'snippet'), false);
      assert.equal(Object.hasOwn(data, 'summary'), false);
      assert.equal(Object.hasOwn(data, 'labels'), false);
      assert.equal(Object.hasOwn(data, 'metadata_facets'), false);
      assert.equal(serialized.includes('Body of inbox one'), false);
      assert.equal(serialized.includes('/Users/'), false);
    } finally {
      await client.close();
    }
  });

  it('does not expose a metadata facets MCP resource URI', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_metadata_facets',
        arguments: { path: 'inbox/one.md' },
      });
      const serialized = JSON.stringify(parseToolResult(result));

      assert.equal(serialized.includes('knowtation://metadata-facets'), false);
      assert.equal(serialized.includes('knowtation://facets'), false);
    } finally {
      await client.close();
    }
  });

  it('returns an MCP JSON error for missing notes', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_metadata_facets',
        arguments: { path: 'inbox/missing.md' },
      });
      const data = parseToolResult(result);

      assert.equal(result.isError, true);
      assert.equal(data.code, 'RUNTIME_ERROR');
      assert.match(data.error, /Note not found/);
    } finally {
      await client.close();
    }
  });

  it('returns an MCP JSON error for traversal paths', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_metadata_facets',
        arguments: { path: '../../../etc/passwd' },
      });
      const data = parseToolResult(result);

      assert.equal(result.isError, true);
      assert.equal(data.code, 'RUNTIME_ERROR');
      assert.match(data.error, /Invalid path|escape/);
    } finally {
      await client.close();
    }
  });
});
