/**
 * SectionSource hosted implementation spec tests.
 *
 * Phase 1K accepts the hosted implementation specification only. It must not
 * register hosted get_section_source, add hosted ACLs, add Hub routes, add
 * search, persistence, Scooling runtime behavior, section bodies, snippets,
 * provider routing, resource URIs, PageIndex, OCR, or LLM calls.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createHostedMcpServer } from '../hub/gateway/mcp-hosted-server.mjs';
import { allowedToolsForRole, isToolAllowed } from '../hub/gateway/mcp-tool-acl.mjs';
import { readSectionSource } from '../lib/section-source-note.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
const specPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-HOSTED-IMPLEMENTATION-SPEC.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function makeCtx(overrides = {}) {
  return {
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-section-source-hosted-spec',
    role: 'viewer',
    token: 'tok-section-source-hosted-spec',
    canisterUrl: 'http://canister.test:4322',
    bridgeUrl: 'http://bridge.test:4321',
    canisterAuthSecret: 'gw-secret-section-source-hosted-spec',
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
  const client = new Client({ name: 'hosted-section-source-implementation-spec', version: '0.0.1' });
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

function assertHostedSectionSourcePresentAndScoped(source) {
  assert.equal(source.includes('get_section_source'), true);
  assert.equal(source.includes('buildSectionSource'), true);
  assert.equal(source.includes('readSectionSource'), false);
}

describe('SectionSource hosted implementation spec', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('unit: spec covers the required hosted implementation decision areas', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const requiredSections = [
      '## Planning Decision',
      '## Future Hosted Tool',
      '## Input Schema',
      '## Hosted Role ACL Requirements',
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
      '## Scooling Consumption Boundary',
      '## Seven-Tier Test Requirements',
      '## Contract Guards',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];
    const requiredPhrases = [
      'Phase 1K accepts the hosted implementation specification only.',
      "isToolAllowed('get_section_source', role)",
      'ctx.vaultId',
      'ctx.canisterUserId || ctx.userId',
      'GET {canisterUrl}/api/v1/notes/{encodeURIComponent(normalizedPath)}',
      'Unsafe path errors must not echo the raw unsafe path.',
      '"schema": "knowtation.section_source/v0"',
      'Missing notes return a generic upstream status class such as `Upstream 404`.',
      'Unauthorized notes return a generic upstream status class such as `Upstream 401` or',
      'The future hosted tool must read one note only.',
      'Scooling remains a downstream consumer behind its adapter boundary.',
    ];

    for (const section of requiredSections) {
      assert.equal(spec.includes(section), true, `${section} is documented`);
    }
    for (const phrase of requiredPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
    assert.match(readRepoFile('docs/SECTION-SOURCE-V0-SPEC.md'), /### Phase 1K: Hosted Implementation Spec/);
  });

  it('integration: hosted ACL and runtime expose get_section_source after the runtime phase', () => {
    const runtime = hostedRuntimeSource();

    for (const role of ['viewer', 'editor', 'evaluator', 'admin']) {
      assert.equal(isToolAllowed('get_section_source', role), true, `${role} ACL allows get_section_source`);
      assert.equal(allowedToolsForRole(role).has('get_section_source'), true, `${role} ACL includes get_section_source`);
    }
    assertHostedSectionSourcePresentAndScoped(runtime);
    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('get_section_source'), false);
  });

  it('end-to-end: hosted MCP can list and call get_section_source after the runtime phase', async () => {
    mock = installFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        path: '/Users/owner/private/ignored.md',
        frontmatter: '{"title":"Hosted Runtime"}',
        body: '# A\n\nPrivate body must not leak.',
      }),
      text: async () => '{}',
    }));

    for (const role of ['viewer', 'editor', 'evaluator', 'admin']) {
      ({ client } = await connectPair(makeCtx({ role })));
      const { tools } = await client.listTools();

      assert.equal(tools.some((tool) => tool.name === 'get_section_source'), true, `${role} can list get_section_source`);
      const result = await client.callTool({ name: 'get_section_source', arguments: { path: 'inbox/one.md' } });
      const data = JSON.parse(result.content[0].text);
      assert.equal(result.isError, undefined, `${role} can call get_section_source`);
      assert.equal(data.schema, 'knowtation.section_source/v0');
      assert.equal(JSON.stringify(data).includes('Private body must not leak'), false);
      await client.close();
      client = undefined;
    }
    assert.equal(mock.calls.length, 4);
  });

  it('stress: hosted implementation spec checks remain bounded to contract files', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-HOSTED-IMPLEMENTATION-SPEC.md',
      'docs/SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md',
      'docs/SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'hub/gateway/mcp-hosted-server.mjs',
      'hub/gateway/mcp-tool-acl.mjs',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 6);
    assert.ok(elapsedMs < 250, `expected bounded hosted implementation spec check under 250ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: no Hub, search, persistence, Scooling, provider, or resource surface is added', () => {
    const source = readSectionSource(fixtureVault, 'inbox/one.md');
    const serialized = JSON.stringify(source);
    const runtime = hostedRuntimeSource();

    assert.equal(source.schema, 'knowtation.section_source/v0');
    assert.equal(source.sections.every((section) => section.body_returned === false), true);
    assert.equal(source.sections.every((section) => section.snippet_returned === false), true);
    assert.equal(Object.hasOwn(source, 'body'), false);
    assert.equal(Object.hasOwn(source, 'frontmatter'), false);
    assert.equal(Object.hasOwn(source, 'snippet'), false);
    assert.equal(serialized.includes('Body of inbox one'), false);
    assertHostedSectionSourcePresentAndScoped(runtime);
    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('get_section_source'), false);
    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('section_source/v0'), false);
  });

  it('performance: spec requires one-note reads and no scans or providers', () => {
    const spec = fs.readFileSync(specPath, 'utf8');

    assert.match(spec, /The future hosted tool must read one note only/);
    assert.match(spec, /The future hosted tool must not scan the whole vault/);
    assert.match(spec, /The future hosted tool must not call bridge search/);
    assert.match(spec, /The future hosted tool must not call external providers/);
    assert.match(spec, /Output size must remain bounded by accepted SectionSource caps/);
  });

  it('security: planning blocks hosted ACL, runtime, body, snippet, provider, and resource exposure', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const runtime = hostedRuntimeSource();
    const blockedPhrases = [
      'Hosted runtime exposure remains blocked in this phase.',
      'Hosted ACL exposure remains blocked in this phase.',
      'No note body text appears in hosted SectionSource output.',
      'No section body text appears in hosted SectionSource output.',
      'No snippets appear in hosted SectionSource output.',
      'No full frontmatter appears in hosted SectionSource output.',
      'No absolute filesystem paths appear in hosted SectionSource output or errors.',
      'No raw canister payload appears in hosted SectionSource output or errors.',
      'No provider payload appears in hosted SectionSource output or errors.',
      'No MCP resource URI appears for hosted SectionSource content.',
      'Hub, search, persistence, Scooling, PageIndex, OCR, LLM, and provider exposure remain',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
    assertHostedSectionSourcePresentAndScoped(runtime);
    assert.equal(readRepoFile('hub/gateway/server.mjs').includes('get_section_source'), false);
  });
});
