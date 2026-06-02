/**
 * Self-hosted MCP tests for get_note_outline.
 *
 * Phase 1C mirrors the CLI NoteOutline contract over MCP only. It must not
 * introduce hosted behavior, persistence, search, memory, or note body output.
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
  const client = new Client({ name: 'note-outline-local', version: '0.0.1' });
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

describe('MCP get_note_outline', () => {
  it('returns the NoteOutline JSON contract without body or frontmatter', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_note_outline',
        arguments: { path: 'inbox/one.md' },
      });
      const data = parseToolResult(result);

      assert.equal(result.isError, undefined);
      assert.equal(data.schema, 'knowtation.note_outline/v1');
      assert.equal(data.path, 'inbox/one.md');
      assert.equal(data.title, 'one');
      assert.deepEqual(data.headings, [
        { level: 1, text: 'Inbox one', id: 'h1-inbox-one-0001' },
      ]);
      assert.equal(data.truncated, false);
      assert.equal(Object.hasOwn(data, 'body'), false);
      assert.equal(Object.hasOwn(data, 'frontmatter'), false);
      assert.equal(Object.hasOwn(data, 'snippet'), false);
      assert.equal(JSON.stringify(data).includes('Body of inbox one'), false);
      assert.equal(JSON.stringify(data).includes('/Users/'), false);
    } finally {
      await client.close();
    }
  });

  it('returns an MCP JSON error for missing notes', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_note_outline',
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
        name: 'get_note_outline',
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
