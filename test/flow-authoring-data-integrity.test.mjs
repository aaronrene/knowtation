/**
 * Tier 5 — DATA-INTEGRITY: reconcile preserves content; edit = new version row;
 * a conflicting approve leaves zero partial state.
 *
 * @see lib/flow/flow-authoring.mjs
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md §3, §4, §7
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
} from '../lib/flow/flow-store.mjs';
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-authoring-integrity');
const visible = new Set(['personal', 'project', 'org']);

function approve(dataDir, id) {
  const pre = precheckApprovedFlowProposal(dataDir, getProposal(dataDir, id));
  if (pre.ok) applyFlowProposalToIndex(dataDir, pre.vaultId, pre.flow, pre.steps);
  return pre;
}

describe('Flow authoring — data integrity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
    process.env.FLOW_AUTHORING_WRITES = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_AUTHORING_WRITES;
  });

  it('reconcile preserves steps/skill-refs/verification/scope/version/lineage byte-for-byte', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_di_preserve', version: '1.2.0', steps: 4 });
    const proposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'add', createProposal,
    });
    approve(dataDir, proposed.payload.proposal_id);

    const got = getFlow(dataDir, vaultId, 'flow_di_preserve', { filterScopes: visible, starterDir });
    assert.equal(got.flow.scope, bundle.flow.scope);
    assert.equal(got.flow.version, bundle.flow.version);
    assert.deepEqual(got.flow.steps, bundle.flow.steps);
    for (let i = 0; i < bundle.steps.length; i += 1) {
      assert.deepEqual(got.steps[i].skill_refs, bundle.steps[i].skill_refs ?? []);
      assert.deepEqual(got.steps[i].verification, bundle.steps[i].verification);
      assert.equal(got.steps[i].instruction, bundle.steps[i].instruction);
    }
  });

  it('an edit creates a NEW (flow_id, version) row (carry-forward; never mutates the version row in place)', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_di_carry', version: '1.0.0', steps: 2 });
    approve(
      dataDir,
      handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'new',
        flow: bundle.flow, steps: bundle.steps, intent: 'add', createProposal,
      }).payload.proposal_id,
    );

    const store = loadFlowStore(dataDir);
    const cur = latestStoredFlow(store.vaults[vaultId], 'flow_di_carry');
    const canonical = flowDefinitionForClient(cur.flow, cur.steps);
    const baseStateId = flowStateId(canonical.flow, canonical.steps);
    const edited = structuredClone(canonical);
    edited.flow.version = '2.0.0';

    const editProposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'edit',
      flow: edited.flow, steps: edited.steps, intent: 'edit', flowId: 'flow_di_carry',
      baseVersion: '1.0.0', baseStateId, createProposal,
    });
    approve(dataDir, editProposed.payload.proposal_id);

    const finalStore = loadFlowStore(dataDir);
    const rows = finalStore.vaults[vaultId].flows.filter((f) => f.flow_id === 'flow_di_carry');
    assert.equal(rows.length, 2, 'both version rows present');
    assert.ok(rows.find((r) => r.version === '1.0.0'), '1.0.0 row preserved (not version-mutated in place)');
    assert.ok(rows.find((r) => r.version === '2.0.0'), '2.0.0 row added');
  });

  it('a conflicting approve leaves zero partial index state', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_di_conflict', version: '1.0.0', steps: 2 });
    approve(
      dataDir,
      handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'new',
        flow: bundle.flow, steps: bundle.steps, intent: 'add', createProposal,
      }).payload.proposal_id,
    );

    const store = loadFlowStore(dataDir);
    const cur = latestStoredFlow(store.vaults[vaultId], 'flow_di_conflict');
    const canonical = flowDefinitionForClient(cur.flow, cur.steps);
    const baseStateId = flowStateId(canonical.flow, canonical.steps);

    const a = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'edit',
      flow: { ...canonical.flow, version: '2.0.0', summary: 'A' }, steps: canonical.steps,
      intent: 'A', flowId: 'flow_di_conflict', baseVersion: '1.0.0', baseStateId, createProposal,
    });
    const b = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'edit',
      flow: { ...canonical.flow, version: '2.0.0', summary: 'B' }, steps: canonical.steps,
      intent: 'B', flowId: 'flow_di_conflict', baseVersion: '1.0.0', baseStateId, createProposal,
    });
    assert.equal(approve(dataDir, a.payload.proposal_id).ok, true);

    const before = JSON.stringify(loadFlowStore(dataDir));
    const second = approve(dataDir, b.payload.proposal_id);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'FLOW_LINEAGE_CONFLICT');
    const after = JSON.stringify(loadFlowStore(dataDir));
    assert.equal(before, after, 'store unchanged by the conflicting approve');
  });
});
