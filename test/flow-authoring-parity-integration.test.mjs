/**
 * Tier 2 — INTEGRATION: triple-surface parity + one-record + disabled gate.
 *
 * MCP `flow_propose`, Hub `POST /api/v1/flows`, and CLI `flow propose` all
 * converge on the single `handleFlowProposeRequest` handler; this proves they
 * produce a deep-equal envelope, create exactly one `/proposals` record, and all
 * refuse identically when `FLOW_AUTHORING_WRITES` is off.
 *
 * @see lib/flow/flow-authoring.mjs
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md §1, §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFlowProposeRequest } from '../lib/flow/flow-authoring.mjs';
import { createProposal, listProposals } from '../hub/proposals-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-authoring-parity');
const starterDir = path.join(getRepoRoot(), 'flows/starter');

function loadStarter(name) {
  return JSON.parse(fs.readFileSync(path.join(starterDir, name), 'utf8'));
}

function stripVolatile(payload) {
  const copy = structuredClone(payload);
  delete copy.proposal_id;
  return copy;
}

describe('Flow authoring — triple-surface parity', () => {
  const bundle = loadStarter('flow_capture_to_note.json');

  function freshDataDir(name) {
    const d = path.join(tmpRoot, name);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.FLOW_AUTHORING_WRITES = '1';
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_AUTHORING_WRITES;
  });

  it('Hub, CLI, and MCP produce a deep-equal envelope for the same authorized request', async () => {
    const hubDir = freshDataDir('hub');
    const cliDir = freshDataDir('cli');
    const mcpDir = freshDataDir('mcp');

    const hub = await handleFlowProposeRequest({
      dataDir: hubDir, vaultId: 'default', userId: 'u-hub', role: 'admin',
      kind: 'new', flow: bundle.flow, steps: bundle.steps, intent: 'add it', createProposal,
    });
    const cli = await handleFlowProposeRequest({
      dataDir: cliDir, vaultId: 'default', cliScopes: ['personal', 'project', 'org'],
      kind: 'new', flow: bundle.flow, steps: bundle.steps, intent: 'add it', createProposal,
    });
    const mcp = await handleFlowProposeRequest({
      dataDir: mcpDir, vaultId: 'default', cliScopes: ['personal', 'project', 'org'],
      kind: 'new', flow: bundle.flow, steps: bundle.steps, intent: 'add it', createProposal,
    });

    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(stripVolatile(hub.payload), stripVolatile(cli.payload));
    assert.deepEqual(stripVolatile(cli.payload), stripVolatile(mcp.payload));
  });

  it('each surface creates exactly one /proposals record (source flow)', async () => {
    const dir = freshDataDir('one-record');
    await handleFlowProposeRequest({
      dataDir: dir, vaultId: 'default', role: 'admin', kind: 'new',
      flow: bundle.flow, steps: bundle.steps, intent: 'add it', createProposal,
    });
    const { proposals, total } = listProposals(dir, { source: 'flow' });
    assert.equal(total, 1);
    assert.equal(proposals[0].source, 'flow');
    assert.equal(proposals[0].status, 'proposed');
    assert.equal(proposals[0].flow_meta.kind, 'new');
  });

  it('FLOW_AUTHORING_WRITES=off ⇒ all three return FLOW_AUTHORING_DISABLED', async () => {
    delete process.env.FLOW_AUTHORING_WRITES;
    const dir = freshDataDir('off');
    for (const ctx of [
      { role: 'admin' },
      { cliScopes: ['personal', 'project', 'org'] },
      { cliScopes: ['personal', 'project', 'org'] },
    ]) {
      const r = await handleFlowProposeRequest({
        dataDir: dir, vaultId: 'default', ...ctx, kind: 'new',
        flow: bundle.flow, steps: bundle.steps, intent: 'add it', createProposal,
      });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'FLOW_AUTHORING_DISABLED');
    }
    assert.equal(listProposals(dir, { source: 'flow' }).total, 0);
  });
});

describe('Flow authoring — Hub route wiring contract (source match)', () => {
  it('registers the three POST routes gated by FLOW_AUTHORING_WRITE_ROLES', async () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /app\.post\('\/api\/v1\/flows', FLOW_AUTHORING_WRITE_ROLES/);
    assert.match(src, /app\.post\('\/api\/v1\/flows\/:id\/proposals', FLOW_AUTHORING_WRITE_ROLES/);
    assert.match(src, /app\.post\('\/api\/v1\/flows\/import', FLOW_AUTHORING_WRITE_ROLES/);
    assert.match(src, /handleFlowProposeRequest/);
  });

  it('approve handler skips the note check for flow proposals and reconciles the index', async () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /proposal\.source !== FLOW_PROPOSAL_SOURCE/);
    assert.match(src, /precheckApprovedFlowProposal\(config\.data_dir, proposal\)/);
    assert.match(src, /applyFlowProposalToIndex\(/);
  });
});
