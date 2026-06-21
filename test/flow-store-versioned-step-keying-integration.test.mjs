/**
 * Tier 2 — INTEGRATION: authoring reconcile + pinned getFlow (7A-10c).
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
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-versioned-step-keying-int');
const visible = new Set(['personal', 'project', 'org']);

function approve(dataDir, id) {
  const pre = precheckApprovedFlowProposal(dataDir, getProposal(dataDir, id));
  if (pre.ok) applyFlowProposalToIndex(dataDir, pre.vaultId, pre.flow, pre.steps);
  return pre;
}

describe('Flow store — versioned step keying (integration)', () => {
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

  it('propose-edit with reworded step preserves v1 step text when pinned', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_10c_int', version: '1.0.0', steps: 2 });
    approve(
      dataDir,
      handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'new',
        flow: bundle.flow, steps: bundle.steps, intent: 'add', createProposal,
      }).payload.proposal_id,
    );

    const store = loadFlowStore(dataDir);
    const cur = latestStoredFlow(store.vaults[vaultId], 'flow_10c_int');
    const canonical = flowDefinitionForClient(cur.flow, cur.steps);
    const edited = structuredClone(canonical);
    edited.flow.version = '2.0.0';
    edited.steps[0].instruction = 'Integration reword for step 1.';

    approve(
      dataDir,
      handleFlowProposeRequest({
        dataDir, vaultId, visibleScopes: visible, kind: 'edit',
        flow: edited.flow, steps: edited.steps, intent: 'reword',
        flowId: 'flow_10c_int', baseVersion: '1.0.0',
        baseStateId: flowStateId(canonical.flow, canonical.steps), createProposal,
      }).payload.proposal_id,
    );

    const v1 = getFlow(dataDir, vaultId, 'flow_10c_int', {
      filterScopes: visible, version: '1.0.0', starterDir,
    });
    const v2 = getFlow(dataDir, vaultId, 'flow_10c_int', {
      filterScopes: visible, version: '2.0.0', starterDir,
    });
    assert.equal(v1.steps[0].instruction, bundle.steps[0].instruction);
    assert.equal(v2.steps[0].instruction, 'Integration reword for step 1.');
  });
});
