/**
 * Tier 6 — PERFORMANCE: projection generator p95 budget.
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
  computeFidelity,
  renderedContentHash,
  isProjectionStale,
  detectDrift,
} from '../lib/flow/projection-generator.mjs';
import {
  saveFlowStore,
  buildFlowStepId,
  MAX_STEPS_PER_FLOW,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-projection-performance');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Flow projection — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const flowId = 'flow_perf_projection';

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
        owned_job: `job ${i}`,
        instruction: `instruction ${i}`,
        trigger: `trigger ${i}`,
        when_not_to_run: `skip ${i}`,
        boundaries: [`b${i}`],
        output_shape: `shape ${i}`,
        verification: { kind: 'human_review', evidence_required: false, description: `d${i}` },
        automatable: 'manual',
      });
    }
    saveFlowStore(dataDir, {
      vaults: {
        default: {
          flows: [
            {
              schema: 'knowtation.flow/v0',
              flow_id: flowId,
              title: 'Perf',
              version: '1.0.0',
              scope: 'personal',
              summary: 'perf',
              tags: [],
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

  it('projectFlow + fidelity + hash complete within p95 budget on large fixture', () => {
    const store = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'hub_flow_store.json'), 'utf8'),
    );
    const flow = store.vaults.default.flows[0];
    const steps = store.vaults.default.steps;
    const times = [];
    let rendered = '';
    for (let i = 0; i < 50; i += 1) {
      const t0 = performance.now();
      const projection = projectFlow(flow, steps, { harness: 'cli_runbook' });
      computeFidelity('cli_runbook', flow, steps);
      renderedContentHash(projection.rendered);
      isProjectionStale('0.1.0', '0.2.0');
      detectDrift(projection.rendered, projection.rendered);
      times.push(performance.now() - t0);
      rendered = projection.rendered;
    }
    const p95 = percentile(times, 95);
    assert.ok(p95 < 250, `p95 ${p95}ms exceeds budget`);
    assert.ok(rendered.length > 0);
  });
});
