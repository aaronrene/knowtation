/**
 * Tier 4 — STRESS: large-flow projection bounds and ordering.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectFlow,
  MAX_RENDERED_BYTES,
} from '../lib/flow/projection-generator.mjs';
import {
  saveFlowStore,
  buildFlowStepId,
  MAX_STEPS_PER_FLOW,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-projection-stress');

describe('Flow projection — stress', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  const flowId = 'flow_stress_projection';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const steps = [];
    const stepIds = [];
    for (let i = 1; i <= MAX_STEPS_PER_FLOW; i += 1) {
      const stepId = buildFlowStepId(flowId, i);
      stepIds.push(stepId);
      steps.push({
        schema: 'knowtation.flow_step/v0',
        step_id: stepId,
        flow_id: flowId,
        ordinal: i,
        owned_job: `Job ${i} with padding ${'x'.repeat(200)}`,
        instruction: `Instruction ${i}`,
        trigger: `Trigger ${i}`,
        when_not_to_run: `Skip ${i}`,
        requires: [{ kind: 'tool', id: `handle_${i}` }],
        boundaries: [`boundary ${i}`],
        skill_refs: [{ kind: 'cli', id: `skill_${i}` }],
        inputs: [{ name: 'in', from: 'prev' }],
        outputs: [{ name: 'out', type: 'text' }],
        output_shape: `shape ${i}`,
        verification: {
          kind: 'human_review',
          evidence_required: true,
          description: `verify ${i}`,
        },
        automatable: 'manual',
      });
    }
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [
            {
              schema: 'knowtation.flow/v0',
              flow_id: flowId,
              title: 'Stress projection',
              version: '1.0.0',
              scope: 'personal',
              summary: 'stress',
              tags: ['stress'],
              steps: stepIds,
              updated: '2026-06-20T00:00:00Z',
              truncated: false,
            },
          ],
          steps,
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('MAX_STEPS_PER_FLOW flow stays within MAX_RENDERED_BYTES with step-boundary truncation', () => {
    const store = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'hub_flow_store.json'), 'utf8'),
    );
    const flow = store.vaults[vaultId].flows[0];
    const steps = store.vaults[vaultId].steps;
    const t0 = performance.now();
    const projection = projectFlow(flow, steps, { harness: 'cli_runbook' });
    const elapsed = performance.now() - t0;
    assert.ok(Buffer.byteLength(projection.rendered, 'utf8') <= MAX_RENDERED_BYTES);
    const ordinals = [...projection.rendered.matchAll(/## Step (\d+)/g)].map((m) => Number(m[1]));
    for (let i = 1; i < ordinals.length; i += 1) {
      assert.ok(ordinals[i] > ordinals[i - 1]);
    }
    assert.ok(elapsed < 5000, `render took ${elapsed}ms`);
    if (projection.fidelity.notes) {
      assert.match(projection.fidelity.notes, /truncat/i);
    }
  });

  it('many back-to-back projections remain bounded', () => {
    const store = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'hub_flow_store.json'), 'utf8'),
    );
    const flow = store.vaults[vaultId].flows[0];
    const steps = store.vaults[vaultId].steps;
    for (let i = 0; i < 20; i += 1) {
      const p = projectFlow(flow, steps, { harness: 'cursor_rule' });
      assert.ok(Buffer.byteLength(p.rendered, 'utf8') <= MAX_RENDERED_BYTES);
    }
  });
});
