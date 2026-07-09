/**
 * Tier 4 — STRESS: many runs list/get stays bounded (P-FLOW).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadFlowStore,
  saveFlowStore,
  listFlowRuns,
  getFlowRun,
  runForClient,
  MAX_FLOW_RUNS_LIST,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-stress');

describe('Flow run store — stress', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('list caps at MAX_FLOW_RUNS_LIST with truncated flag', () => {
    const dataDir = path.join(tmpRoot, 'many');
    fs.mkdirSync(dataDir);
    const vaultId = 'default';
    const store = loadFlowStore(dataDir);
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
    for (let i = 0; i < MAX_FLOW_RUNS_LIST + 25; i += 1) {
      store.vaults[vaultId].runs.push({
        schema: 'knowtation.flow_run/v0',
        run_id: `run_stress_${i}`,
        run_ref: `flow_run:run_stress_${i}`,
        flow_id: 'flow_overseer_handover',
        flow_version: '0.1.0',
        scope: 'project',
        status: 'in_progress',
        step_states: [],
        started: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        provenance: { actor: 'b'.repeat(64), harness: 'stress' },
      });
    }
    saveFlowStore(dataDir, store);

    const scopes = new Set(['project', 'org']);
    const list = listFlowRuns(dataDir, vaultId, {
      visibleScopes: scopes,
      filterScopes: scopes,
      effectiveScope: 'project',
    });
    assert.equal(list.runs.length, MAX_FLOW_RUNS_LIST);
    assert.equal(list.truncated, true);

    const deepStates = Array.from({ length: 50 }, (_, j) => ({
      step_id: `flow_overseer_handover#${j + 1}`,
      status: 'pending',
      evidence_ref: null,
      verified: false,
    }));
    const deepRun = store.vaults[vaultId].runs[0];
    deepRun.step_states = deepStates;
    saveFlowStore(dataDir, store);
    const got = getFlowRun(dataDir, vaultId, deepRun.run_ref, { visibleScopes: scopes });
    assert.ok(got);
    assert.equal(got.run.step_states.length, 50);
    assert.doesNotThrow(() => JSON.stringify(got.run.step_states.map(runForClient)));
  });
});
