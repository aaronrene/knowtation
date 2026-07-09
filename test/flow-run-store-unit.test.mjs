/**
 * Tier 1 — UNIT: flow_run store helpers (P-FLOW / 7A-10).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLOW_RUN_ID_RE,
  FLOW_RUN_REF_RE,
  OVERSEER_FIXTURE_RUN_REF,
  buildDefaultRunRef,
  isValidRunLookupKey,
  findRunInVault,
  runForClient,
  seedOverseerAnchorRun,
  getFlowRun,
  listFlowRuns,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-unit');

describe('Flow run store — unit', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('regexes accept canonical ids and portable run_ref pointers', () => {
    assert.match('run_overseer_in_progress', FLOW_RUN_ID_RE);
    assert.match(OVERSEER_FIXTURE_RUN_REF, FLOW_RUN_REF_RE);
    assert.doesNotMatch('flow_run:', FLOW_RUN_REF_RE);
    assert.doesNotMatch('not_a_run', FLOW_RUN_ID_RE);
  });

  it('buildDefaultRunRef prefixes flow_run:', () => {
    assert.equal(buildDefaultRunRef('run_abc123'), 'flow_run:run_abc123');
  });

  it('isValidRunLookupKey accepts run_id or run_ref', () => {
    assert.equal(isValidRunLookupKey('run_test'), true);
    assert.equal(isValidRunLookupKey(OVERSEER_FIXTURE_RUN_REF), true);
    assert.equal(isValidRunLookupKey(''), false);
    assert.equal(isValidRunLookupKey('bad'), false);
  });

  it('findRunInVault resolves by run_id or run_ref', () => {
    const vault = {
      runs: [
        { run_id: 'run_a', run_ref: 'flow_run:ptr-a', scope: 'project' },
        { run_id: 'run_b', run_ref: OVERSEER_FIXTURE_RUN_REF, scope: 'project' },
      ],
    };
    assert.equal(findRunInVault(vault, 'run_a')?.run_ref, 'flow_run:ptr-a');
    assert.equal(findRunInVault(vault, OVERSEER_FIXTURE_RUN_REF)?.run_id, 'run_b');
    assert.equal(findRunInVault(vault, 'missing'), null);
  });

  it('runForClient emits run_ref and pointer-only fields', () => {
    const client = runForClient({
      run_id: 'run_x',
      flow_id: 'flow_overseer_handover',
      flow_version: '0.1.0',
      scope: 'project',
      status: 'in_progress',
      step_states: [],
      started: '2026-06-19T10:00:00Z',
      provenance: { actor: 'a'.repeat(64), harness: 'seed' },
      task_ref: 'task_2g_handover_001',
      external_ref: 'musehub:commit:abc',
    });
    assert.equal(client.schema, 'knowtation.flow_run/v0');
    assert.equal(client.run_ref, 'flow_run:run_x');
    assert.equal(client.task_ref, 'task_2g_handover_001');
    assert.equal(client.external_ref, 'musehub:commit:abc');
  });

  it('seedOverseerAnchorRun is idempotent', () => {
    const dataDir = path.join(tmpRoot, 'seed');
    fs.mkdirSync(dataDir);
    const first = seedOverseerAnchorRun(dataDir, 'default');
    const second = seedOverseerAnchorRun(dataDir, 'default');
    assert.equal(first.seeded, true);
    assert.equal(second.seeded, false);
  });

  it('getFlowRun resolves overseer fixture by portable run_ref', () => {
    const dataDir = path.join(tmpRoot, 'get-ref');
    fs.mkdirSync(dataDir);
    const visible = new Set(['personal', 'project', 'org']);
    const byRef = getFlowRun(dataDir, 'default', OVERSEER_FIXTURE_RUN_REF, {
      visibleScopes: visible,
    });
    assert.ok(byRef);
    assert.equal(byRef.schema, 'knowtation.flow_run_get/v0');
    assert.equal(byRef.run.run_id, 'run_overseer_in_progress');
    assert.equal(byRef.run.run_ref, OVERSEER_FIXTURE_RUN_REF);
  });

  it('listFlowRuns stamps flow_run_list schema discriminator', () => {
    const dataDir = path.join(tmpRoot, 'list');
    fs.mkdirSync(dataDir);
    const result = listFlowRuns(dataDir, 'default', {
      visibleScopes: new Set(['project', 'org']),
      filterScopes: new Set(['project', 'org']),
      effectiveScope: 'project',
    });
    assert.equal(result.schema, 'knowtation.flow_run_list/v0');
    assert.ok(result.runs.length >= 1);
  });
});
