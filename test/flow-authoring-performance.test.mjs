/**
 * Tier 6 — PERFORMANCE: propose validation + flowStateId within a p95 budget on
 * a large fixture; approve→apply bounded; no quadratic version resolution.
 *
 * @see lib/flow/flow-authoring.mjs
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowProposeRequest,
  precheckApprovedFlowProposal,
  applyFlowProposalToIndex,
  flowStateId,
} from '../lib/flow/flow-authoring.mjs';
import { flowDefinitionForClient, MAX_STEPS_PER_FLOW, buildFlowStepId } from '../lib/flow/flow-store.mjs';
import { createProposal, getProposal } from '../hub/proposals-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-authoring-perf');
const visible = new Set(['personal', 'project', 'org']);

function bigFlow(flowId, version, stepCount) {
  const steps = [];
  const refs = [];
  for (let i = 1; i <= stepCount; i += 1) {
    const stepId = buildFlowStepId(flowId, i);
    refs.push(stepId);
    steps.push({
      schema: 'knowtation.flow_step/v0',
      step_id: stepId,
      flow_id: flowId,
      ordinal: i,
      owned_job: `Job ${i}`,
      instruction: `Do step ${i}.`,
      trigger: `Run ${i}.`,
      when_not_to_run: `Skip ${i}.`,
      boundaries: ['Read only'],
      output_shape: `Out ${i}.`,
      verification: { kind: 'artifact_exists', evidence_required: true, description: `Artifact ${i}.` },
      automatable: 'manual',
    });
  }
  return {
    flow: {
      schema: 'knowtation.flow/v0', flow_id: flowId, title: 'Big', version,
      scope: 'personal', summary: 'big', tags: [], steps: refs, inputs: [],
      updated: '2026-06-20T00:00:00Z', truncated: false,
    },
    steps,
  };
}

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe('Flow authoring — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_AUTHORING_WRITES = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_AUTHORING_WRITES;
  });

  it('flowStateId on a MAX_STEPS_PER_FLOW flow stays under a p95 budget', () => {
    const big = bigFlow('flow_perf', '1.0.0', MAX_STEPS_PER_FLOW);
    const def = flowDefinitionForClient(big.flow, big.steps);
    const samples = [];
    for (let i = 0; i < 200; i += 1) {
      const t = process.hrtime.bigint();
      flowStateId(def.flow, def.steps);
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    assert.ok(p95(samples) < 25, `flowStateId p95 ${p95(samples).toFixed(2)}ms`);
  });

  it('propose validation on the large fixture stays under a p95 budget', () => {
    const samples = [];
    for (let i = 0; i < 50; i += 1) {
      const big = bigFlow(`flow_perf_${i}`, '1.0.0', MAX_STEPS_PER_FLOW);
      const t = process.hrtime.bigint();
      const r = handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'new',
        flow: big.flow, steps: big.steps, intent: 'perf', createProposal,
      });
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
      assert.equal(r.ok, true);
    }
    assert.ok(p95(samples) < 150, `propose p95 ${p95(samples).toFixed(2)}ms`);
  });

  it('approve→apply reconcile is bounded for a large flow', () => {
    const big = bigFlow('flow_perf_apply', '1.0.0', MAX_STEPS_PER_FLOW);
    const proposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'new',
      flow: big.flow, steps: big.steps, intent: 'perf', createProposal,
    });
    const proposal = getProposal(dataDir, proposed.payload.proposal_id);
    const t = process.hrtime.bigint();
    const pre = precheckApprovedFlowProposal(dataDir, proposal);
    applyFlowProposalToIndex(dataDir, pre.vaultId, pre.flow, pre.steps);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(pre.ok);
    assert.ok(ms < 200, `reconcile ${ms.toFixed(2)}ms`);
  });
});
