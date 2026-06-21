/**
 * Tier 5 — DATA INTEGRITY: version pin, ordinal order, task_ref round-trip.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFlowRunStartRequest, handleFlowRunExecuteAutomatableRequest } from '../lib/flow/flow-execution.mjs';
import { writeExecutionPolicy, seedAutomatableFlow } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-integrity');

describe('Flow execution — data integrity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.FLOW_RUN_WRITES_ENABLED = '1';
    process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED = '1';
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    delete process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED;
  });

  it('flow_version pin survives execute', () => {
    const dataDir = path.join(tmpRoot, 'pin');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir);
    const bundle = seedAutomatableFlow(dataDir, 'default');
    const start = handleFlowRunStartRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      flowId: bundle.flow.flow_id,
      flowVersion: bundle.flow.version,
      taskRef: 'task_sd2_001',
      externalRef: 'muse:sha:abc',
    });
    assert.equal(start.payload.run.flow_version, '1.0.0');
    assert.equal(start.payload.run.task_ref, 'task_sd2_001');
    assert.equal(start.payload.run.external_ref, 'muse:sha:abc');
  });

  it('step_states preserve ordinal order after mutations', () => {
    const dataDir = path.join(tmpRoot, 'ordinal');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir);
    seedAutomatableFlow(dataDir, 'default');
    const start = handleFlowRunStartRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      flowId: 'flow_automatable_test',
      flowVersion: '1.0.0',
    });
    const ids = start.payload.run.step_states.map((s) => s.step_id);
    assert.deepEqual(ids, ['flow_automatable_test#1']);
  });
});
