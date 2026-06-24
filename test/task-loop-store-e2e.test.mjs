/**
 * Tier 3 — E2E: School-trip fixture graph seed → instance task with loop_ref.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6 — I-T-LOOP-01
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { listTaskLoops } from '../lib/task/task-loop-store.mjs';
import { listTasks, getTask } from '../lib/task/task-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-e2e');
const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');
const instancesDir = path.join(getRepoRoot(), 'task-loops/starter/instances');
const vaultId = 'vault-loop-e2e';

describe('Task loop store — e2e school-trip graph', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('seeds loops + graph + instance; getTask returns loop_ref and occurrence_key', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const loopList = listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    assert.equal(loopList.loops.length, 5);
    assert.ok(loopList.loops.some((l) => l.loop_id === 'loop_school_trip'));

    const taskList = listTasks(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      loopRef: 'loop_school_trip',
      starterDir: instancesDir,
    });

    assert.equal(taskList.tasks.length, 1);
    assert.equal(taskList.tasks[0].task_id, 'task_school_trip_2026_w25');

    const task = getTask(dataDir, vaultId, 'task_school_trip_2026_w25', {
      visibleScopes: new Set(['personal']),
      starterDir: instancesDir,
    });

    assert.ok(task);
    assert.equal(task.loop_ref, 'loop_school_trip');
    assert.equal(task.occurrence_key, '2026-W25');
    assert.equal(task.run_ref, null);
  });
});
