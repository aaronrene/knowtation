/**
 * Tier 1 — UNIT: versioned step keying helpers (7A-10c).
 *
 * @see lib/flow/flow-store.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stampStepsForStore,
  normalizeVaultSteps,
  stepsForFlowVersion,
  buildFlowStepId,
} from '../lib/flow/flow-store.mjs';

describe('Flow store — versioned step keying (unit)', () => {
  it('stampStepsForStore stamps flow_version on every step', () => {
    const steps = [{
      schema: 'knowtation.flow_step/v0',
      step_id: 'flow_x#1',
      flow_id: 'flow_x',
      ordinal: 1,
    }];
    const stamped = stampStepsForStore(steps, '1.2.3');
    assert.equal(stamped[0].flow_version, '1.2.3');
    assert.equal(stamped[0].step_id, 'flow_x#1');
  });

  it('stepsForFlowVersion returns only steps for the requested version', () => {
    const vault = {
      flows: [
        { flow_id: 'flow_x', version: '1.0.0', steps: [buildFlowStepId('flow_x', 1)] },
        { flow_id: 'flow_x', version: '2.0.0', steps: [buildFlowStepId('flow_x', 1)] },
      ],
      steps: [
        { flow_id: 'flow_x', flow_version: '1.0.0', step_id: 'flow_x#1', ordinal: 1, instruction: 'v1' },
        { flow_id: 'flow_x', flow_version: '2.0.0', step_id: 'flow_x#1', ordinal: 1, instruction: 'v2' },
      ],
      runs: [],
      candidates: [],
      projections: [],
    };
    const v1 = stepsForFlowVersion(vault, 'flow_x', '1.0.0');
    const v2 = stepsForFlowVersion(vault, 'flow_x', '2.0.0');
    assert.equal(v1.length, 1);
    assert.equal(v2.length, 1);
    assert.equal(v1[0].instruction, 'v1');
    assert.equal(v2[0].instruction, 'v2');
  });

  it('normalizeVaultSteps expands legacy rows without flow_version per flow version', () => {
    const vault = {
      flows: [
        { flow_id: 'flow_x', version: '1.0.0', steps: ['flow_x#1'] },
        { flow_id: 'flow_x', version: '2.0.0', steps: ['flow_x#1'] },
      ],
      steps: [{ flow_id: 'flow_x', step_id: 'flow_x#1', ordinal: 1, instruction: 'legacy' }],
      runs: [],
      candidates: [],
      projections: [],
    };
    normalizeVaultSteps(vault);
    assert.equal(vault.steps.length, 2);
    assert.ok(vault.steps.every((s) => s.flow_version));
    const v1 = stepsForFlowVersion(vault, 'flow_x', '1.0.0');
    const v2 = stepsForFlowVersion(vault, 'flow_x', '2.0.0');
    assert.equal(v1[0].instruction, 'legacy');
    assert.equal(v2[0].instruction, 'legacy');
  });
});
