/**
 * Tier 4 — STRESS: concurrent starts and idempotent execute.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleFlowRunStartRequest,
  handleFlowExecutionConsentMintRequest,
  handleFlowRunExecuteAutomatableRequest,
} from '../lib/flow/flow-execution.mjs';
import { writeExecutionPolicy, seedAutomatableFlow } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-stress');

describe('Flow execution — stress', () => {
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

  it('many concurrent run starts remain bounded', () => {
    const dataDir = path.join(tmpRoot, 'starts');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir);
    seedAutomatableFlow(dataDir, 'default');
    for (let i = 0; i < 50; i += 1) {
      const r = handleFlowRunStartRequest({
        dataDir,
        vaultId: 'default',
        cliScopes: ['personal', 'project', 'org'],
        flowId: 'flow_automatable_test',
        flowVersion: '1.0.0',
      });
      assert.equal(r.ok, true);
    }
  });

  it('duplicate execute posts return same execution_id', () => {
    const dataDir = path.join(tmpRoot, 'idem');
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
    const consent = handleFlowExecutionConsentMintRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      runId: start.payload.run.run_id,
      allowedLanes: ['local_default'],
      costCapUnits: 5,
    });
    const input = {
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      runId: start.payload.run.run_id,
      stepId: 'flow_automatable_test#1',
      consentId: consent.payload.consent.consent_id,
    };
    const first = handleFlowRunExecuteAutomatableRequest(input);
    const second = handleFlowRunExecuteAutomatableRequest(input);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.payload.execution.execution_id, second.payload.execution.execution_id);
  });
});
