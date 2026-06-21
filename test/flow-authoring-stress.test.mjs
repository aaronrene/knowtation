/**
 * Tier 4 — STRESS: large drafts + concurrent proposals against one flow_id.
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
import {
  getFlow,
  flowDefinitionForClient,
  latestStoredFlow,
  loadFlowStore,
  MAX_STEPS_PER_FLOW,
  buildFlowStepId,
} from '../lib/flow/flow-store.mjs';
import { createProposal, getProposal, updateProposalStatus } from '../hub/proposals-store.mjs';
import { emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-authoring-stress');
const visible = new Set(['personal', 'project', 'org']);

function bigFlow(flowId, version, stepCount) {
  const steps = [];
  const stepRefs = [];
  for (let i = 1; i <= stepCount; i += 1) {
    const stepId = buildFlowStepId(flowId, i);
    stepRefs.push(stepId);
    steps.push({
      schema: 'knowtation.flow_step/v0',
      step_id: stepId,
      flow_id: flowId,
      ordinal: i,
      owned_job: `Job ${i}`,
      instruction: `Do step ${i} faithfully.`,
      trigger: `Run for step ${i}.`,
      when_not_to_run: `Skip step ${i} when not applicable.`,
      boundaries: ['Read only', 'Untrusted input'],
      output_shape: `Output of step ${i}.`,
      verification: { kind: 'artifact_exists', evidence_required: true, description: `Step ${i} artifact exists.` },
      automatable: 'manual',
    });
  }
  return {
    flow: {
      schema: 'knowtation.flow/v0',
      flow_id: flowId,
      title: 'Large flow',
      version,
      scope: 'personal',
      summary: 'A large flow for stress testing.',
      tags: ['stress'],
      steps: stepRefs,
      inputs: [],
      updated: '2026-06-20T00:00:00Z',
      truncated: false,
    },
    steps,
  };
}

describe('Flow authoring — stress', () => {
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

  it('accepts a MAX_STEPS_PER_FLOW-step draft and reconciles it', () => {
    const bundle = bigFlow('flow_big', '1.0.0', MAX_STEPS_PER_FLOW);
    const proposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'big', createProposal,
    });
    assert.equal(proposed.ok, true);
    const pre = precheckApprovedFlowProposal(dataDir, getProposal(dataDir, proposed.payload.proposal_id));
    assert.equal(pre.ok, true);
    applyFlowProposalToIndex(dataDir, pre.vaultId, pre.flow, pre.steps);
    const got = getFlow(dataDir, vaultId, 'flow_big', { filterScopes: visible, starterDir: emptyStarterDir(dataDir) });
    assert.ok(got);
    assert.equal(got.steps.length, MAX_STEPS_PER_FLOW);
  });

  it('many concurrent edits on one flow_id: exactly one approves, the rest conflict', () => {
    const seed = bigFlow('flow_race', '1.0.0', 3);
    const seedProposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'new',
      flow: seed.flow, steps: seed.steps, intent: 'seed', createProposal,
    });
    const seedPre = precheckApprovedFlowProposal(dataDir, getProposal(dataDir, seedProposed.payload.proposal_id));
    applyFlowProposalToIndex(dataDir, seedPre.vaultId, seedPre.flow, seedPre.steps);

    const store = loadFlowStore(dataDir);
    const cur = latestStoredFlow(store.vaults[vaultId], 'flow_race');
    const canonical = flowDefinitionForClient(cur.flow, cur.steps);
    const baseStateId = flowStateId(canonical.flow, canonical.steps);

    // 10 racers all base on the same v1.0.0 state.
    const proposalIds = [];
    for (let i = 0; i < 10; i += 1) {
      const edited = structuredClone(canonical);
      edited.flow.version = '1.0.1';
      edited.flow.summary = `racer ${i}`;
      const r = handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'edit',
        flow: edited.flow, steps: edited.steps, intent: `race ${i}`, flowId: 'flow_race',
        baseVersion: '1.0.0', baseStateId, createProposal,
      });
      assert.equal(r.ok, true);
      proposalIds.push(r.payload.proposal_id);
    }

    let approved = 0;
    let conflicts = 0;
    for (const id of proposalIds) {
      const pre = precheckApprovedFlowProposal(dataDir, getProposal(dataDir, id));
      if (pre.ok) {
        applyFlowProposalToIndex(dataDir, pre.vaultId, pre.flow, pre.steps);
        updateProposalStatus(dataDir, id, 'approved');
        approved += 1;
      } else {
        assert.equal(pre.code, 'FLOW_LINEAGE_CONFLICT');
        conflicts += 1;
      }
    }
    assert.equal(approved, 1);
    assert.equal(conflicts, 9);

    // No index corruption: exactly two version rows (1.0.0 + 1.0.1).
    const finalStore = loadFlowStore(dataDir);
    const rows = finalStore.vaults[vaultId].flows.filter((f) => f.flow_id === 'flow_race');
    assert.equal(rows.length, 2);
    const versions = rows.map((r) => r.version).sort();
    assert.deepEqual(versions, ['1.0.0', '1.0.1']);
  });
});
