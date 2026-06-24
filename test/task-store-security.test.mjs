/**
 * Tier 7 — SECURITY: scope denial, no existence leak, injection inert, no secrets.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTaskListRequest, handleTaskGetRequest } from '../lib/task/task-handlers.mjs';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';
import { seedStarterTasks, validateTaskRecord } from '../lib/task/task-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-security');
const starterDir = path.join(getRepoRoot(), 'tasks/starter');

const SECRET_MARKERS = ['refresh_token', 'oauth_token', '"token":'];

describe('Task store — security', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    seedStarterTasks(dataDir, vaultId, { starterDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('personal visibleScopes never returns project/org tasks on list', () => {
    const list = handleTaskListRequest({
      dataDir,
      vaultId,
      visibleScopes: new Set(['personal']),
      starterDir,
    });
    assert.equal(list.ok, true);
    assert.ok(list.payload.tasks.every((t) => t.scope === 'personal'));
    assert.equal(list.payload.tasks.length, 1);
  });

  it('getTask for out-of-scope id returns 404 unknown_task (same as missing)', () => {
    const denied = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_org_compliance_q2',
      visibleScopes: new Set(['personal']),
      starterDir,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 404);
    assert.equal(denied.code, 'unknown_task');

    const missing = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_does_not_exist',
      visibleScopes: new Set(['personal']),
      starterDir,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'unknown_task');
  });

  it('malicious title returned as inert data; scope unchanged', () => {
    const maliciousTitle = 'DROP TABLE tasks; rm -rf /';
    const bundle = JSON.parse(
      fs.readFileSync(path.join(starterDir, 'task_personal_practice.json'), 'utf8'),
    );
    bundle.title = maliciousTitle;
    bundle.task_id = 'task_malicious_title';
    const validated = validateTaskRecord(bundle);
    assert.equal(validated.ok, true);

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks: [validated.task],
        },
      },
    });

    const got = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_malicious_title',
      visibleScopes: new Set(['personal']),
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.task.title, maliciousTitle);
    assert.equal(got.payload.task.scope, 'personal');
  });

  it('JSON.stringify of list/get contains no secret markers', () => {
    const list = handleTaskListRequest({
      dataDir,
      vaultId,
      role: 'admin',
      starterDir,
    });
    const got = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_2g_handover_001',
      role: 'admin',
      starterDir,
    });
    const listJson = JSON.stringify(list.payload);
    const getJson = JSON.stringify(got.payload);
    for (const marker of SECRET_MARKERS) {
      assert.ok(!listJson.includes(marker), `list leaked ${marker}`);
      assert.ok(!getJson.includes(marker), `get leaked ${marker}`);
    }
    assert.ok(!listJson.includes('assignee_ref'));
  });
});
