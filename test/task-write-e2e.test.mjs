/**
 * Tier 3 — E2E: loop create → approve → materialize → get; pause blocks; cancel cascades.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleTaskLoopProposeRequest,
  handleTaskInstanceMaterializeRequest,
  loopStateId,
} from '../lib/task/task-write.mjs';
import { getTask } from '../lib/task/task-store.mjs';
import { getTaskLoop, taskLoopForClient } from '../lib/task/task-loop-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveTaskProposal,
  emptyTaskStarterDir,
  sampleLoopCreatePayload,
  visibleAll,
} from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-e2e');

describe('task write — e2e lifecycle', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyTaskStarterDir(dataDir);
    process.env.TASK_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.TASK_WRITES_ENABLED;
  });

  it('loop create → approve → materialize → get instance with loop_ref/occurrence_key', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_e2e_trip';
    const proposed = handleTaskLoopProposeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      proposalKind: 'task_loop_create',
      body: payload,
      intent: 'create series',
      starterDir,
      createProposal,
    });
    assert.equal(proposed.ok, true);
    assert.equal(approveTaskProposal(dataDir, proposed.payload.proposal_id).ok, true);

    const loop = getTaskLoop(dataDir, vaultId, 'loop_e2e_trip', { visibleScopes: visibleAll, starterDir });
    assert.ok(loop);
    const baseStateId = loopStateId(taskLoopForClient(loop));

    const mat = handleTaskInstanceMaterializeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      loopId: 'loop_e2e_trip',
      body: { loop_id: 'loop_e2e_trip', occurrence_key: '2026-W25', base_state_id: baseStateId },
      intent: 'spawn',
      starterDir,
      createProposal,
    });
    assert.equal(mat.ok, true);
    assert.equal(approveTaskProposal(dataDir, mat.payload.proposal_id).ok, true);

    const task = getTask(dataDir, vaultId, mat.payload.task_id, { visibleScopes: visibleAll, starterDir });
    assert.ok(task);
    assert.equal(task.loop_ref, 'loop_e2e_trip');
    assert.equal(task.occurrence_key, '2026-W25');
    assert.equal(task.run_ref, null);
  });

  it('pause blocks materialize propose', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_e2e_pause';
    const createRes = handleTaskLoopProposeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      proposalKind: 'task_loop_create',
      body: payload,
      intent: 'create',
      starterDir,
      createProposal,
    });
    approveTaskProposal(dataDir, createRes.payload.proposal_id);

    const loop = getTaskLoop(dataDir, vaultId, 'loop_e2e_pause', { visibleScopes: visibleAll, starterDir });
    const baseStateId = loopStateId(taskLoopForClient(loop));

    const pauseRes = handleTaskLoopProposeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      proposalKind: 'task_loop_pause',
      body: { proposal_kind: 'task_loop_pause', loop_id: 'loop_e2e_pause', base_state_id: baseStateId },
      intent: 'pause',
      starterDir,
      createProposal,
    });
    approveTaskProposal(dataDir, pauseRes.payload.proposal_id);

    const mat = handleTaskInstanceMaterializeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      loopId: 'loop_e2e_pause',
      body: { loop_id: 'loop_e2e_pause', occurrence_key: '2026-W26' },
      intent: 'spawn',
      starterDir,
      createProposal,
    });
    assert.equal(mat.ok, false);
    assert.equal(mat.code, 'TASK_LOOP_NOT_ACTIVE');
  });

  it('cancel cascades pending instances atomically', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_e2e_cancel';
    approveTaskProposal(
      dataDir,
      handleTaskLoopProposeRequest({
        dataDir,
        vaultId,
        visibleScopes: visibleAll,
        proposalKind: 'task_loop_create',
        body: payload,
        intent: 'create',
        starterDir,
        createProposal,
      }).payload.proposal_id,
    );

    let loop = getTaskLoop(dataDir, vaultId, 'loop_e2e_cancel', { visibleScopes: visibleAll, starterDir });
    let baseStateId = loopStateId(taskLoopForClient(loop));

    const mat = handleTaskInstanceMaterializeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      loopId: 'loop_e2e_cancel',
      body: { loop_id: 'loop_e2e_cancel', occurrence_key: '2026-W25', base_state_id: baseStateId },
      intent: 'spawn',
      starterDir,
      createProposal,
    });
    approveTaskProposal(dataDir, mat.payload.proposal_id);

    loop = getTaskLoop(dataDir, vaultId, 'loop_e2e_cancel', { visibleScopes: visibleAll, starterDir });
    baseStateId = loopStateId(taskLoopForClient(loop));

    const cancelRes = handleTaskLoopProposeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      proposalKind: 'task_loop_cancel',
      body: { proposal_kind: 'task_loop_cancel', loop_id: 'loop_e2e_cancel', base_state_id: baseStateId },
      intent: 'cancel series',
      starterDir,
      createProposal,
    });
    const approved = approveTaskProposal(dataDir, cancelRes.payload.proposal_id);
    assert.equal(approved.ok, true);

    const task = getTask(dataDir, vaultId, mat.payload.task_id, { visibleScopes: visibleAll, starterDir });
    assert.equal(task.status, 'cancelled');
    assert.equal(task.skip_reason, 'series_cancelled');
  });
});
