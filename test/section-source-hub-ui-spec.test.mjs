/**
 * SectionSource Hub UI implementation spec tests.
 *
 * Phase 1O accepted Hub UI planning only. The later runtime phase may add the
 * intended Hub UI surface while still blocking canister routes, search,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const specPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-HUB-UI-SPEC.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function makeCtx(overrides = {}) {
  return {
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-section-source-ui-spec',
    role: 'viewer',
    token: 'tok-section-source-ui-spec',
    canisterUrl: 'http://canister.test:4322',
    bridgeUrl: 'http://bridge.test:4321',
    canisterAuthSecret: 'gw-secret-section-source-ui-spec',
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
  const client = new Client({ name: 'section-source-hub-ui-spec', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function hubUiSource() {
  return [
    readRepoFile('web/hub/index.html'),
    readRepoFile('web/hub/hub.js'),
    readRepoFile('web/hub/hub.css'),
    readRepoFile('web/hub/onboarding-wizard.mjs'),
    readRepoFile('web/hub/consolidation-ui-logic.mjs'),
    readRepoFile('web/hub/hub-list-sort.mjs'),
  ].join('\n');
}

describe('SectionSource Hub UI implementation spec', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('unit: spec covers required Hub UI decision areas', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const requiredSections = [
      '## Planning Decision',
      '## Future UI Entry Point',
      '## UI Auth And Session Expectations',
      '## Active Vault Boundary',
      '## API Call Shape',
      '## Rendering Allowlist',
      '## Explicitly Excluded UI Display',
      '## Loading, Empty, And Error States',
      '## Prompt-Injection Handling',
      '## Logging And Telemetry Exclusions',
      '## Deletion, Export, And Staleness',
      '## Accessibility Expectations',
      '## No Write-Back Behavior',
      '## Scooling Consumption Boundary',
      '## Seven-Tier Test Requirements',
      '## Contract Guards',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];
    const requiredPhrases = [
      'Phase 1O accepts the Hub UI implementation specification only.',
      'GET /api/v1/section-source?path=<encodeURIComponent(path)>',
      'Heading text and heading paths must be rendered as escaped text.',
      'Loading: show generic progress without note body previews.',
      'Prompt-like headings that ask a model, browser, extension, or user to reveal secrets',
      'The future UI must not log or send telemetry containing:',
      'Section hierarchy must be navigable by keyboard.',
      'SectionSource UI consumption must not grant write permissions.',
      'Scooling remains a downstream consumer behind its adapter boundary.',
    ];

    for (const section of requiredSections) {
      assert.equal(spec.includes(section), true, `${section} is documented`);
    }
    for (const phrase of requiredPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
  });

  it('integration: Hub UI runtime is present while REST and OpenAPI stay available', () => {
    const ui = hubUiSource();
    const gateway = readRepoFile('hub/gateway/server.mjs');
    const openapi = readRepoFile('docs/openapi.yaml');

    assert.equal(ui.includes('/api/v1/section-source'), true);
    assert.equal(ui.includes('section-source'), true);
    assert.equal(ui.includes('SectionSource'), true);
    assert.equal(ui.includes('section_source/v0'), true);
    assert.equal(gateway.includes('/api/v1/section-source'), true);
    assert.equal(openapi.includes('/section-source'), true);
    assert.equal(openapi.includes('SectionSource'), true);
  });

  it('end-to-end: hosted MCP get_section_source remains available while Hub UI is present', async () => {
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
    assert.equal(hubUiSource().includes('/api/v1/section-source'), true);
  });

  it('stress: planning checks stay bounded to UI, REST, OpenAPI, and contract files', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-HUB-UI-SPEC.md',
      'docs/SECTION-SOURCE-HUB-REST-OPENAPI-SPEC.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'docs/openapi.yaml',
      'hub/gateway/server.mjs',
      'web/hub/index.html',
      'web/hub/hub.js',
      'web/hub/hub.css',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 8);
    assert.ok(elapsedMs < 300, `expected bounded Hub UI spec check under 300ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: runtime adds no UI state stores, writes, sidecars, indexes, vectors, or summaries', () => {
    const ui = hubUiSource();
    const js = readRepoFile('web/hub/hub.js');
    const start = js.indexOf('const SECTION_SOURCE_SCHEMA');
    const end = js.indexOf('function switchNoteToReadMode', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const runtime = js.slice(start, end);

    assert.equal(ui.includes('/api/v1/section-source'), true);
    assert.doesNotMatch(runtime, /\b(localStorage|sessionStorage|write|post|put|delete|index|vector|summary|memory|sidecar)\b/i);
  });

  it('performance: spec requires one-note UI calls and no scans or providers', () => {
    const spec = fs.readFileSync(specPath, 'utf8');

    assert.match(spec, /Future UI calls must request one note only/);
    assert.match(spec, /Future UI calls must not scan the whole vault/);
    assert.match(spec, /Future UI calls must not call bridge search/);
    assert.match(spec, /Future UI calls must not call external providers/);
    assert.match(spec, /Rendering size must remain bounded by accepted SectionSource caps/);
  });

  it('security: runtime blocks body, snippet, provider, resource, Scooling, and write-back exposure', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const ui = hubUiSource();
    const blockedPhrases = [
      'Hub UI exposure remains blocked in this phase.',
      'No note body text appears in future SectionSource UI output.',
      'No section body text appears in future SectionSource UI output.',
      'No snippets appear in future SectionSource UI output.',
      'No full frontmatter appears in future SectionSource UI output.',
      'No absolute filesystem paths appear in future SectionSource UI output or errors.',
      'No raw canister payload appears in future SectionSource UI output or errors.',
      'No provider payload appears in future SectionSource UI output or errors.',
      'No MCP resource URI appears for SectionSource UI content.',
      'Search, persistence, Scooling, PageIndex, OCR, LLM, provider, and write-back exposure',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
    assert.equal(ui.includes('/api/v1/section-source'), true);
    assert.equal(ui.includes('SectionSource'), true);
    assert.equal(ui.includes('data-section-source-panel'), true);
  });
});
