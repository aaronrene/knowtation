/**
 * Tier 3 — E2E: propose → approve → reconcile → read, end to end (lib path).
 *
 * Mirrors the Hub approve→apply reconcile (precheck + index upsert) that the
 * server route performs for `source: "flow"` proposals. Synthetic bundles +
 * an empty starter dir keep the lazy seed inert so only the reconcile mutates
 * the index.
 *
 * @see lib/flow/flow-authoring.mjs
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md §3, §4
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
import { getFlow, flowDefinitionForClient, latestStoredFlow, loadFlowStore } from '../lib/flow/flow-store.mjs';
import { createProposal, getProposal, updateProposalStatus } from '../hub/proposals-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-authoring-e2e');
const visible = new Set(['personal', 'project', 'org']);

/** Simulate the Hub approve→apply reconcile for a flow proposal. */
function approveFlowProposal(dataDir, proposalId) {
  const proposal = getProposal(dataDir, proposalId);
  const pre = precheckApprovedFlowProposal(dataDir, proposal);
  if (!pre.ok) return pre;
  applyFlowProposalToIndex(dataDir, pre.vaultId, pre.flow, pre.steps);
  updateProposalStatus(dataDir, proposalId, 'approved');
  return { ok: true };
}

describe('Flow authoring — propose/approve lifecycle', () => {
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

  it('propose-new → approve → flow get shows the new flow at its version', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_e2e_new', version: '1.0.0', steps: 3 });
    const proposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'add new flow', createProposal,
    });
    assert.equal(proposed.ok, true);
    assert.equal(getFlow(dataDir, vaultId, 'flow_e2e_new', { filterScopes: visible, starterDir }), null);

    assert.equal(approveFlowProposal(dataDir, proposed.payload.proposal_id).ok, true);

    const got = getFlow(dataDir, vaultId, 'flow_e2e_new', { filterScopes: visible, starterDir });
    assert.ok(got);
    assert.equal(got.flow.version, '1.0.0');
    assert.equal(got.steps.length, 3);
  });

  it('propose-edit with correct base → approve → version bumped, old still pinnable', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_e2e_edit', version: '1.0.0', steps: 2 });
    approveFlowProposal(
      dataDir,
      handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'new',
        flow: bundle.flow, steps: bundle.steps, intent: 'add', createProposal,
      }).payload.proposal_id,
    );

    const store = loadFlowStore(dataDir);
    const cur = latestStoredFlow(store.vaults[vaultId], 'flow_e2e_edit');
    const canonical = flowDefinitionForClient(cur.flow, cur.steps);
    const baseStateId = flowStateId(canonical.flow, canonical.steps);

    const edited = structuredClone(canonical);
    edited.flow.version = '1.1.0';
    edited.flow.summary = 'edited summary';

    const editProposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'edit',
      flow: edited.flow, steps: edited.steps, intent: 'edit it', flowId: 'flow_e2e_edit',
      baseVersion: '1.0.0', baseStateId, createProposal,
    });
    assert.equal(editProposed.ok, true);
    assert.equal(editProposed.payload.base_version, '1.0.0');

    approveFlowProposal(dataDir, editProposed.payload.proposal_id);

    const latest = getFlow(dataDir, vaultId, 'flow_e2e_edit', { filterScopes: visible, starterDir });
    assert.equal(latest.flow.version, '1.1.0');
    const old = getFlow(dataDir, vaultId, 'flow_e2e_edit', { filterScopes: visible, version: '1.0.0', starterDir });
    assert.ok(old, 'old version row still pinnable');
    assert.equal(old.flow.version, '1.0.0');
  });

  it('discard leaves the index unchanged', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_e2e_discard', steps: 2 });
    const proposed = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'add', createProposal,
    });
    assert.equal(proposed.ok, true);
    updateProposalStatus(dataDir, proposed.payload.proposal_id, 'discarded');
    assert.equal(getFlow(dataDir, vaultId, 'flow_e2e_discard', { filterScopes: visible, starterDir }), null);
  });

  it('import bundle routes through the same propose path with scooling.flow external_ref', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_e2e_import', steps: 2 });
    const imported = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'import',
      bundle: { flow: bundle.flow, steps: bundle.steps }, intent: 'import it',
      externalRef: 'scooling.flow:import-e2e-1', sourceVaultHint: 'partner-vault', createProposal,
    });
    assert.equal(imported.ok, true);
    const stored = getProposal(dataDir, imported.payload.proposal_id);
    assert.equal(stored.source, 'flow');
    assert.equal(stored.flow_meta.kind, 'import');
    assert.equal(stored.external_ref, 'scooling.flow:import-e2e-1');
    approveFlowProposal(dataDir, imported.payload.proposal_id);
    assert.ok(getFlow(dataDir, vaultId, 'flow_e2e_import', { filterScopes: visible, starterDir }));
  });

  it('import with non-scooling.flow external_ref is refused (EXTERNAL_REF_INVALID)', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_e2e_badref', steps: 2 });
    const bad = handleFlowProposeRequest({
      dataDir, vaultId, visibleScopes: visible, kind: 'import',
      bundle: { flow: bundle.flow, steps: bundle.steps }, intent: 'import it',
      externalRef: 'muse:ref-123', createProposal,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal(bad.code, 'EXTERNAL_REF_INVALID');
  });
});
