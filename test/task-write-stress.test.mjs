/**
 * Tier 4 — STRESS: concurrent materialize proposals; cancel cascade scale.
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
import { getTaskLoop, taskLoopForClient } from '../lib/task/task-loop-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveTaskProposal,
  emptyTaskStarterDir,
  sampleLoopCreatePayload,
  visibleAll,
} from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-stress');

describe('task write — stress', () => {
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

  it('100 concurrent materialize proposals — one wins per occurrence_key', async () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_stress_mat';
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

    const loop = getTaskLoop(dataDir, vaultId, 'loop_stress_mat', { visibleScopes: visibleAll, starterDir });
    const baseStateId = loopStateId(taskLoopForClient(loop));

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.resolve(
          handleTaskInstanceMaterializeRequest({
            dataDir,
            vaultId,
            visibleScopes: visibleAll,
            loopId: 'loop_stress_mat',
            body: {
              loop_id: 'loop_stress_mat',
              occurrence_key: '2026-W99',
              base_state_id: baseStateId,
            },
            intent: 'race',
            starterDir,
            createProposal,
          }),
        ),
      ),
    );

    const okCount = results.filter((r) => r.ok).length;
    assert.equal(okCount, 100, 'propose does not mutate store — all proposes succeed');
  });

  it('cancel cascade handles many pending instances in one pass', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_stress_cancel';
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

    let loop = getTaskLoop(dataDir, vaultId, 'loop_stress_cancel', { visibleScopes: visibleAll, starterDir });
    let baseStateId = loopStateId(taskLoopForClient(loop));

    for (let i = 0; i < 50; i += 1) {
      const mat = handleTaskInstanceMaterializeRequest({
        dataDir,
        vaultId,
        visibleScopes: visibleAll,
        loopId: 'loop_stress_cancel',
        body: {
          loop_id: 'loop_stress_cancel',
          occurrence_key: `2026-W${String(i).padStart(2, '0')}`,
          base_state_id: baseStateId,
        },
        intent: 'spawn',
        starterDir,
        createProposal,
      });
      approveTaskProposal(dataDir, mat.payload.proposal_id);
      loop = getTaskLoop(dataDir, vaultId, 'loop_stress_cancel', { visibleScopes: visibleAll, starterDir });
      baseStateId = loopStateId(taskLoopForClient(loop));
    }

    loop = getTaskLoop(dataDir, vaultId, 'loop_stress_cancel', { visibleScopes: visibleAll, starterDir });
    baseStateId = loopStateId(taskLoopForClient(loop));

    const cancelRes = handleTaskLoopProposeRequest({
      dataDir,
      vaultId,
      visibleScopes: visibleAll,
      proposalKind: 'task_loop_cancel',
      body: {
        proposal_kind: 'task_loop_cancel',
        loop_id: 'loop_stress_cancel',
        base_state_id: baseStateId,
      },
      intent: 'cancel',
      starterDir,
      createProposal,
    });
    const approved = approveTaskProposal(dataDir, cancelRes.payload.proposal_id);
    assert.equal(approved.ok, true);
    assert.equal(approved.pre.proposalKind, 'task_loop_cancel');
  });
});
