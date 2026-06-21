/**
 * Tier 1 — UNIT: execution gate helpers, consent schema, sub-gate defaults.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getFlowRunWritesEnabled,
  getFlowAutomatableExecutionEnabled,
  consentForClient,
  FLOW_EXECUTION_CONSENT_SCHEMA,
  validateImportAutomatableSteps,
  runModelOrchestrationStub,
  frontierOrdinal,
} from '../lib/flow/flow-execution.mjs';
import { writeExecutionPolicy } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-unit');

describe('Flow execution — unit', () => {
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

  it('sub-gates default off; policy file can enable', () => {
    const dataDir = path.join(tmpRoot, 'off');
    fs.mkdirSync(dataDir);
    assert.equal(getFlowRunWritesEnabled(dataDir), false);
    assert.equal(getFlowAutomatableExecutionEnabled(dataDir), false);
    writeExecutionPolicy(dataDir, { runWrites: true, automatable: true });
    assert.equal(getFlowRunWritesEnabled(dataDir), true);
    assert.equal(getFlowAutomatableExecutionEnabled(dataDir), true);
  });

  it('consentForClient validates schema fields without secrets', () => {
    const stored = {
      schema: FLOW_EXECUTION_CONSENT_SCHEMA,
      consent_id: 'fcons_test',
      vault_id: 'default',
      scope: 'personal',
      run_id: 'run_abc',
      flow_id: 'flow_test',
      flow_version: '1.0.0',
      allowed_lanes: ['local_default'],
      cost_cap_units: 50,
      cost_consumed_units: 0,
      actor_hash: 'abc123',
      expires_at: '2026-06-20T13:00:00Z',
      revoked_at: null,
    };
    const client = consentForClient(stored);
    assert.equal(client.schema, FLOW_EXECUTION_CONSENT_SCHEMA);
    assert.equal(JSON.stringify(client).includes('api_key'), false);
  });

  it('validateImportAutomatableSteps rejects when policy forbids', () => {
    const dataDir = path.join(tmpRoot, 'policy');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir, { automatableForbidden: true });
    const steps = [{ step_id: 'flow_x#1', automatable: 'automatable' }];
    const result = validateImportAutomatableSteps(steps, dataDir);
    assert.equal(result.ok, false);
  });

  it('runModelOrchestrationStub dry_run produces no evidence', () => {
    const out = runModelOrchestrationStub({ lane: 'local_default', dryRun: true });
    assert.equal(out.evidence_ref, null);
    assert.equal(out.cost_units, 0);
  });

  it('frontierOrdinal returns next pending ordinal', () => {
    const steps = [
      { step_id: 'flow_x#1', ordinal: 1 },
      { step_id: 'flow_x#2', ordinal: 2 },
    ];
    const states = [
      { step_id: 'flow_x#1', status: 'done', verified: true },
      { step_id: 'flow_x#2', status: 'pending', verified: false },
    ];
    assert.equal(frontierOrdinal(states, steps), 2);
  });
});
