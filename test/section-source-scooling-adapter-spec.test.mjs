/**
 * SectionSource Scooling adapter planning spec tests.
 *
 * Phase 1I accepts Scooling adapter planning only. It must not add Scooling
 * runtime code, hosted get_section_source, Hub routes, search, persistence,
 * write-back behavior, section bodies, snippets, summaries, PageIndex, OCR,
 * LLM calls, or provider routing.
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
const specPath = path.join(repoRoot, 'docs', 'SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function hostedRuntimeSource() {
  return [
    readRepoFile('hub/gateway/mcp-hosted-server.mjs'),
    readRepoFile('hub/gateway/mcp-tool-acl.mjs'),
    readRepoFile('hub/gateway/server.mjs'),
  ].join('\n');
}

function scoolingBoundarySource() {
  return [
    readRepoFile('hub/gateway/scooling-write-back-smoke.mjs'),
    readRepoFile('hub/gateway/README.md'),
  ].join('\n');
}

describe('SectionSource Scooling adapter planning spec', () => {
  it('unit: spec covers required Scooling adapter decision areas', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const requiredSections = [
      '## Planning Decision',
      '## Future Adapter Target',
      '## Accepted Future Input Source',
      '## Accepted Future Output',
      '## Explicitly Excluded Output',
      '## Authorization Boundary',
      '## Fallback Behavior',
      '## Prompt-Injection Handling',
      '## Deletion, Export, And Staleness',
      '## Write-Back Boundary',
      '## Seven-Tier Test Requirements',
      '## Stop Conditions',
      '## Acceptance Criteria',
    ];

    for (const section of requiredSections) {
      assert.equal(spec.includes(section), true, `${section} is documented`);
    }
    assert.match(spec, /Phase 1I accepts Scooling adapter planning only/);
    assert.match(spec, /KnowtationVaultAdapter\.getSectionSource\(path\)/);
    assert.match(spec, /Scooling remains a consumer/);
    assert.match(spec, /Scooling adapter slice is complete in the Scooling repository at commit `ea5421e`/);
    assert.match(readRepoFile('docs/SECTION-SOURCE-V0-SPEC.md'), /Phase 1J is implemented in the Scooling repository\s+at commit `ea5421e`/);
  });

  it('integration: current SectionSource output remains the only accepted body-free target', () => {
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

  it('end-to-end: hosted runtime is available while Scooling runtime exposure remains blocked', () => {
    const hostedRuntime = hostedRuntimeSource();
    const scoolingBoundary = scoolingBoundarySource();

    assert.equal(hostedRuntime.includes('get_section_source'), true);
    assert.equal(hostedRuntime.includes('buildSectionSource'), true);
    assert.equal(hostedRuntime.includes('readSectionSource'), false);
    assert.equal(scoolingBoundary.includes('get_section_source'), false);
    assert.equal(scoolingBoundary.includes('section_source/v0'), false);
    assert.equal(scoolingBoundary.includes('getSectionSource'), false);
    assert.equal(scoolingBoundary.includes('SectionSource'), false);
  });

  it('stress: Scooling planning checks stay bounded to contract and smoke files', () => {
    const started = Date.now();
    const files = [
      'docs/SECTION-SOURCE-SCOOLING-ADAPTER-PLANNING-SPEC.md',
      'docs/SECTION-SOURCE-V0-SPEC.md',
      'docs/SECTION-SOURCE-HOSTED-AUTHORIZATION-REVIEW-SPEC.md',
      'hub/gateway/scooling-write-back-smoke.mjs',
      'hub/gateway/README.md',
    ].map((relativePath) => readRepoFile(relativePath));
    const elapsedMs = Date.now() - started;

    assert.equal(files.length, 5);
    assert.ok(elapsedMs < 200, `expected bounded Scooling planning check under 200ms, got ${elapsedMs}ms`);
  });

  it('data-integrity: planning adds no writes, sidecars, indexes, vectors, summaries, or live write-back', () => {
    const implementation = [
      readRepoFile('lib/section-source.mjs'),
      readRepoFile('lib/section-source-note.mjs'),
      scoolingBoundarySource(),
    ].join('\n');

    assert.equal(scoolingBoundarySource().includes('allowLiveWrite !== false'), true);
    assert.equal(scoolingBoundarySource().includes('performedLiveWrite: false'), true);
    assert.doesNotMatch(implementation, /\bwriteFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bappendFile(Sync)?\s*\(/);
    assert.doesNotMatch(implementation, /\bsidecar[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bvector[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bsummary[A-Za-z0-9_]*\s*=/);
    assert.doesNotMatch(implementation, /\bgetSectionSource\s*=/);
  });

  it('performance: spec requires one-note reads and no external providers', () => {
    const spec = fs.readFileSync(specPath, 'utf8');

    assert.match(spec, /The future adapter must request one note's SectionSource metadata at a time/);
    assert.match(spec, /The future adapter must not scan the whole vault/);
    assert.match(spec, /The future adapter must not call external providers/);
  });

  it('security: planning blocks body, snippet, hosted, search, persistence, write-back, and provider exposure', () => {
    const spec = fs.readFileSync(specPath, 'utf8');
    const blockedPhrases = [
      'Scooling runtime exposure remains blocked in this phase.',
      'No note body text appears in Scooling SectionSource output.',
      'No section body text appears in Scooling SectionSource output.',
      'No snippets appear in Scooling SectionSource output.',
      'No full frontmatter appears in Scooling SectionSource output.',
      'Hosted, classroom, search, persistence, write-back, and provider exposure remain blocked.',
    ];

    for (const phrase of blockedPhrases) {
      assert.equal(spec.includes(phrase), true, `${phrase} is documented`);
    }
    assert.match(spec, /must not bypass Knowtation path, vault, hosted, or canister-user checks/);
    assert.match(spec, /never parse Markdown as the canonical section source/);
  });
});
