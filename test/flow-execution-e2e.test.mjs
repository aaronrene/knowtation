/**
 * Tier 3 — E2E: start → consent → execute → submit review; grant ≠ consent.
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
  handleFlowRunSubmitReviewRequest,
} from '../lib/flow/flow-execution.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { writeExecutionPolicy, seedAutomatableFlow } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-e2e');

describe('Flow execution — e2e', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_RUN_WRITES_ENABLED = '1';
    process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED = '1';
    writeExecutionPolicy(dataDir);
    seedAutomatableFlow(dataDir, vaultId);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    delete process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED;
  });

  it('start → consent → execute automatable → submit review', async () => {
    const start = handleFlowRunStartRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      flowId: 'flow_automatable_test',
      flowVersion: '1.0.0',
    });
    assert.equal(start.ok, true);
    const runId = start.payload.run.run_id;
    const stepId = 'flow_automatable_test#1';

    const consent = handleFlowExecutionConsentMintRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      runId,
      allowedLanes: ['local_default'],
      costCapUnits: 10,
    });
    assert.equal(consent.ok, true);

    const execute = handleFlowRunExecuteAutomatableRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      runId,
      stepId,
      consentId: consent.payload.consent.consent_id,
    });
    assert.equal(execute.ok, true);
    assert.equal(execute.payload.execution.status, 'completed');
    assert.ok(execute.payload.execution.evidence_ref);

    const submit = await handleFlowRunSubmitReviewRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      runId,
      intent: 'Run outcome for review',
      createProposal,
    });
    assert.equal(submit.ok, true);
    assert.ok(submit.payload.proposal_id);
  });

  it('external grant id does not satisfy execute consent (SD-5/SD-6)', () => {
    const start = handleFlowRunStartRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      flowId: 'flow_automatable_test',
      flowVersion: '1.0.0',
    });
    assert.equal(start.ok, true);
    const execute = handleFlowRunExecuteAutomatableRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      runId: start.payload.run.run_id,
      stepId: 'flow_automatable_test#1',
      consentId: 'fgrnt_bearer_not_consent',
    });
    assert.equal(execute.ok, false);
    assert.equal(execute.code, 'FLOW_EXECUTION_CONSENT_REQUIRED');
  });
});
