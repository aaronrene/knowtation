/**
 * SectionSource Phase 1D transport planning tests.
 *
 * Phase 1D accepted future body-free CLI and self-hosted MCP surfaces only. It
 * must not allow hosted MCP, Hub, search, persistence, Scooling runtime
 * behavior, section bodies, snippets, summaries, PageIndex, OCR, LLM calls, or
 * provider routing.
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
const planPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-TRANSPORT-PLAN.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('SectionSource Phase 1D body-free transport plan', () => {
  it('unit: plan covers the required transport decision areas', () => {
    const plan = fs.readFileSync(planPath, 'utf8');
    const requiredSections = [
      '## Transport Decision',
      '## Allowed Future Local CLI Shape',
      '## Allowed Future Self-Hosted MCP Shape',
      '## Hosted Transport Block',
      '## Search And Persistence Block',
      '## Scooling Boundary',
      '## Seven-Tier Test Requirements',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];

    for (const section of requiredSections) {
      assert.equal(plan.includes(section), true, `${section} is documented`);
    }
    assert.match(plan, /The local CLI and self-hosted MCP surfaces are now implemented/);
    assert.match(plan, /This plan does not accept a hosted route, schema extension/);
  });

  it('integration: current SectionSource library output remains body-free after transport planning', () => {
    const source = readSectionSource(fixtureVault, 'inbox/one.md');
    const serialized = JSON.stringify(source);

    assert.equal(source.sections.every((section) => section.body_returned === false), true);
    assert.equal(source.sections.every((section) => section.snippet_returned === false), true);
    assert.equal(Object.hasOwn(source, 'body'), false);
    assert.equal(Object.hasOwn(source, 'snippet'), false);
    assert.equal(Object.hasOwn(source, 'frontmatter'), false);
    assert.equal(serialized.includes('Body of inbox one'), false);
    assert.equal(serialized.includes('knowtation://'), false);
  });

  it('end-to-end: local CLI, self-hosted MCP, and hosted MCP are exposed while Hub remains blocked', () => {
    const cliSource = readRepoFile('cli/index.mjs');
    const selfHostedMcp = readRepoFile('mcp/create-server.mjs');
    const hostedMcp = readRepoFile('hub/gateway/mcp-hosted-server.mjs');
    const hostedAcl = readRepoFile('hub/gateway/mcp-tool-acl.mjs');
    const hubServer = readRepoFile('hub/gateway/server.mjs');

    assert.equal(cliSource.includes('get-section-source'), true);
    assert.equal(cliSource.includes('readSectionSource'), true);
    assert.equal(selfHostedMcp.includes('get_section_source'), true);
    assert.equal(selfHostedMcp.includes('readSectionSource'), true);
    assert.equal(hostedMcp.includes('get_section_source'), true);
    assert.equal(hostedMcp.includes('buildSectionSource'), true);
    assert.equal(hostedAcl.includes('get_section_source'), true);
    assert.equal(hostedMcp.includes('readSectionSource'), false);
    assert.equal(hubServer.includes('get_section_source'), false);
    assert.equal(hubServer.includes('section_source/v0'), false);
  });

  it('stress: transport planning checks bounded files without scanning the vault', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-TRANSPORT-PLAN.md',
      'docs/SECTION-SOURCE-BODY-SNIPPET-POLICY.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'lib/section-source.mjs',
      'lib/section-source-note.mjs',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 5);
    assert.ok(elapsedMs < 200, `expected bounded plan check under 200ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: transport planning adds no writes, sidecars, indexes, vectors, or summaries', () => {
    const implementation = [
      readRepoFile('lib/section-source.mjs'),
      readRepoFile('lib/section-source-note.mjs'),
    ].join('\n');

    assert.doesNotMatch(implementation, /\bwriteFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bappendFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bsidecar[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bvector[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bsummary[A-Za-z0-9_]*\s*=/);
  });

  it('performance: plan keeps one-note transport bounded and provider-free', () => {
    const plan = fs.readFileSync(planPath, 'utf8');

    assert.match(plan, /One-note transport calls do not scan the whole vault/);
    assert.match(plan, /No external provider calls occur/);
    assert.match(plan, /Transport output size remains bounded by section count and text caps/);
  });

  it('security: plan blocks body, snippet, hosted, search, persistence, and Scooling exposure', () => {
    const plan = fs.readFileSync(planPath, 'utf8');
    const blockedPhrases = [
      'No note body text in transport output.',
      'No section body text in transport output.',
      'No snippets in transport output.',
      'Hosted MCP and Hub transport remain blocked.',
      'Transport planning does not approve search or persistence.',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(plan.includes(phrase), true, `${phrase} is documented`);
    }
    assert.match(plan, /Scooling remains blocked from live SectionSource runtime consumption until a separate\s+Scooling phase/);
  });
});
