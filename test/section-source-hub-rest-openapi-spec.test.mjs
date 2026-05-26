/**
 * SectionSource Hub REST/OpenAPI implementation spec tests.
 *
 * Phase 1M accepts Hub REST/OpenAPI planning only. It must not add Hub REST
 * routes, OpenAPI paths or schemas, Hub UI, canister routes, search,
 * persistence, Scooling runtime behavior, section bodies, snippets, providers,
 * resource URIs, PageIndex, OCR, or LLM calls.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';
import { readSectionSource } from '../lib/section-source-note.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
const specPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-HUB-REST-OPENAPI-SPEC.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function makeCtx(overrides = {}) {
  return {
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-section-source-rest-spec',
    role: 'viewer',
    token: 'tok-section-source-rest-spec',
    canisterUrl: 'http://canister.test:4322',
    bridgeUrl: 'http://bridge.test:4321',
    canisterAuthSecret: 'gw-secret-section-source-rest-spec',
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
  const client = new Client({ name: 'section-source-rest-openapi-spec', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function hubRuntimeSource() {
  return [
    readRepoFile('hub/gateway/server.mjs'),
    readRepoFile('hub/icp/src/hub/main.mo'),
  ].join('\n');
}

function openApiSource() {
  return [
    readRepoFile('docs/HUB-API.md'),
    readRepoFile('docs/openapi.yaml'),
  ].join('\n');
}

describe('SectionSource Hub REST/OpenAPI implementation spec', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('unit: spec covers required Hub REST/OpenAPI decision areas', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const requiredSections = [
      '## Planning Decision',
      '## Future REST Endpoint',
      '## REST Auth Requirements',
      '## Active Vault Boundary',
      '## Effective Canister User Boundary',
      '## Canister Auth And Header Behavior',
      '## One-Note Read Behavior',
      '## Path Normalization And Unsafe Path Rejection',
      '## Output Allowlist',
      '## Explicitly Excluded Output',
      '## Error Sanitization',
      '## Logging Exclusions',
      '## Deletion, Export, And Staleness',
      '## Prompt-Injection Handling',
      '## Hosted MCP Parity Boundary',
      '## Scooling Consumption Boundary',
      '## Seven-Tier Test Requirements',
      '## Contract Guards',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];
    const requiredPhrases = [
      'Phase 1M accepts the Hub REST/OpenAPI implementation specification only.',
      'GET /api/v1/section-source?path=<vault-relative-note-path>',
      'Authorization: Bearer <access_token>',
      'X-Vault-Id: <active vault id>',
      'X-User-Id: <effective canister user id>',
      'GET {canisterUrl}/api/v1/notes/{encodeURIComponent(normalizedPath)}',
      '"schema": "knowtation.section_source/v0"',
      'Hosted MCP `get_section_source` remains available in this planning phase.',
      'Scooling remains a downstream consumer behind its adapter boundary.',
    ];

    for (const section of requiredSections) {
      assert.equal(spec.includes(section), true, `${section} is documented`);
    }
    for (const phrase of requiredPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
  });

  it('integration: Hub REST route and OpenAPI SectionSource surface are registered without canister routes', () => {
    const gateway = readRepoFile('hub/gateway/server.mjs');
    const canister = readRepoFile('hub/icp/src/hub/main.mo');
    const api = openApiSource();

    assert.equal(gateway.includes('/api/v1/section-source'), true);
    assert.equal(gateway.includes('buildSectionSource'), true);
    assert.equal(canister.includes('/api/v1/section-source'), false);
    assert.equal(canister.includes('section_source/v0'), false);
    assert.equal(api.includes('/section-source'), true);
    assert.equal(api.includes('SectionSource'), true);
    assert.equal(api.includes('knowtation.section_source/v0'), true);
  });

  it('end-to-end: hosted MCP get_section_source remains available after REST registration', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: 'ignored.md',
        frontmatter: '{"title":"Hosted MCP Still Available"}',
        body: '# A\n\nPrivate body must not leak.',
      }),
      text: async () => '{}',
    }));
    ({ client } = await connectPair());

    const { tools } = await client.listTools();
    const result = await client.callTool({
      name: 'get_section_source',
      arguments: { path: 'inbox/one.md' },
    });
    const data = JSON.parse(result.content[0].text);

    assert.equal(tools.some((tool) => tool.name === 'get_section_source'), true);
    assert.equal(result.isError, undefined);
    assert.equal(data.schema, 'knowtation.section_source/v0');
    assert.equal(JSON.stringify(data).includes('Private body must not leak'), false);
    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('/api/v1/section-source'), true);
  });

  it('stress: planning checks stay bounded to contract and route files', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-HUB-REST-OPENAPI-SPEC.md',
      'docs/SECTION-SOURCE-HOSTED-IMPLEMENTATION-SPEC.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'docs/HUB-API.md',
      'docs/openapi.yaml',
      'hub/gateway/server.mjs',
      'hub/icp/src/hub/main.mo',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 7);
    assert.ok(elapsedMs < 300, `expected bounded Hub REST/OpenAPI spec check under 300ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: runtime adds no writes, sidecars, indexes, vectors, summaries, or persistence', () => {
    const source = readSectionSource(fixtureVault, 'inbox/one.md');
    const serialized = JSON.stringify(source);
    const runtime = hubRuntimeSource();

    assert.equal(source.schema, 'knowtation.section_source/v0');
    assert.equal(source.sections.every((section) => section.body_returned === false), true);
    assert.equal(source.sections.every((section) => section.snippet_returned === false), true);
    assert.equal(Object.hasOwn(source, 'body'), false);
    assert.equal(Object.hasOwn(source, 'frontmatter'), false);
    assert.equal(Object.hasOwn(source, 'snippet'), false);
    assert.equal(serialized.includes('Body of inbox one'), false);
    assert.doesNotMatch(runtime, /section[-_]source[\s\S]{0,120}\b(write|post|put|delete|index|vector|summary|memory|sidecar)\b/i);
  });

  it('performance: spec requires one-note reads and no scans or providers', () => {
    const spec = fs.readFileSync(specPath, 'utf8');

    assert.match(spec, /The future endpoint must read one note only/);
    assert.match(spec, /The future endpoint must not scan the whole vault/);
    assert.match(spec, /The future endpoint must not call bridge search/);
    assert.match(spec, /The future endpoint must not call external providers/);
    assert.match(spec, /Output size must remain bounded by accepted SectionSource caps/);
  });

  it('security: runtime blocks body, snippet, provider, resource, canister, and Scooling exposure', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const gateway = readRepoFile('hub/gateway/server.mjs');
    const canister = readRepoFile('hub/icp/src/hub/main.mo');
    const api = openApiSource();
    const blockedPhrases = [
      'No note body text appears in future SectionSource REST output.',
      'No section body text appears in future SectionSource REST output.',
      'No snippets appear in future SectionSource REST output.',
      'No full frontmatter appears in future SectionSource REST output.',
      'No absolute filesystem paths appear in future SectionSource REST output or errors.',
      'No raw canister payload appears in future SectionSource REST output or errors.',
      'No provider payload appears in future SectionSource REST output or errors.',
      'No MCP resource URI appears for SectionSource REST content.',
      'Search, persistence, Scooling, PageIndex, OCR, LLM, and provider exposure remain blocked.',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
    assert.equal(gateway.includes('/api/v1/section-source'), true);
    assert.equal(canister.includes('/api/v1/section-source'), false);
    assert.equal(api.includes('/section-source'), true);
    assert.equal(api.includes('SectionSource'), true);
  });
});
