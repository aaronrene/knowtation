/**
 * Tier 1 — UNIT: Flow authoring tokens, gating, derivation, envelope shape.
 *
 * @see lib/flow/flow-authoring.mjs
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md §4, §6, §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  flowStateId,
  absentFlowStateId,
  deriveAutoApprovable,
  getFlowAuthoringWritesEnabled,
  getFlowAuthoringForbidden,
  handleFlowProposeRequest,
  FLOW_STATE_ID_PREFIX,
  FLOW_PROPOSAL_SCHEMA,
} from '../lib/flow/flow-authoring.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-authoring-unit');
const starterDir = path.join(getRepoRoot(), 'flows/starter');

function loadStarter(name) {
  return JSON.parse(fs.readFileSync(path.join(starterDir, name), 'utf8'));
}

describe('flowStateId — deterministic optimistic-concurrency token', () => {
  const flow = {
    schema: 'knowtation.flow/v0',
    flow_id: 'flow_x',
    title: 'Title',
    version: '1.2.0',
    scope: 'personal',
    summary: 'summary',
    tags: ['a', 'b'],
    steps: ['flow_x#1'],
    inputs: [],
    vault_mirror_path: 'meta/flows/x.md',
    updated: '2026-06-20T00:00:00Z',
    truncated: false,
  };
  const steps = [{ schema: 'knowtation.flow_step/v0', step_id: 'flow_x#1', flow_id: 'flow_x', ordinal: 1 }];

  it('is stable across key order in both flow and steps', async () => {
    const a = flowStateId(flow, steps);
    const reordered = {
      truncated: false,
      updated: '2026-06-20T00:00:00Z',
      steps: ['flow_x#1'],
      version: '1.2.0',
      flow_id: 'flow_x',
      scope: 'personal',
      title: 'Title',
      summary: 'summary',
      tags: ['a', 'b'],
      inputs: [],
      vault_mirror_path: 'meta/flows/x.md',
      schema: 'knowtation.flow/v0',
    };
    const b = flowStateId(reordered, [{ ordinal: 1, flow_id: 'flow_x', step_id: 'flow_x#1', schema: 'knowtation.flow_step/v0' }]);
    assert.equal(a, b);
    assert.ok(a.startsWith(FLOW_STATE_ID_PREFIX));
    assert.equal(a.length, FLOW_STATE_ID_PREFIX.length + 16);
  });

  it('changes when content changes', async () => {
    const a = flowStateId(flow, steps);
    const b = flowStateId({ ...flow, summary: 'different' }, steps);
    assert.notEqual(a, b);
  });

  it('orders steps by ordinal regardless of input order', async () => {
    const s2 = [
      { step_id: 'flow_x#2', flow_id: 'flow_x', ordinal: 2 },
      { step_id: 'flow_x#1', flow_id: 'flow_x', ordinal: 1 },
    ];
    const s2rev = [s2[1], s2[0]];
    assert.equal(flowStateId(flow, s2), flowStateId(flow, s2rev));
  });

  it('absent sentinel is stable and prefixed', async () => {
    assert.equal(absentFlowStateId(), absentFlowStateId());
    assert.ok(absentFlowStateId().startsWith(FLOW_STATE_ID_PREFIX));
  });
});

describe('deriveAutoApprovable — server-derived, human_review ⇒ false', () => {
  it('false when any step requires human_review', async () => {
    const steps = [
      { verification: { kind: 'artifact_exists' } },
      { verification: { kind: 'human_review' } },
    ];
    assert.equal(deriveAutoApprovable(steps), false);
  });

  it('true only when no human_review step exists', async () => {
    const steps = [
      { verification: { kind: 'artifact_exists' } },
      { verification: { kind: 'test_pass' } },
    ];
    assert.equal(deriveAutoApprovable(steps), true);
  });

  it('false for empty step list', async () => {
    assert.equal(deriveAutoApprovable([]), false);
  });
});

describe('gating — FLOW_AUTHORING_WRITES default OFF (tri-state)', () => {
  const dataDir = path.join(tmpRoot, 'gate');
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.FLOW_AUTHORING_WRITES;
    delete process.env.FLOW_AUTHORING_FORBIDDEN;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_AUTHORING_WRITES;
    delete process.env.FLOW_AUTHORING_FORBIDDEN;
  });

  it('defaults to disabled with no env and no policy file', async () => {
    assert.equal(getFlowAuthoringWritesEnabled(dataDir), false);
    assert.equal(getFlowAuthoringForbidden(dataDir), false);
  });

  it('env 1/true enables; 0/false disables; precedence over file', async () => {
    fs.writeFileSync(
      path.join(dataDir, 'hub_flow_authoring_policy.json'),
      JSON.stringify({ flow_authoring_writes_enabled: true }),
      'utf8',
    );
    assert.equal(getFlowAuthoringWritesEnabled(dataDir), true);
    process.env.FLOW_AUTHORING_WRITES = '0';
    assert.equal(getFlowAuthoringWritesEnabled(dataDir), false);
    process.env.FLOW_AUTHORING_WRITES = '1';
    assert.equal(getFlowAuthoringWritesEnabled(dataDir), true);
  });

  it('disabled propose returns FLOW_AUTHORING_DISABLED', async () => {
    const result = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: new Set(['personal']),
      kind: 'new',
      flow: loadStarter('flow_capture_to_note.json').flow,
      steps: loadStarter('flow_capture_to_note.json').steps,
      intent: 'x',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, 'FLOW_AUTHORING_DISABLED');
  });
});

describe('handler validation + envelope (writes enabled)', () => {
  const dataDir = path.join(tmpRoot, 'env');
  const visible = new Set(['personal', 'project', 'org']);
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_AUTHORING_WRITES = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_AUTHORING_WRITES;
  });

  it('rejects an anatomy-incomplete draft with FLOW_DRAFT_INVALID', async () => {
    const bundle = loadStarter('flow_capture_to_note.json');
    bundle.steps[0].trigger = '';
    const result = await handleFlowProposeRequest({
      dataDir, vaultId: 'default', visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'x', createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_DRAFT_INVALID');
  });

  it('requires a non-empty intent', async () => {
    const bundle = loadStarter('flow_capture_to_note.json');
    const result = await handleFlowProposeRequest({
      dataDir, vaultId: 'default', visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: '   ', createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_DRAFT_INVALID');
  });

  it('stamps knowtation.flow_proposal/v0 with pointers only (no body, no secret)', async () => {
    const bundle = loadStarter('flow_capture_to_note.json');
    const result = await handleFlowProposeRequest({
      dataDir, vaultId: 'default', visibleScopes: visible, kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'add it', createProposal,
    });
    assert.equal(result.ok, true);
    assert.equal(result.payload.schema, FLOW_PROPOSAL_SCHEMA);
    assert.equal(result.payload.base_version, null);
    assert.equal(result.payload.base_state_id, null);
    assert.equal(result.payload.status, 'proposed');
    assert.equal(result.payload.scope, 'personal');
    assert.equal(typeof result.payload.auto_approvable, 'boolean');
    const serialized = JSON.stringify(result.payload);
    assert.ok(!/token|oauth|refresh_token|instruction/i.test(serialized));
  });
});
