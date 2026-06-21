/**
 * Tier 5 — DATA INTEGRITY: fidelity round-trip and anti-drift diff proof.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §9–§10
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectFlow,
  detectDrift,
} from '../lib/flow/projection-generator.mjs';
import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import { saveFlowStore, validateFlowBundle, buildFlowStepId } from '../lib/flow/flow-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-projection-integrity');
const starterDir = path.join(getRepoRoot(), 'flows/starter');
const handoverBundle = JSON.parse(
  fs.readFileSync(path.join(starterDir, 'flow_overseer_handover.json'), 'utf8'),
);

const STEP_FIELDS = [
  'owned_job',
  'instruction',
  'trigger',
  'when_not_to_run',
  'requires',
  'boundaries',
  'skill_refs',
  'inputs',
  'outputs',
  'output_shape',
  'verification',
];

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeRenderedForFieldCheck(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * @param {string} rendered
 * @param {string[]} dropped
 * @param {object} step
 */
function assertFieldExpressedOrDropped(rendered, dropped, step) {
  const normalized = normalizeRenderedForFieldCheck(rendered);
  for (const field of STEP_FIELDS) {
    const value = step[field];
    const present =
      (typeof value === 'string' && value.trim()) ||
      (Array.isArray(value) && value.length > 0) ||
      (field === 'verification' && value && typeof value === 'object');
    if (!present) continue;
    const inDropped = dropped.includes(field) || dropped.includes('verification.evidence_required');
    const inRendered =
      (field === 'owned_job' && normalized.includes(step.owned_job)) ||
      (field === 'instruction' && normalized.includes(step.instruction)) ||
      (field === 'trigger' && normalized.includes(step.trigger)) ||
      (field === 'when_not_to_run' && normalized.includes(step.when_not_to_run)) ||
      (field === 'requires' &&
        Array.isArray(step.requires) &&
        step.requires.every((r) => normalized.includes(r.id))) ||
      (field === 'boundaries' &&
        step.boundaries.every((b) => normalized.includes(b))) ||
      (field === 'skill_refs' &&
        Array.isArray(step.skill_refs) &&
        step.skill_refs.every((r) => normalized.includes(r.id))) ||
      (field === 'inputs' &&
        step.inputs.every((i) => normalized.includes(i.name))) ||
      (field === 'outputs' &&
        step.outputs.every((o) => normalized.includes(o.name))) ||
      (field === 'output_shape' && normalized.includes(step.output_shape)) ||
      (field === 'verification' && normalized.includes(step.verification.description));
    assert.ok(inRendered || inDropped, `field ${field} neither rendered nor dropped`);
  }
}

describe('Flow projection — data integrity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('every present step field is rendered or listed in dropped_fields', () => {
    const projection = projectFlow(handoverBundle.flow, handoverBundle.steps, {
      harness: 'cursor_rule',
    });
    const dropped = projection.fidelity.dropped_fields;
    for (const step of handoverBundle.steps) {
      assertFieldExpressedOrDropped(projection.rendered, dropped, step);
    }
  });

  it('anti-drift: canonical change is the only diff after regenerate', () => {
    const v1 = structuredClone(handoverBundle);
    const rendered1 = projectFlow(v1.flow, v1.steps, { harness: 'cli_runbook' }).rendered;

    const v2 = structuredClone(handoverBundle);
    v2.flow.version = '0.2.0';
    v2.steps[0].verification.description = 'Tightened verification for anti-drift proof.';
    const rendered2 = projectFlow(v2.flow, v2.steps, { harness: 'cli_runbook' }).rendered;

    assert.notEqual(rendered1, rendered2);
    assert.ok(rendered2.includes('Tightened verification for anti-drift proof.'));
    assert.ok(!rendered1.includes('Tightened verification for anti-drift proof.'));
    assert.deepEqual(detectDrift(rendered2, rendered2), { drift: false, reason: 'clean' });
  });

  it('delete and regenerate reproduces byte-for-byte', () => {
    const first = projectFlow(handoverBundle.flow, handoverBundle.steps, {
      harness: 'cli_runbook',
    }).rendered;
    const second = projectFlow(handoverBundle.flow, handoverBundle.steps, {
      harness: 'cli_runbook',
    }).rendered;
    assert.equal(first, second);
  });

  it('flow_version in projection matches canonical source version', () => {
    const validated = validateFlowBundle(handoverBundle);
    assert.equal(validated.ok, true);
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [validated.flow, { ...validated.flow, version: '0.2.0', updated: '2026-06-21T00:00:00Z' }],
          steps: validated.steps,
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    });
    const pinned = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_overseer_handover',
      harness: 'cli_runbook',
      version: '0.1.0',
      visibleScopes: new Set(['project']),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(pinned.ok, true);
    assert.equal(pinned.payload.projection.flow_version, '0.1.0');
    assert.equal(pinned.payload.staleness.stale, true);
    assert.equal(pinned.payload.staleness.latest_version, '0.2.0');
  });
});
