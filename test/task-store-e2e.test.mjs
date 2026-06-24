/**
 * Tier 3 — E2E: empty vault seed walkthrough and scope-filtered list/get.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTaskListRequest, handleTaskGetRequest } from '../lib/task/task-handlers.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-e2e');
const starterDir = path.join(getRepoRoot(), 'tasks/starter');

describe('E2E — Task read walkthrough', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('empty vault → first list seeds four starters → get handover returns two artifact links', () => {
    const list = handleTaskListRequest({
      dataDir,
      vaultId,
      role: 'admin',
      starterDir,
    });
    assert.equal(list.ok, true);
    assert.equal(list.payload.tasks.length, 4);

    const got = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_2g_handover_001',
      role: 'admin',
      starterDir,
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.task.artifact_links.length, 2);
    assert.equal(got.payload.task.run_ref, 'run_overseer_in_progress');
  });

  it('list --scope personal returns exactly one task', () => {
    handleTaskListRequest({ dataDir, vaultId, role: 'admin', starterDir });
    const personal = handleTaskListRequest({
      dataDir,
      vaultId,
      role: 'admin',
      scope: 'personal',
      starterDir,
    });
    assert.equal(personal.ok, true);
    assert.equal(personal.payload.tasks.length, 1);
    assert.equal(personal.payload.tasks[0].task_id, 'task_personal_practice');
  });
});
