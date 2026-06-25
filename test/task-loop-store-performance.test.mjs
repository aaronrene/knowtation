/**
 * Tier 6 — PERFORMANCE: list/get p95 budget on loop fixtures.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { listTaskLoops, getTaskLoop } from '../lib/task/task-loop-store.mjs';
import { listTasks } from '../lib/task/task-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-perf');
const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');
const instancesDir = path.join(getRepoRoot(), 'task-loops/starter/instances');
const vaultId = 'vault-loop-perf';

/** p95 budget ms for loop list/get on fixture graph. */
const P95_BUDGET_MS = 50;

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Task loop store — performance', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listTaskLoops and getTaskLoop stay within p95 budget on school-trip fixtures', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const listSamples = [];
    const getSamples = [];

    for (let i = 0; i < 100; i += 1) {
      const t0 = performance.now();
      listTaskLoops(dataDir, vaultId, {
        visibleScopes: new Set(['personal']),
        filterScopes: new Set(['personal']),
        effectiveScope: 'personal',
        starterDir: loopStarterDir,
        graphsDir: graphStarterDir,
        instancesDir,
      });
      listSamples.push(performance.now() - t0);

      const t1 = performance.now();
      getTaskLoop(dataDir, vaultId, 'loop_school_trip', {
        visibleScopes: new Set(['personal']),
        starterDir: loopStarterDir,
        graphsDir: graphStarterDir,
        instancesDir,
      });
      getSamples.push(performance.now() - t1);
    }

    assert.ok(p95(listSamples) < P95_BUDGET_MS, `list p95 ${p95(listSamples)}ms`);
    assert.ok(p95(getSamples) < P95_BUDGET_MS, `get p95 ${p95(getSamples)}ms`);
  });

  it('listTasks with loop_ref filter stays within p95 on seeded instance', () => {
    const dataDir = path.join(tmpRoot, 'data-filter');
    fs.mkdirSync(dataDir, { recursive: true });

    listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    const samples = [];
    for (let i = 0; i < 100; i += 1) {
      const t0 = performance.now();
      listTasks(dataDir, vaultId, {
        visibleScopes: new Set(['personal']),
        filterScopes: new Set(['personal']),
        effectiveScope: 'personal',
        loopRef: 'loop_school_trip',
        starterDir: instancesDir,
      });
      samples.push(performance.now() - t0);
    }

    assert.ok(p95(samples) < P95_BUDGET_MS, `filter p95 ${p95(samples)}ms`);
  });
});
