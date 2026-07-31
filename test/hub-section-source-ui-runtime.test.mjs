/**
 * Hub UI SectionSource runtime tests.
 *
 * Phase 1P exposes a minimal body-free SectionSource UI surface in the note
 * detail drawer. It must call only the accepted REST route, render escaped
 * allowlist fields, and avoid canister, search, persistence, Scooling,
 * provider, resource, body, snippet, and write-back surfaces.
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

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

function hubSectionSourceRuntime() {
  return sourceSlice(
    readRepoFile('web/hub/hub.js'),
    'const SECTION_SOURCE_SCHEMA',
    'function switchNoteToReadMode',
  );
}

function hubUiSource() {
  return [
    readRepoFile('web/hub/index.html'),
    readRepoFile('web/hub/hub.js'),
    readRepoFile('web/hub/hub.css'),
  ].join('\n');
}

function makeCtx(overrides = {}) {
  return {
    userId: 'google:actor',
    canisterUserId: 'google:owner',
    vaultId: 'vault-section-source-ui-runtime',
    role: 'viewer',
    token: 'tok-section-source-ui-runtime',
    canisterUrl: 'http://canister.test:4322',
    bridgeUrl: 'http://bridge.test:4321',
    canisterAuthSecret: 'gw-secret-section-source-ui-runtime',
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
  const client = new Client({ name: 'section-source-hub-ui-runtime', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

describe('Hub UI SectionSource runtime', () => {
  let mock;
  let client;

  afterEach(async () => {
    try {
      await client?.close();
    } catch (_) {}
    mock?.restore?.();
  });

  it('unit: defines the intended detail-drawer SectionSource UI surface', () => {
    const js = readRepoFile('web/hub/hub.js');
    const html = readRepoFile('web/hub/index.html');
    const css = readRepoFile('web/hub/hub.css');

    assert.match(js, /function createSectionSourceButton\(actionsEl\)/);
    assert.match(js, /sectionBtn\.textContent = 'Sections'/);
    assert.match(js, /sectionBtn\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(js, /data-section-source-panel/);
    assert.match(html, /hub\.js\?v=20260729g/);
    assert.match(html, /hub\.css\?v=20260729g/);
    assert.match(css, /\.section-source-panel\b/);
    assert.match(css, /\.section-source-list\b/);
  });

  it('unit: renders readable section rows without inline raw ID dumps', () => {
    const runtime = hubSectionSourceRuntime();
    const renderer = sourceSlice(runtime, 'function renderSectionSourceData', 'async function loadSectionSourceForCurrentNote');
    const visibleRows = sourceSlice(renderer, 'const heading = document.createElement', 'const debugDetails = document.createElement');
    const debugRows = sourceSlice(renderer, 'const debugDetails = document.createElement', 'list.appendChild(item)');

    assert.match(renderer, /levelBadge\.textContent = 'H' \+ section\.level/);
    assert.match(renderer, /detail\.textContent = 'Heading level: H' \+ section\.level/);
    assert.match(renderer, /pathLine\.textContent =\s*'Heading path: '/);
    assert.match(renderer, /childLine\.textContent = 'Child sections: ' \+ section\.child_section_ids\.length/);
    assert.doesNotMatch(visibleRows, /section\.section_id|section\.heading_id|child_section_ids\.join/);
    assert.match(debugRows, /const debugDetails = document\.createElement\('details'\)/);
    assert.match(debugRows, /debugSummary\.textContent = 'IDs'/);
    assert.match(debugRows, /appendSectionSourceDebugRow\(\s*debugList,\s*'Section ID',\s*section\.section_id/s);
    assert.match(debugRows, /appendSectionSourceDebugRow\(\s*debugList,\s*'Heading ID',\s*section\.heading_id/s);
    assert.match(debugRows, /section\.child_section_ids\.join\(', '\)/);
    assert.doesNotMatch(renderer, /body returned|snippet returned/i);
  });

  it('integration: calls only the accepted REST endpoint shape from the Hub UI runtime', () => {
    const runtime = hubSectionSourceRuntime();
    const gateway = readRepoFile('hub/gateway/server.mjs');
    const canister = readRepoFile('hub/icp/src/hub/main.mo');

    assert.match(runtime, /return '\/api\/v1\/section-source\?path=' \+ encodeURIComponent\(path\)/);
    assert.match(runtime, /api\(sectionSourceEndpointForPath\(path\), \{ method: 'GET' \}\)/);
    assert.doesNotMatch(runtime, /body:\s*JSON\.stringify/);
    assert.equal(gateway.includes('/api/v1/section-source'), true);
    assert.equal(canister.includes('section-source'), false);
    assert.equal(canister.includes('SectionSource'), false);
  });

  it('end-to-end: hosted MCP remains available while Hub UI runtime is present', async () => {
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

    const result = await client.callTool({
      name: 'get_section_source',
      arguments: { path: 'inbox/one.md' },
    });
    const data = JSON.parse(result.content[0].text);

    assert.equal(data.schema, 'knowtation.section_source/v0');
    assert.equal(JSON.stringify(data).includes('Private body must not leak'), false);
    assert.equal(hubUiSource().includes('/api/v1/section-source'), true);
  });

  it('stress: runtime checks stay bounded to Hub UI, REST, OpenAPI, and contract files', () => {
    const started = Date.now();
    const files = [
      'web/hub/index.html',
      'web/hub/hub.js',
      'web/hub/hub.css',
      'hub/gateway/server.mjs',
      'docs/openapi.yaml',
      'docs/SECTION-SOURCE-HUB-UI-SPEC.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'test/hub-section-source-ui-runtime.test.mjs',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 8);
    assert.ok(elapsedMs < 300, `expected bounded Hub UI runtime check under 300ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: adds no SectionSource UI storage, writes, sidecars, indexes, vectors, summaries, or memory', () => {
    const runtime = hubSectionSourceRuntime();

    assert.doesNotMatch(runtime, /\blocalStorage\b/);
    assert.doesNotMatch(runtime, /\bsessionStorage\b/);
    assert.doesNotMatch(runtime, /\bwrite(File|Text)?\b/i);
    assert.doesNotMatch(runtime, /\b(method:\s*['"](POST|PUT|PATCH|DELETE)['"]|deleteOpenNote|switchNoteToEditMode)\b/);
    assert.doesNotMatch(runtime, /\b(index|vector|memory|sidecar|Scooling)\b/i);
    assert.doesNotMatch(runtime, /\b(summarize|summarization|summaries)\b/i);
  });

  it('performance: keeps SectionSource UI reads one-note, no-store, scan-free, and provider-free', () => {
    const runtime = hubSectionSourceRuntime();
    const apiHelper = sourceSlice(readRepoFile('web/hub/hub.js'), 'async function api', '/** Busy state');

    assert.match(runtime, /sectionSourceEndpointForPath\(path\)/);
    assert.match(runtime, /method: 'GET'/);
    assert.doesNotMatch(runtime, /\/api\/v1\/notes\?/);
    assert.doesNotMatch(runtime, /\/api\/v1\/search|\/api\/v1\/index|PageIndex|OCR|LLM/i);
    assert.match(apiHelper, /cache: fetchOpts\.cache != null \? fetchOpts\.cache : 'no-store'/);
  });

  it('security: renders allowlisted fields as text and uses sanitized error states', () => {
    const runtime = hubSectionSourceRuntime();

    assert.match(runtime, /const SECTION_SOURCE_SCHEMA = 'knowtation\.section_source\/v0'/);
    assert.match(runtime, /SECTION_SOURCE_FORBIDDEN_KEYS/);
    assert.match(runtime, /body_returned: item\.body_returned === true/);
    assert.match(runtime, /snippet_returned: item\.snippet_returned === true/);
    assert.match(runtime, /headingText\.textContent = section\.heading_text/);
    assert.match(runtime, /pathLine\.textContent =\s*'Heading path: '/);
    assert.match(runtime, /const debugDetails = document\.createElement\('details'\)/);
    assert.match(runtime, /return 'Sections are unavailable right now\.'/);
    assert.match(runtime, /return 'Sections are unavailable for this session\.'/);
    assert.doesNotMatch(runtime, /\.innerHTML\s*=/);
    assert.doesNotMatch(runtime, /renderNoteMarkdownHtml|marked|DOMPurify|console\.(log|error|warn)/);
  });
});
