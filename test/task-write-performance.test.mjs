/**
 * Tier 6 — PERFORMANCE: propose + apply p95 budgets.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleTaskProposeRequest } from '../lib/task/task-write.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { approveTaskProposal, sampleTaskCreatePayload, visibleAll } from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-perf');
const PROPOSE_P95_MS = 50;
const APPLY_P95_MS = 50;
const SAMPLES = 20;

describe('task write — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.TASK_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.TASK_WRITES_ENABLED;
  });

  it(`propose p95 < ${PROPOSE_P95_MS}ms over ${SAMPLES} samples`, async () => {
    const times = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const body = sampleTaskCreatePayload();
      body.task.task_id = `task_perf_${i}`;
      const t0 = performance.now();
      await handleTaskProposeRequest({
        dataDir,
        vaultId: 'default',
        visibleScopes: visibleAll,
        proposalKind: 'task_create',
        body,
        intent: 'perf',
        createProposal,
      });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    assert.ok(p95 < PROPOSE_P95_MS, `p95=${p95.toFixed(2)}ms`);
  });

  it(`approve apply p95 < ${APPLY_P95_MS}ms`, async () => {
    const times = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const body = sampleTaskCreatePayload();
      body.task.task_id = `task_perf_apply_${i}`;
      const proposed = await handleTaskProposeRequest({
        dataDir,
        vaultId: 'default',
        visibleScopes: visibleAll,
        proposalKind: 'task_create',
        body,
        intent: 'perf',
        createProposal,
      });
      const t0 = performance.now();
      approveTaskProposal(dataDir, proposed.payload.proposal_id);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    assert.ok(p95 < APPLY_P95_MS, `p95=${p95.toFixed(2)}ms`);
  });
});
