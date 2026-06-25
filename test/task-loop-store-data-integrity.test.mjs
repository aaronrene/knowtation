/**
 * Tier 5 — DATA-INTEGRITY: loop_ref/occurrence_key uniqueness and SD-2 instance linkage.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6 — I-T-LOOP-01
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';
import {
  listTaskLoops,
  assertLoopOccurrenceUniqueness,
} from '../lib/task/task-loop-store.mjs';
import { getTask } from '../lib/task/task-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-integrity');
const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');
const instancesDir = path.join(getRepoRoot(), 'task-loops/starter/instances');
const vaultId = 'vault-loop-integrity';

describe('Task loop store — data integrity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('I-T-LOOP-01: loop_school_trip instance has reciprocal loop_ref and null run_ref until agent pass', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    const task = getTask(dataDir, vaultId, 'task_school_trip_2026_w25', {
      visibleScopes: new Set(['personal']),
      starterDir: instancesDir,
    });

    assert.ok(task);
    assert.equal(task.loop_ref, 'loop_school_trip');
    assert.equal(task.occurrence_key, '2026-W25');
    assert.equal(task.run_ref, null);
  });

  it('assertLoopOccurrenceUniqueness detects duplicate (loop_ref, occurrence_key)', () => {
    const dataDir = path.join(tmpRoot, 'dup');
    fs.mkdirSync(dataDir, { recursive: true });

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks: [
            {
              schema: 'knowtation.task/v0',
              task_id: 'task_dup_a',
              kind: 'personal',
              scope: 'personal',
              status: 'pending',
              title: 'Dup A',
              workspace_id: 'ws-personal',
              due_at: null,
              run_ref: null,
              loop_ref: 'loop_school_trip',
              occurrence_key: '2026-W25',
              artifact_links: [],
              created: '2026-06-01T00:00:00Z',
              updated: '2026-06-01T00:00:00Z',
              truncated: false,
            },
            {
              schema: 'knowtation.task/v0',
              task_id: 'task_dup_b',
              kind: 'personal',
              scope: 'personal',
              status: 'pending',
              title: 'Dup B',
              workspace_id: 'ws-personal',
              due_at: null,
              run_ref: null,
              loop_ref: 'loop_school_trip',
              occurrence_key: '2026-W25',
              artifact_links: [],
              created: '2026-06-01T00:00:00Z',
              updated: '2026-06-01T00:00:00Z',
              truncated: false,
            },
          ],
          task_loops: [],
          orchestrator_graphs: [],
        },
      },
    });

    const check = assertLoopOccurrenceUniqueness(dataDir, vaultId);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.equal(check.duplicate, 'loop_school_trip::2026-W25');
    }
  });

  it('memory_links on loop records remain pointer-only', () => {
    const dataDir = path.join(tmpRoot, 'pointers');
    fs.mkdirSync(dataDir, { recursive: true });

    listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    const store = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'hub_flow_store.json'), 'utf8'),
    );
    const loop = store.vaults[vaultId].task_loops.find((l) => l.loop_id === 'loop_school_trip');
    assert.ok(loop);
    for (const link of loop.memory_links) {
      assert.deepEqual(Object.keys(link).sort(), ['kind', 'ref']);
    }
  });
});
