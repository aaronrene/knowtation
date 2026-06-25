/**
 * Tier 1 — UNIT: taskStateId/loopStateId, gating, kind routing.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  taskStateId,
  loopStateId,
  absentTaskStateId,
  absentLoopStateId,
  getTaskWritesEnabled,
  handleTaskProposeRequest,
  computeMaterializeTaskId,
  computeLazyOccurrenceKey,
  TASK_STATE_ID_PREFIX,
  LOOP_STATE_ID_PREFIX,
  TASK_PROPOSAL_SCHEMA,
} from '../lib/task/task-write.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { sampleTaskCreatePayload } from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-unit');

describe('taskStateId / loopStateId — deterministic tokens', () => {
  it('taskStateId is stable and prefixed', () => {
    const task = {
      schema: 'knowtation.task/v0',
      task_id: 'task_x',
      kind: 'personal',
      scope: 'personal',
      status: 'pending',
      title: 'T',
      workspace_id: 'ws',
      due_at: null,
      assignee_ref: null,
      assigner_ref: null,
      run_ref: null,
      loop_ref: null,
      occurrence_key: null,
      occurrence_at: null,
      series_status_snapshot: null,
      skip_reason: null,
      artifact_links: [],
    };
    const a = taskStateId(task);
    assert.equal(a, taskStateId(task));
    assert.ok(a.startsWith(TASK_STATE_ID_PREFIX));
  });

  it('absent sentinels are stable', () => {
    assert.equal(absentTaskStateId(), absentTaskStateId());
    assert.equal(absentLoopStateId(), absentLoopStateId());
    assert.ok(absentLoopStateId().startsWith(LOOP_STATE_ID_PREFIX));
  });

  it('computeMaterializeTaskId matches school-trip fixture shape', () => {
    const r = computeMaterializeTaskId('loop_school_trip', '2026-W25');
    assert.equal(r.ok, true);
    assert.equal(r.taskId, 'task_school_trip_2026_w25');
  });
});

describe('gating — TASK_WRITES_ENABLED default OFF', () => {
  const dataDir = path.join(tmpRoot, 'gate');
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.TASK_WRITES_ENABLED;
  });
  afterEach(() => {
    delete process.env.TASK_WRITES_ENABLED;
  });

  it('defaults disabled', () => {
    assert.equal(getTaskWritesEnabled(dataDir), false);
  });

  it('disabled propose returns TASK_WRITES_DISABLED', () => {
    const result = handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      proposalKind: 'task_create',
      body: sampleTaskCreatePayload(),
      intent: 'test',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TASK_WRITES_DISABLED');
  });

  it('enabled via env proposes envelope shape', () => {
    process.env.TASK_WRITES_ENABLED = '1';
    const result = handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      proposalKind: 'task_create',
      body: sampleTaskCreatePayload(),
      intent: 'test',
      createProposal,
    });
    assert.equal(result.ok, true);
    assert.equal(result.payload.schema, TASK_PROPOSAL_SCHEMA);
    assert.equal(result.payload.auto_approvable, false);
    assert.equal(result.payload.review_queue, 'task-writes');
  });
});

describe('computeLazyOccurrenceKey — manual recurrence', () => {
  it('increments manual-N keys', () => {
    const loop = { recurrence: { kind: 'manual' } };
    const keys = new Set(['manual-1']);
    assert.equal(computeLazyOccurrenceKey(loop, keys), 'manual-2');
  });
});
