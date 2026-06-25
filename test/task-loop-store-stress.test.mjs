/**
 * Tier 4 — STRESS: Large instance filter and list caps.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';
import { listTaskLoops, MAX_TASK_LOOP_SUMMARIES } from '../lib/task/task-loop-store.mjs';
import { listTasks } from '../lib/task/task-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-stress');
const vaultId = 'vault-loop-stress';

describe('Task loop store — stress', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listTaskLoops caps at MAX_TASK_LOOP_SUMMARIES with truncated flag', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const loops = [];
    for (let i = 0; i < MAX_TASK_LOOP_SUMMARIES + 50; i += 1) {
      loops.push({
        schema: 'knowtation.task_loop/v0',
        loop_id: `loop_stress_${String(i).padStart(4, '0')}`,
        kind: 'personal',
        scope: 'personal',
        status: 'active',
        title: `Stress loop ${i}`,
        workspace_id: 'ws-personal',
        recurrence: { kind: 'manual' },
        timezone: 'UTC',
        flow_id: null,
        boundary_policy: 'observe_only',
        memory_links: [],
        created: '2026-06-01T00:00:00Z',
        updated: '2026-06-01T00:00:00Z',
        truncated: false,
      });
    }

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks: [],
          task_loops: loops,
          orchestrator_graphs: [],
        },
      },
    });

    const result = listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      limit: MAX_TASK_LOOP_SUMMARIES,
    });

    assert.equal(result.loops.length, MAX_TASK_LOOP_SUMMARIES);
    assert.equal(result.truncated, true);
  });

  it('listTasks filters 500 loop instances by loop_ref efficiently', () => {
    const dataDir = path.join(tmpRoot, 'data-instances');
    fs.mkdirSync(dataDir, { recursive: true });

    const tasks = [];
    for (let i = 0; i < 500; i += 1) {
      tasks.push({
        schema: 'knowtation.task/v0',
        task_id: `task_loop_inst_${String(i).padStart(4, '0')}`,
        kind: 'personal',
        scope: 'personal',
        status: 'pending',
        title: `Instance ${i}`,
        workspace_id: 'ws-personal',
        due_at: null,
        run_ref: null,
        loop_ref: 'loop_school_trip',
        occurrence_key: `2026-W${String(i % 52).padStart(2, '0')}`,
        occurrence_at: null,
        series_status_snapshot: 'active',
        artifact_links: [],
        created: '2026-06-01T00:00:00Z',
        updated: '2026-06-01T00:00:00Z',
        truncated: false,
      });
    }

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks,
          task_loops: [],
          orchestrator_graphs: [],
        },
      },
    });

    const result = listTasks(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      loopRef: 'loop_school_trip',
    });

    assert.equal(result.tasks.length, 500);
  });
});
