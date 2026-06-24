/**
 * Tier 6 — PERFORMANCE: list/get p95 budget on 500-task fixture.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTasks, getTask, MAX_TASK_SUMMARIES } from '../lib/task/task-store.mjs';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-performance');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Task store — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const tasks = [];
    for (let i = 0; i < MAX_TASK_SUMMARIES; i += 1) {
      const id = `task_perf_${String(i).padStart(6, '0')}`;
      tasks.push({
        schema: 'knowtation.task/v0',
        task_id: id,
        kind: 'personal',
        scope: i % 3 === 0 ? 'org' : i % 2 === 0 ? 'project' : 'personal',
        status: 'pending',
        title: id,
        workspace_id: 'ws-personal',
        due_at: i % 7 === 0 ? null : `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        assignee_ref: null,
        assigner_ref: null,
        run_ref: null,
        artifact_links: [],
        created: '2026-06-01T00:00:00Z',
        updated: '2026-06-01T00:00:00Z',
        truncated: false,
      });
    }
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: { flows: [], steps: [], runs: [], candidates: [], projections: [], tasks },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listTasks and getTask stay within p95 budget', () => {
    const listTimes = [];
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now();
      listTasks(dataDir, vaultId, {
        filterScopes: new Set(['personal', 'project', 'org']),
        effectiveScope: 'org',
        workspaceId: i % 2 === 0 ? 'ws-personal' : undefined,
        limit: MAX_TASK_SUMMARIES,
      });
      listTimes.push(performance.now() - t0);
    }

    const getTimes = [];
    for (let i = 0; i < 40; i += 1) {
      const id = `task_perf_${String(i * 12).padStart(6, '0')}`;
      const t0 = performance.now();
      getTask(dataDir, vaultId, id, {
        visibleScopes: new Set(['personal', 'project', 'org']),
      });
      getTimes.push(performance.now() - t0);
    }

    const listP95 = percentile(listTimes, 95);
    const getP95 = percentile(getTimes, 95);
    assert.ok(listP95 < 200, `listTasks p95 ${listP95}ms exceeds budget`);
    assert.ok(getP95 < 50, `getTask p95 ${getP95}ms exceeds budget`);
  });
});
