/**
 * Self-hosted MCP tests for get_section_source.
 *
 * Phase 1G mirrors the approved CLI SectionSource v0 contract over self-hosted
 * MCP only. It must not introduce hosted behavior, MCP resources, persistence,
 * search, vectors, summaries, PageIndex, OCR, LLM calls, provider routing,
 * snippets, or note body output.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { readSectionSource } from '../lib/section-source-note.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
process.env.KNOWTATION_VAULT_PATH = fixtureVault;

const { createKnowtationMcpServer } = await import('../mcp/create-server.mjs');

async function connectPair() {
  process.env.KNOWTATION_VAULT_PATH = fixtureVault;
  const mcpServer = createKnowtationMcpServer();
  const client = new Client({ name: 'section-source-local', version: '0.0.1' });
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

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sectionSourceToolSource() {
  const source = readRepoFile('mcp/create-server.mjs');
  const start = source.indexOf("server.registerTool(\n    'get_section_source'");
  const end = source.indexOf("server.registerTool(\n    'list_notes'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

describe('MCP get_section_source', () => {
  it('unit: returns only the SectionSource v0 body-free allowlist', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_section_source',
        arguments: { path: 'inbox/one.md' },
      });
      const data = parseToolResult(result);

      assert.equal(result.isError, undefined);
      assert.deepEqual(Object.keys(data), ['schema', 'path', 'title', 'sections', 'truncated']);
      assert.deepEqual(Object.keys(data.sections[0]), [
        'section_id',
        'heading_id',
        'level',
        'heading_path',
        'heading_text',
        'child_section_ids',
        'body_available',
        'body_returned',
        'snippet_returned',
      ]);
      assert.equal(data.schema, 'knowtation.section_source/v0');
      assert.equal(data.sections[0].body_returned, false);
      assert.equal(data.sections[0].snippet_returned, false);
    } finally {
      await client.close();
    }
  });

  it('integration: matches readSectionSource for the same authorized note', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_section_source',
        arguments: { path: 'inbox/one.md' },
      });
      const data = parseToolResult(result);

      assert.deepEqual(data, readSectionSource(fixtureVault, 'inbox/one.md'));
    } finally {
      await client.close();
    }
  });

  it('end-to-end: returns section candidates without body, snippets, resources, or absolute paths', async () => {
    const { client } = await connectPair();
    try {
      const result = await client.callTool({
        name: 'get_section_source',
        arguments: { path: 'inbox/one.md' },
      });
      const data = parseToolResult(result);
      const serialized = JSON.stringify(data);

      assert.equal(data.path, 'inbox/one.md');
      assert.equal(data.title, 'one');
      assert.deepEqual(data.sections, [
        {
          section_id: 'inbox-one-md:h1-inbox-one-0001',
          heading_id: 'h1-inbox-one-0001',
          level: 1,
          heading_path: ['Inbox one'],
          heading_text: 'Inbox one',
          child_section_ids: [],
          body_available: true,
          body_returned: false,
          snippet_returned: false,
        },
      ]);
      assert.equal(Object.hasOwn(data, 'body'), false);
      assert.equal(Object.hasOwn(data, 'frontmatter'), false);
      assert.equal(Object.hasOwn(data, 'snippet'), false);
      assert.equal(Object.hasOwn(data, 'summary'), false);
      assert.equal(serialized.includes('Body of inbox one'), false);
      assert.equal(serialized.includes('2025-03-01'), false);
      assert.equal(serialized.includes('/Users/'), false);
      assert.equal(serialized.includes('knowtation://'), false);
    } finally {
      await client.close();
    }
  });

  it('stress: repeated MCP calls are deterministic and bounded', async () => {
    const { client } = await connectPair();
    try {
      const started = Date.now();
      const outputs = [];
      for (let index = 0; index < 10; index += 1) {
        const result = await client.callTool({
          name: 'get_section_source',
          arguments: { path: 'projects/foo/note.md' },
        });
        outputs.push(parseToolResult(result));
      }
      const elapsedMs = Date.now() - started;

      for (const output of outputs) {
        assert.deepEqual(output, outputs[0]);
        assert.equal(output.sections.length, 1);
      }
      assert.ok(elapsedMs < 1000, `expected repeated MCP calls under 1000ms, got ${elapsedMs}ms`);
    } finally {
      await client.close();
    }
  });

  it('data-integrity: MCP tool does not write notes, sidecars, indexes, vectors, or summaries', () => {
    const implementation = [sectionSourceToolSource(), readRepoFile('lib/section-source-note.mjs')].join('\n');

    assert.doesNotMatch(implementation, /\bwriteFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bappendFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bmkdir(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bstoreMemory\s*\(/);
    assert.doesNotMatch(implementation, /\brunIndex\s*\(/);
    assert.doesNotMatch(implementation, /\bsidecar[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bvector[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bsummary[A-Za-z0-9_]*\s*=/);
  });

  it('performance: MCP tool stays one-note and provider-free', () => {
    const toolSource = sectionSourceToolSource();

    assert.match(toolSource, /readSectionSource\(config\.vault_path, args\.path\)/);
    assert.doesNotMatch(toolSource, /\brunSearch\s*\(/);
    assert.doesNotMatch(toolSource, /\brunKeywordSearch\s*\(/);
    assert.doesNotMatch(toolSource, /\brunListNotes\s*\(/);
    assert.doesNotMatch(toolSource, /\bfetch\s*\(/);
    assert.doesNotMatch(toolSource, /\brerankWithSampling\s*\(/);
  });

  it('security: missing and traversal paths return MCP JSON errors without body data', async () => {
    const { client } = await connectPair();
    try {
      for (const [requestedPath, errorPattern] of [
        ['inbox/missing.md', /Note not found/],
        ['../../../etc/passwd', /Invalid path|escape/],
      ]) {
        const result = await client.callTool({
          name: 'get_section_source',
          arguments: { path: requestedPath },
        });
        const data = parseToolResult(result);
        const serialized = JSON.stringify(data);

        assert.equal(result.isError, true);
        assert.equal(data.code, 'RUNTIME_ERROR');
        assert.match(data.error, errorPattern);
        assert.equal(serialized.includes('Body of inbox one'), false);
        assert.equal(serialized.includes('knowtation://'), false);
        assert.equal(serialized.includes('/Users/'), false);
      }
    } finally {
      await client.close();
    }
  });
});
