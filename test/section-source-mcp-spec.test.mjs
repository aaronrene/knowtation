/**
 * SectionSource self-hosted MCP implementation tests.
 *
 * Phase 1G accepts the self-hosted MCP implementation only. It must not add
 * hosted MCP, Hub, search, persistence, Scooling runtime behavior, section
 * bodies, snippets, summaries, PageIndex, OCR, LLM calls, or provider routing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readSectionSource } from '../lib/section-source-note.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
const specPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-MCP-IMPLEMENTATION-SPEC.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('SectionSource self-hosted MCP implementation spec', () => {
  it('unit: spec covers the required self-hosted MCP decision areas', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const requiredSections = [
      '## Proposed Tool',
      '## Input Schema',
      '## Accepted Output',
      '## Explicitly Excluded Output',
      '## Error Behavior',
      '## Authorization And Path Safety',
      '## Transport Boundaries',
      '## Resource Boundary',
      '## Seven-Tier Test Requirements',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];

    for (const section of requiredSections) {
      assert.equal(spec.includes(section), true, `${section} is documented`);
    }
    assert.match(spec, /get_section_source/);
    assert.match(spec, /This phase implements only the self-hosted MCP tool/);
  });

  it('integration: current SectionSource local integration remains the expected MCP target', () => {
    const source = readSectionSource(fixtureVault, 'inbox/one.md');
    const serialized = JSON.stringify(source);

    assert.equal(source.schema, 'knowtation.section_source/v0');
    assert.equal(source.path, 'inbox/one.md');
    assert.equal(source.sections.every((section) => section.body_returned === false), true);
    assert.equal(source.sections.every((section) => section.snippet_returned === false), true);
    assert.equal(Object.hasOwn(source, 'body'), false);
    assert.equal(Object.hasOwn(source, 'frontmatter'), false);
    assert.equal(Object.hasOwn(source, 'snippet'), false);
    assert.equal(serialized.includes('Body of inbox one'), false);
  });

  it('end-to-end: self-hosted and hosted MCP are wired while Hub and Scooling remain blocked', () => {
    const selfHostedMcp = readRepoFile('mcp/create-server.mjs');
    const hostedMcp = readRepoFile('hub/gateway/mcp-hosted-server.mjs');
    const hostedAcl = readRepoFile('hub/gateway/mcp-tool-acl.mjs');
    const hubServer = readRepoFile('hub/gateway/server.mjs');
    assert.equal(selfHostedMcp.includes('get_section_source'), true);
    assert.equal(selfHostedMcp.includes('readSectionSource'), true);
    assert.equal(hostedMcp.includes('get_section_source'), true);
    assert.equal(hostedMcp.includes('buildSectionSource'), true);
    assert.equal(hostedAcl.includes('get_section_source'), true);
    assert.equal(hostedMcp.includes('readSectionSource'), false);
    assert.equal(hubServer.includes('get_section_source'), false);
    assert.equal(hubServer.includes('section_source/v0'), false);
  });

  it('stress: MCP spec checks remain bounded to contract files', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-MCP-IMPLEMENTATION-SPEC.md',
      'docs/SECTION-SOURCE-CLI-IMPLEMENTATION-SPEC.md',
      'docs/SECTION-SOURCE-TRANSPORT-PLAN.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'lib/section-source-note.mjs',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 5);
    assert.ok(elapsedMs < 200, `expected bounded MCP spec check under 200ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: MCP implementation adds no writes, sidecars, indexes, vectors, or summaries', () => {
    const implementation = [
      readRepoFile('lib/section-source.mjs'),
      readRepoFile('lib/section-source-note.mjs'),
      readRepoFile('mcp/create-server.mjs'),
    ].join('\n');

    assert.doesNotMatch(implementation, /\bwriteFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bappendFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bsidecar[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bvector[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bsummary[A-Za-z0-9_]*\s*=/);
  });

  it('performance: spec requires one-note reads and no external providers', () => {
    const spec = fs.readFileSync(specPath, 'utf8');

    assert.match(spec, /The tool reads one note only/);
    assert.match(spec, /The tool does not scan the whole vault/);
    assert.match(spec, /The tool does not call external providers/);
  });

  it('security: implementation spec blocks body, snippet, hosted, search, persistence, and Scooling exposure', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const blockedPhrases = [
      'No note body text appears in output.',
      'No section body text appears in output.',
      'No snippets appear in output.',
      'No full frontmatter appears in output.',
      'No MCP resource URI appears in output.',
      'Hosted, Scooling, classroom, search, and persistence exposure remain blocked.',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
  });
});
