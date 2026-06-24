/**
 * Tier 5 — DATA INTEGRITY: SD-2 reciprocal link and starter round-trip.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getTask,
  seedStarterTasks,
  seedSd2AnchorRun,
  validateTaskRecord,
} from '../lib/task/task-store.mjs';
import { loadFlowStore } from '../lib/flow/flow-store.mjs';
import { handleTaskGetRequest } from '../lib/task/task-handlers.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-integrity');
const starterDir = path.join(getRepoRoot(), 'tasks/starter');

describe('Task store — data integrity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  const visible = new Set(['personal', 'project', 'org']);

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    seedStarterTasks(dataDir, vaultId, { starterDir });
    seedSd2AnchorRun(dataDir, vaultId);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('I-T-SD2-01: task.run_ref and run.task_ref are reciprocal on anchor pair', () => {
    const task = getTask(dataDir, vaultId, 'task_2g_handover_001', { visibleScopes: visible });
    assert.ok(task);
    assert.equal(task.run_ref, 'run_overseer_in_progress');

    const store = loadFlowStore(dataDir);
    const run = store.vaults[vaultId].runs.find((r) => r.run_id === 'run_overseer_in_progress');
    assert.ok(run);
    assert.equal(run.task_ref, 'task_2g_handover_001');
  });

  it('seed → get preserves starter bundle fields', () => {
    const bundle = JSON.parse(
      fs.readFileSync(path.join(starterDir, 'task_2g_handover_001.json'), 'utf8'),
    );
    const got = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_2g_handover_001',
      role: 'admin',
      starterDir,
    });
    assert.equal(got.ok, true);
    const task = got.payload.task;
    assert.equal(task.task_id, bundle.task_id);
    assert.equal(task.scope, bundle.scope);
    assert.equal(task.run_ref, bundle.run_ref);
    assert.equal(task.artifact_links.length, bundle.artifact_links.length);
  });

  it('artifact_links remain pointer-only (no body fields)', () => {
    const validated = validateTaskRecord(
      JSON.parse(fs.readFileSync(path.join(starterDir, 'task_2g_handover_001.json'), 'utf8')),
    );
    assert.equal(validated.ok, true);
    for (const link of validated.task.artifact_links) {
      assert.deepEqual(Object.keys(link).sort(), ['kind', 'ref']);
    }
  });
});
