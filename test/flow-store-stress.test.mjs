/**
 * Tier 4 — STRESS: capped list/get with large vault fixtures.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  saveFlowStore,
  listFlows,
  getFlow,
  MAX_FLOW_SUMMARIES,
  MAX_STEPS_PER_FLOW,
  buildFlowStepId,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-stress');

function makeFlow(id, scope, version, updated) {
  return {
    schema: 'knowtation.flow/v0',
    flow_id: id,
    title: `Flow ${id}`,
    version,
    scope,
    summary: 'stress fixture',
    tags: ['stress'],
    steps: [buildFlowStepId(id, 1)],
    inputs: [],
    updated,
    truncated: false,
  };
}

function makeStep(flowId) {
  return {
    schema: 'knowtation.flow_step/v0',
    step_id: buildFlowStepId(flowId, 1),
    flow_id: flowId,
    ordinal: 1,
    owned_job: 'job',
    instruction: 'do',
    trigger: 'when',
    when_not_to_run: 'never',
    boundaries: ['b'],
    output_shape: 'shape',
    verification: { kind: 'human_review', evidence_required: true, description: 'd' },
    automatable: 'manual',
  };
}

describe('Flow store — stress caps', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const flows = [];
    const steps = [];
    for (let i = 0; i < MAX_FLOW_SUMMARIES; i += 1) {
      const id = `flow_stress_${String(i).padStart(3, '0')}`;
      flows.push(makeFlow(id, 'personal', '1.0.0', `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`));
      steps.push(makeStep(id));
    }

    const bigId = 'flow_many_steps';
    const bigSteps = [];
    const bigStepIds = [];
    for (let n = 1; n <= MAX_STEPS_PER_FLOW + 5; n += 1) {
      bigStepIds.push(buildFlowStepId(bigId, n));
      bigSteps.push({
        ...makeStep(bigId),
        step_id: buildFlowStepId(bigId, n),
        ordinal: n,
        owned_job: `job ${n}`,
      });
    }
    flows.push({
      ...makeFlow(bigId, 'personal', '1.0.0', '2026-06-30T00:00:00Z'),
      steps: bigStepIds,
    });
    steps.push(...bigSteps);

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows,
          steps,
          runs: [{
            schema: 'knowtation.flow_run/v0',
            run_id: 'run_stress_deep',
            flow_id: bigId,
            flow_version: '1.0.0',
            scope: 'personal',
            status: 'in_progress',
            step_states: bigStepIds.map((sid) => ({
              step_id: sid,
              status: 'done',
              verified: true,
            })),
            started: '2026-06-20T00:00:00Z',
            provenance: { actor: 'hash', harness: 'test' },
          }],
          candidates: [],
          projections: [],
        },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('list caps at limit and sets truncated', () => {
    const list = listFlows(dataDir, vaultId, {
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      limit: 50,
    });
    assert.equal(list.flows.length, 50);
    assert.equal(list.truncated, true);
  });

  it('get caps steps at MAX_STEPS_PER_FLOW and marks flow truncated', () => {
    const got = getFlow(dataDir, vaultId, 'flow_many_steps', {
      filterScopes: new Set(['personal']),
    });
    assert.ok(got);
    assert.equal(got.steps.length, MAX_STEPS_PER_FLOW);
    assert.equal(got.flow.truncated, true);
  });

  it('deep run step_states do not block get', () => {
    const t0 = performance.now();
    const got = getFlow(dataDir, vaultId, 'flow_many_steps', {
      filterScopes: new Set(['personal']),
    });
    const elapsed = performance.now() - t0;
    assert.ok(got);
    assert.ok(elapsed < 500, `getFlow took ${elapsed}ms`);
  });
});
