/**
 * Tier 5 — DATA-INTEGRITY: run_ref ↔ run_id linkage, step state invariants (P-FLOW).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getFlowRun,
  seedOverseerAnchorRun,
  OVERSEER_FIXTURE_RUN_REF,
  runForClient,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-integrity');

describe('Flow run store — data integrity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('seed → get round-trip preserves SD-2 fields and run_ref linkage', () => {
    const dataDir = path.join(tmpRoot, 'rt');
    fs.mkdirSync(dataDir);
    seedOverseerAnchorRun(dataDir, 'default');
    const scopes = new Set(['project', 'org']);
    const got = getFlowRun(dataDir, 'default', OVERSEER_FIXTURE_RUN_REF, {
      visibleScopes: scopes,
    });
    assert.ok(got);
    assert.equal(got.run.task_ref, 'task_2g_handover_001');
    assert.equal(got.run.external_ref, 'musehub:commit:abc123def456');
    assert.equal(got.run.run_ref, OVERSEER_FIXTURE_RUN_REF);
    assert.equal(got.run.flow_version, '0.1.0');
  });

  it('done + evidence_required step states never appear with verified:false', () => {
    const dataDir = path.join(tmpRoot, 'inv');
    fs.mkdirSync(dataDir);
    const scopes = new Set(['project', 'org']);
    const got = getFlowRun(dataDir, 'default', 'run_overseer_in_progress', {
      visibleScopes: scopes,
    });
    assert.ok(got);
    for (const state of got.run.step_states) {
      if (state.status === 'done') {
        assert.equal(state.verified, true);
        assert.ok(state.evidence_ref);
      }
    }
  });

  it('runForClient is deterministic for the same stored row', () => {
    const row = {
      run_id: 'run_det',
      run_ref: 'flow_run:run_det',
      flow_id: 'flow_x',
      flow_version: '1.0.0',
      scope: 'personal',
      status: 'pending',
      step_states: [],
      started: '2026-01-01T00:00:00Z',
      provenance: { actor: 'c'.repeat(64), harness: 'test' },
    };
    assert.deepEqual(runForClient(row), runForClient(row));
  });
});
