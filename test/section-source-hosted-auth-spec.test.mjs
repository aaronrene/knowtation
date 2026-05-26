/**
 * SectionSource hosted authorization review spec tests.
 *
 * Phase 1H accepts hosted authorization review only. It must not register
 * hosted get_section_source, add hosted ACLs, add Hub routes, add Scooling
 * runtime behavior, return section bodies, snippets, summaries, PageIndex, OCR,
 * LLM calls, or provider routing.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const specPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function makeCtx(overrides = {}) {
  return {
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-section-source',
    role: 'viewer',
    token: 'tok-section-source',
    canisterUrl: 'http://canister.test:4322',
    bridgeUrl: 'http://bridge.test:4321',
    canisterAuthSecret: 'gw-secret-section-source',
    ...overrides,
  };
}

function installFetchMock(handler) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = origFetch;
    },
  };
}

async function connectPair(ctx = makeCtx()) {
  const mcpServer = createHostedMcpServer(ctx);
  const client = new Client({ name: 'hosted-section-source-auth-review', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function hostedRuntimeSource() {
  return [
    readRepoFile('hub/gateway/mcp-hosted-server.mjs'),
    readRepoFile('hub/gateway/mcp-tool-acl.mjs'),
    readRepoFile('hub/gateway/server.mjs'),
  ].join('\n');
}

describe('SectionSource hosted authorization review spec', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('unit: spec covers required hosted authorization decision areas', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const requiredSections = [
      '## Review Decision',
      '## Future Hosted Tool Shape',
      '## Hosted Authorization Requirements',
      '## Accepted Future Output',
      '## Explicitly Excluded Output',
      '## Logging And Error Boundary',
      '## Deletion, Export, And Staleness',
      '## Prompt-Injection Handling',
      '## Scooling Boundary',
      '## Seven-Tier Test Requirements',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];

    for (const section of requiredSections) {
      assert.equal(spec.includes(section), true, `${section} is documented`);
    }
    assert.match(spec, /Phase 1H accepts the hosted authorization review only/);
    assert.match(spec, /active hosted vault id/);
    assert.match(spec, /effective canister user id/);
  });

  it('integration: later hosted runtime exposes get_section_source through ACL only', () => {
    const acl = readRepoFile('hub/gateway/mcp-tool-acl.mjs');
    const hosted = readRepoFile('hub/gateway/mcp-hosted-server.mjs');

    assert.match(readRepoFile('docs/SECTION-SOURCE-V0-SPEC.md'), /### Phase 1L: Hosted MCP Implementation/);
    assert.equal(acl.includes('get_section_source'), true);
    assert.equal(hosted.includes('get_section_source'), true);
    assert.equal(hosted.includes('buildSectionSource'), true);
    assert.equal(hosted.includes('readSectionSource'), false);
  });

  it('end-to-end: hosted MCP roles can list get_section_source after the later runtime phase', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    }));

    for (const role of ['viewer', 'editor', 'evaluator', 'admin']) {
      ({ client } = await connectPair(makeCtx({ role })));
      const { tools } = await client.listTools();
      assert.equal(tools.some((tool) => tool.name === 'get_section_source'), true, `${role} can list get_section_source`);
      await client.close();
      client = undefined;
    }
    assert.equal(mock.calls.length, 0);
  });

  it('stress: hosted authorization review checks remain bounded to contract files', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'docs/SECTION-SOURCE-MCP-IMPLEMENTATION-SPEC.md',
      'hub/gateway/mcp-hosted-server.mjs',
      'hub/gateway/mcp-tool-acl.mjs',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 5);
    assert.ok(elapsedMs < 200, `expected bounded hosted review check under 200ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: hosted review adds no writes, sidecars, indexes, vectors, or summaries', () => {
    const implementation = [
      readRepoFile('lib/section-source.mjs'),
      readRepoFile('lib/section-source-note.mjs'),
    ].join('\n');
    const runtime = hostedRuntimeSource();

    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('get_section_source'), false);
    assert.equal(runtime.includes('get_section_source'), true);
    assert.equal(runtime.includes('buildSectionSource'), true);
    assert.equal(runtime.includes('readSectionSource'), false);
    assert.doesNotMatch(implementation, /\bwriteFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bappendFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bsidecar[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bvector[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bsummary[A-Za-z0-9_]*\s*=/);
  });

  it('performance: spec requires one-note reads and no external providers', () => {
    const spec = fs.readFileSync(specPath, 'utf8');

    assert.match(spec, /The future hosted tool must read one note only/);
    assert.match(spec, /The future hosted tool must not scan the whole vault/);
    assert.match(spec, /The future hosted tool must not call external providers/);
  });

  it('security: review blocks hosted runtime, body, snippet, search, persistence, and Scooling exposure', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const runtime = hostedRuntimeSource();
    const blockedPhrases = [
      'Hosted runtime exposure remains blocked in this phase.',
      'No note body text appears in hosted SectionSource output.',
      'No section body text appears in hosted SectionSource output.',
      'No snippets appear in hosted SectionSource output.',
      'No full frontmatter appears in hosted SectionSource output.',
      'No absolute filesystem paths appear in hosted SectionSource output.',
      'Hosted, Scooling, classroom, search, persistence, and provider exposure remain blocked.',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('get_section_source'), false);
    assert.equal(runtime.includes('readSectionSource'), false);
  });
});
