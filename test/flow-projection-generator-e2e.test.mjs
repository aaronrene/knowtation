/**
 * Tier 3 — E2E: flow project walkthrough with --out and --check.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §9–§10
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import { detectDrift, GENERATED_MARKER_PREFIX } from '../lib/flow/projection-generator.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-projection-e2e');
const repoRoot = getRepoRoot();

describe('E2E — flow project walkthrough', () => {
  const dataDir = path.join(tmpRoot, 'data');

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('seeds starters, projects cli_runbook with six ordered steps and clean --check', () => {
    const result = handleFlowProjectRequest({
      dataDir,
      vaultId: 'default',
      flowId: 'flow_overseer_handover',
      harness: 'cli_runbook',
      visibleScopes: new Set(['personal', 'project', 'org']),
      starterDir: path.join(repoRoot, 'flows/starter'),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(result.ok, true);
    const { projection, staleness } = result.payload;
    assert.ok(projection.rendered.includes(GENERATED_MARKER_PREFIX));
    assert.equal((projection.rendered.match(/## Step \d+/g) ?? []).length, 6);
    const kinds = new Set();
    for (const line of projection.rendered.split('\n')) {
      if (line.includes('human_review') || line.includes('artifact_exists')) {
        kinds.add(line.includes('artifact_exists') ? 'artifact_exists' : 'human_review');
      }
    }
    assert.ok(kinds.has('human_review'));
    assert.ok(kinds.has('artifact_exists'));
    assert.equal(staleness.stale, false);

    const outFile = path.join(tmpRoot, 'AGENTS.md');
    fs.writeFileSync(outFile, projection.rendered, 'utf8');
    const drift = detectDrift(fs.readFileSync(outFile, 'utf8'), projection.rendered);
    assert.deepEqual(drift, { drift: false, reason: 'clean' });
  });

  it('cursor_rule emits MDC frontmatter and drops when_not_to_run in fidelity', () => {
    const result = handleFlowProjectRequest({
      dataDir,
      vaultId: 'default',
      flowId: 'flow_overseer_handover',
      harness: 'cursor_rule',
      visibleScopes: new Set(['personal', 'project', 'org']),
      starterDir: path.join(repoRoot, 'flows/starter'),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(result.ok, true);
    const { rendered } = result.payload.projection;
    assert.ok(rendered.startsWith('---\n'));
    assert.ok(rendered.includes('description:'));
    assert.ok(rendered.includes(GENERATED_MARKER_PREFIX));
    assert.ok(result.payload.projection.fidelity.dropped_fields.includes('when_not_to_run'));
  });
});
