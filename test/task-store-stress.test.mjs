/**
 * Tier 4 — STRESS: list cap at MAX_TASK_SUMMARIES with truncated flag.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTasks, MAX_TASK_SUMMARIES } from '../lib/task/task-store.mjs';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-stress');

describe('Task store — stress', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const tasks = [];
    for (let i = 0; i < MAX_TASK_SUMMARIES; i += 1) {
      const id = `task_stress_${String(i).padStart(6, '0')}`;
      tasks.push({
        schema: 'knowtation.task/v0',
        task_id: id,
        kind: 'personal',
        scope: 'personal',
        status: 'pending',
        title: id,
        workspace_id: 'ws-personal',
        due_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
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

  it('list returns MAX_TASK_SUMMARIES rows with truncated:true when capped', () => {
    const result = listTasks(dataDir, vaultId, {
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      limit: MAX_TASK_SUMMARIES - 1,
    });
    assert.equal(result.tasks.length, MAX_TASK_SUMMARIES - 1);
    assert.equal(result.truncated, true);
  });

  it('list at exact cap is not truncated', () => {
    const result = listTasks(dataDir, vaultId, {
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
      limit: MAX_TASK_SUMMARIES,
    });
    assert.equal(result.tasks.length, MAX_TASK_SUMMARIES);
    assert.equal(result.truncated, false);
  });
});
