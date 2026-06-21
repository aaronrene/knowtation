/**
 * Tier 5 — DATA INTEGRITY: starter round-trip and index source-of-truth.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  seedStarterFlows,
  getFlow,
  loadFlowStore,
  saveFlowStore,
} from '../lib/flow/flow-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-integrity');
const starterDir = path.join(getRepoRoot(), 'flows/starter');

describe('Flow store — data integrity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  const visible = new Set(['personal', 'project']);

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    seedStarterFlows(dataDir, vaultId, { starterDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('seed → getFlow preserves starter bundle fields byte-for-byte on key shapes', () => {
    const bundle = JSON.parse(
      fs.readFileSync(path.join(starterDir, 'flow_overseer_handover.json'), 'utf8'),
    );
    const got = getFlow(dataDir, vaultId, 'flow_overseer_handover', { filterScopes: visible });
    assert.ok(got);
    assert.equal(got.flow.flow_id, bundle.flow.flow_id);
    assert.equal(got.flow.version, bundle.flow.version);
    assert.equal(got.flow.scope, bundle.flow.scope);
    assert.equal(got.steps.length, bundle.steps.length);
    for (let i = 0; i < bundle.steps.length; i += 1) {
      assert.equal(got.steps[i].ordinal, bundle.steps[i].ordinal);
      assert.equal(got.steps[i].verification.kind, bundle.steps[i].verification.kind);
      assert.equal(got.steps[i].requires?.length ?? 0, bundle.steps[i].requires?.length ?? 0);
    }
  });

  it('done + evidence_required run step states keep verified:true invariant on read-only store', () => {
    const store = loadFlowStore(dataDir);
    store.vaults[vaultId].runs = [{
      schema: 'knowtation.flow_run/v0',
      run_id: 'run_integrity',
      flow_id: 'flow_overseer_handover',
      flow_version: '0.1.0',
      scope: 'project',
      status: 'in_progress',
      step_states: [{
        step_id: 'flow_overseer_handover#1',
        status: 'done',
        verified: true,
        evidence_ref: 'prop_abc',
      }],
      started: '2026-06-20T00:00:00Z',
      provenance: { actor: 'deadbeef', harness: 'test' },
    }];
    saveFlowStore(dataDir, store);
    const got = getFlow(dataDir, vaultId, 'flow_overseer_handover', { filterScopes: visible });
    assert.ok(got);
    const doneState = store.vaults[vaultId].runs[0].step_states[0];
    assert.equal(doneState.status, 'done');
    assert.equal(doneState.verified, true);
  });

  it('vault mirror path in index is returned but index remains authoritative', () => {
    const got = getFlow(dataDir, vaultId, 'flow_overseer_handover', { filterScopes: visible });
    assert.ok(got);
    assert.equal(got.flow.vault_mirror_path, 'meta/flows/overseer-handover.md');
    const store = loadFlowStore(dataDir);
    assert.equal(store.vaults[vaultId].flows.find((f) => f.flow_id === 'flow_overseer_handover')?.vault_mirror_path,
      'meta/flows/overseer-handover.md');
  });
});
