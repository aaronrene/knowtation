/**
 * Tier 7 — SECURITY: scope denial, no widening, injection inert, no secrets, stale concurrency.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleTaskProposeRequest,
  handleTaskLoopProposeRequest,
  taskStateId,
  loopStateId,
} from '../lib/task/task-write.mjs';
import { getTask, taskForClient } from '../lib/task/task-store.mjs';
import { getTaskLoop, taskLoopForClient } from '../lib/task/task-loop-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  approveTaskProposal,
  emptyTaskStarterDir,
  sampleLoopCreatePayload,
  sampleTaskCreatePayload,
} from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-sec');

describe('task write — security', () => {
  const dataDir = path.join(tmpRoot, 'data');
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

  it('personal writer cannot create project-scoped task', () => {
    const body = sampleTaskCreatePayload();
    body.task.scope = 'project';
    body.task.workspace_id = 'ws_project';
    const result = handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      proposalKind: 'task_create',
      body,
      intent: 'widen',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TASK_SCOPE_DENIED');
  });

  it('assignment at project scope returns TASK_CLASSROOM_AUTHORITY_REQUIRED', () => {
    const body = sampleTaskCreatePayload();
    body.task.kind = 'assignment';
    body.task.scope = 'project';
    body.task.workspace_id = 'ws_project';
    const result = handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project'],
      proposalKind: 'task_create',
      body,
      intent: 'classroom',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TASK_CLASSROOM_AUTHORITY_REQUIRED');
  });

  it('out-of-scope task edit returns 404 unknown_task (no existence leak)', () => {
    const body = sampleTaskCreatePayload();
    body.task.task_id = 'task_sec_hidden';
    body.task.scope = 'org';
    approveTaskProposal(
      dataDir,
      handleTaskProposeRequest({
        dataDir,
        vaultId: 'default',
        cliScopes: ['personal', 'project', 'org'],
        proposalKind: 'task_create',
        body,
        intent: 'seed org task',
        createProposal,
      }).payload.proposal_id,
    );

    const result = handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      proposalKind: 'task_status_update',
      body: {
        proposal_kind: 'task_status_update',
        task_id: 'task_sec_hidden',
        base_state_id: 'taskst1_deadbeefdeadbeef',
        status: 'done',
      },
      intent: 'probe',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.code, 'unknown_task');
  });

  it('stale base_state_id on pause returns TASK_LOOP_LINEAGE_CONFLICT', () => {
    const payload = sampleLoopCreatePayload();
    payload.loop.loop_id = 'loop_sec_stale';
    approveTaskProposal(
      dataDir,
      handleTaskLoopProposeRequest({
        dataDir,
        vaultId: 'default',
        cliScopes: ['personal'],
        proposalKind: 'task_loop_create',
        body: payload,
        intent: 'create',
        starterDir,
        createProposal,
      }).payload.proposal_id,
    );

    const result = handleTaskLoopProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      proposalKind: 'task_loop_pause',
      body: {
        proposal_kind: 'task_loop_pause',
        loop_id: 'loop_sec_stale',
        base_state_id: 'loopst1_deadbeefdeadbeef',
      },
      intent: 'stale pause',
      starterDir,
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TASK_LOOP_LINEAGE_CONFLICT');
  });

  it('proposal JSON contains no token/oauth patterns', () => {
    const body = sampleTaskCreatePayload();
    body.task.title = '<script>alert(1)</script>';
    const result = handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      proposalKind: 'task_create',
      body,
      intent: 'Bearer sk-secret-token oauth_ref=bad',
      createProposal,
    });
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(result.payload);
    assert.ok(!serialized.includes('sk-secret'));
    assert.ok(!serialized.includes('oauth_ref'));
  });
});
