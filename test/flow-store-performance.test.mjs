/**
 * Tier 6 — PERFORMANCE: list/get p95 budget on large fixture.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  saveFlowStore,
  listFlows,
  getFlow,
  MAX_FLOW_SUMMARIES,
  buildFlowStepId,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-performance');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Flow store — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const flows = [];
    const steps = [];
    for (let i = 0; i < MAX_FLOW_SUMMARIES; i += 1) {
      const id = `flow_perf_${String(i).padStart(3, '0')}`;
      flows.push({
        schema: 'knowtation.flow/v0',
        flow_id: id,
        title: id,
        version: '1.0.0',
        scope: i % 3 === 0 ? 'org' : i % 2 === 0 ? 'project' : 'personal',
        summary: 'perf',
        tags: i % 5 === 0 ? ['tagged'] : [],
        steps: [buildFlowStepId(id, 1)],
        updated: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        truncated: false,
      });
      steps.push({
        schema: 'knowtation.flow_step/v0',
        step_id: buildFlowStepId(id, 1),
        flow_id: id,
        ordinal: 1,
        owned_job: 'j',
        instruction: 'i',
        trigger: 't',
        when_not_to_run: 'n',
        boundaries: [],
        output_shape: 'o',
        verification: { kind: 'human_review', evidence_required: false, description: 'd' },
        automatable: 'manual',
      });
    }
    saveFlowStore(dataDir, { vaults: { [vaultId]: { flows, steps, runs: [], candidates: [], projections: [] } } });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listFlows and getFlow stay within p95 budget', () => {
    const listTimes = [];
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now();
      listFlows(dataDir, vaultId, {
        filterScopes: new Set(['personal', 'project', 'org']),
        effectiveScope: 'org',
        tag: i % 2 === 0 ? 'tagged' : undefined,
        limit: 200,
      });
      listTimes.push(performance.now() - t0);
    }
    const getTimes = [];
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now();
      getFlow(dataDir, vaultId, `flow_perf_${String(i).padStart(3, '0')}`, {
        filterScopes: new Set(['personal', 'project', 'org']),
      });
      getTimes.push(performance.now() - t0);
    }
    const listP95 = percentile(listTimes, 95);
    const getP95 = percentile(getTimes, 95);
    assert.ok(listP95 < 150, `listFlows p95 ${listP95}ms`);
    assert.ok(getP95 < 50, `getFlow p95 ${getP95}ms`);
  });
});
