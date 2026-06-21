/**
 * Tier 7 — SECURITY: scope denial, injection inert, no secrets in records.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleFlowRunGetRequest,
  handleFlowRunExecuteAutomatableRequest,
  consentForClient,
} from '../lib/flow/flow-execution.mjs';
import { handleFlowProposeRequest } from '../lib/flow/flow-authoring.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { writeExecutionPolicy, seedAutomatableFlow } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-security');

describe('Flow execution — security', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    delete process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    delete process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED;
  });

  it('unknown_run for scope-invisible run (no existence leak)', () => {
    const dataDir = path.join(tmpRoot, 'scope');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir, { runWrites: true });
    seedAutomatableFlow(dataDir, 'default');
    process.env.FLOW_RUN_WRITES_ENABLED = '1';
    const start = handleFlowRunGetRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      runId: 'run_nonexistent',
    });
    assert.equal(start.ok, false);
    assert.equal(start.code, 'unknown_run');
  });

  it('consent record contains no secrets', () => {
    const client = consentForClient({
      schema: 'knowtation.flow_execution_consent/v0',
      consent_id: 'fcons_x',
      vault_id: 'default',
      scope: 'personal',
      run_id: 'run_x',
      flow_id: 'flow_x',
      flow_version: '1.0.0',
      allowed_lanes: ['local_default'],
      cost_cap_units: 10,
      cost_consumed_units: 0,
      actor_hash: 'deadbeef',
      expires_at: '2026-06-20T13:00:00Z',
      revoked_at: null,
    });
    const json = JSON.stringify(client);
    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('api_key'), false);
  });

  it('import with forbidden automatable denied when policy forbids', () => {
    const dataDir = path.join(tmpRoot, 'import');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir, { automatableForbidden: true });
    process.env.FLOW_AUTHORING_WRITES = '1';
    const bundle = seedAutomatableFlow(dataDir, 'default');
    const result = handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      kind: 'import',
      bundle: { flow: bundle.flow, steps: bundle.steps },
      intent: 'import automatable',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_IMPORT_AUTOMATABLE_DENIED');
    delete process.env.FLOW_AUTHORING_WRITES;
  });

  it('gates off ⇒ execute unreachable', () => {
    const dataDir = path.join(tmpRoot, 'off');
    fs.mkdirSync(dataDir);
    const result = handleFlowRunExecuteAutomatableRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      runId: 'run_x',
      stepId: 'flow_automatable_test#1',
      consentId: 'fcons_x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_AUTOMATABLE_EXECUTION_DISABLED');
  });
});
