/**
 * Self-hosted MCP tests for get_document_tree.
 *
 * Phase 1D mirrors the CLI DocumentTree contract over self-hosted MCP only.
 * It must not introduce hosted behavior, MCP resources, persistence, search,
 * vectors, summaries, PageIndex, OCR, labels, metadata facets, or note body output.
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
  const client = new Client({ name: 'document-tree-local', version: '0.0.1' });
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

describe('MCP get_document_tree', () => {
  it('returns the DocumentTree v0 JSON contract without body or frontmatter', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_document_tree',
        arguments: { path: 'inbox/one.md' },
      });
      const data = parseToolResult(result);
      const serialized = JSON.stringify(data);

      assert.equal(result.isError, undefined);
      assert.equal(data.schema, 'knowtation.document_tree/v0');
      assert.equal(data.path, 'inbox/one.md');
      assert.equal(data.title, 'one');
      assert.deepEqual(data.root, {
        children: [
          {
            id: 'h1-inbox-one-0001',
            level: 1,
            text: 'Inbox one',
            children: [],
          },
        ],
      });
      assert.equal(data.truncated, false);
      assert.equal(Object.hasOwn(data, 'body'), false);
      assert.equal(Object.hasOwn(data, 'frontmatter'), false);
      assert.equal(Object.hasOwn(data, 'snippet'), false);
      assert.equal(Object.hasOwn(data, 'summary'), false);
      assert.equal(serialized.includes('Body of inbox one'), false);
      assert.equal(serialized.includes('/Users/'), false);
    } finally {
      await client.close();
    }
  });

  it('does not expose a document tree MCP resource URI', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_document_tree',
        arguments: { path: 'inbox/one.md' },
      });
      const serialized = JSON.stringify(parseToolResult(result));

      assert.equal(serialized.includes('knowtation://document-tree'), false);
      assert.equal(serialized.includes('knowtation://tree'), false);
    } finally {
      await client.close();
    }
  });

  it('returns an MCP JSON error for missing notes', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_document_tree',
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
        name: 'get_document_tree',
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
