/**
 * Tier 6 — PERFORMANCE: list/get p95 budget on large run fixture (P-FLOW).
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
  MAX_FLOW_RUNS_LIST,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-perf');

const P95_BUDGET_MS = 250;

describe('Flow run store — performance', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listFlowRuns and getFlowRun complete within p95 budget', () => {
    const dataDir = path.join(tmpRoot, 'perf');
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
    for (let i = 0; i < MAX_FLOW_RUNS_LIST; i += 1) {
      store.vaults[vaultId].runs.push({
        schema: 'knowtation.flow_run/v0',
        run_id: `run_perf_${i}`,
        run_ref: `flow_run:run_perf_${i}`,
        flow_id: 'flow_overseer_handover',
        flow_version: '0.1.0',
        scope: 'project',
        status: 'in_progress',
        step_states: [{ step_id: 'flow_overseer_handover#1', status: 'pending', verified: false }],
        started: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        provenance: { actor: 'd'.repeat(64), harness: 'perf' },
      });
    }
    saveFlowStore(dataDir, store);

    const scopes = new Set(['project', 'org']);
    const listSamples = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      listFlowRuns(dataDir, vaultId, {
        visibleScopes: scopes,
        filterScopes: scopes,
        effectiveScope: 'project',
        flowId: 'flow_overseer_handover',
      });
      listSamples.push(performance.now() - t0);
    }
    listSamples.sort((a, b) => a - b);
    const listP95 = listSamples[Math.floor(listSamples.length * 0.95)] ?? listSamples.at(-1);
    assert.ok(listP95 < P95_BUDGET_MS, `list p95 ${listP95}ms exceeds ${P95_BUDGET_MS}ms`);

    const getSamples = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      getFlowRun(dataDir, vaultId, 'flow_run:run_perf_42', { visibleScopes: scopes });
      getSamples.push(performance.now() - t0);
    }
    getSamples.sort((a, b) => a - b);
    const getP95 = getSamples[Math.floor(getSamples.length * 0.95)] ?? getSamples.at(-1);
    assert.ok(getP95 < P95_BUDGET_MS, `get p95 ${getP95}ms exceeds ${P95_BUDGET_MS}ms`);
  });
});
