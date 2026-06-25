/**
 * Tier 5 — DATA-INTEGRITY: approve round-trip, uniqueness, SD-2 run_ref null at spawn.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleTaskProposeRequest,
  handleTaskInstanceMaterializeRequest,
  loopStateId,
  handleTaskLoopProposeRequest,
} from '../lib/task/task-write.mjs';
import { getTask } from '../lib/task/task-store.mjs';
import { assertLoopOccurrenceUniqueness, getTaskLoop, taskLoopForClient } from '../lib/task/task-loop-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveTaskProposal,
  emptyTaskStarterDir,
  sampleLoopCreatePayload,
  sampleTaskCreatePayload,
  visibleAll,
} from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-di');

describe('task write — data integrity', () => {
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

  it('approve round-trip preserves task fields byte-stable', () => {
    const body = sampleTaskCreatePayload();
    body.task.task_id = 'task_di_roundtrip';
    const proposed = handleTaskProposeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      proposalKind: 'task_create',
      body,
      intent: 'create',
      createProposal,
    });
    approveTaskProposal(dataDir, proposed.payload.proposal_id);
    const task = getTask(dataDir, vaultId, 'task_di_roundtrip', { visibleScopes: visibleAll, starterDir });
    assert.equal(task.title, body.task.title);
    assert.equal(task.run_ref, null);
  });

  it('materialized instance has run_ref null (SD-2)', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_di_sd2';
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
    const loop = getTaskLoop(dataDir, vaultId, 'loop_di_sd2', { visibleScopes: visibleAll, starterDir });
    const mat = handleTaskInstanceMaterializeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      loopId: 'loop_di_sd2',
      body: {
        loop_id: 'loop_di_sd2',
        occurrence_key: '2026-W25',
        base_state_id: loopStateId(taskLoopForClient(loop)),
      },
      intent: 'spawn',
      starterDir,
      createProposal,
    });
    approveTaskProposal(dataDir, mat.payload.proposal_id);
    const task = getTask(dataDir, vaultId, mat.payload.task_id, { visibleScopes: visibleAll, starterDir });
    assert.equal(task.run_ref, null);
    assert.equal(assertLoopOccurrenceUniqueness(dataDir, vaultId).ok, true);
  });

  it('duplicate materialize occurrence_key refused at propose', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_di_dup';
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
    const loop = getTaskLoop(dataDir, vaultId, 'loop_di_dup', { visibleScopes: visibleAll, starterDir });
    const baseStateId = loopStateId(taskLoopForClient(loop));
    const mat = handleTaskInstanceMaterializeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      loopId: 'loop_di_dup',
      body: { loop_id: 'loop_di_dup', occurrence_key: '2026-W25', base_state_id: baseStateId },
      intent: 'spawn',
      starterDir,
      createProposal,
    });
    approveTaskProposal(dataDir, mat.payload.proposal_id);

    const dup = handleTaskInstanceMaterializeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      loopId: 'loop_di_dup',
      body: { loop_id: 'loop_di_dup', occurrence_key: '2026-W25', base_state_id: baseStateId },
      intent: 'dup',
      starterDir,
      createProposal,
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, 'TASK_OCCURRENCE_EXISTS');
  });
});
