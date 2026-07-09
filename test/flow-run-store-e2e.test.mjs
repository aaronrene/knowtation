/**
 * Tier 3 — E2E: empty vault → seed → get by run_ref + run_id (P-FLOW).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFlowRun, listFlowRuns, OVERSEER_FIXTURE_RUN_REF } from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-e2e');

describe('Flow run store — e2e', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('empty vault → first read seeds overseer run → get by run_ref and run_id', () => {
    const dataDir = path.join(tmpRoot, 'walk');
    fs.mkdirSync(dataDir);
    const projectScopes = new Set(['project', 'org']);

    const list = listFlowRuns(dataDir, 'default', {
      visibleScopes: projectScopes,
      filterScopes: projectScopes,
      effectiveScope: 'project',
    });
    assert.ok(list.runs.length >= 1);

    const byRef = getFlowRun(dataDir, 'default', OVERSEER_FIXTURE_RUN_REF, {
      visibleScopes: projectScopes,
    });
    const byId = getFlowRun(dataDir, 'default', 'run_overseer_in_progress', {
      visibleScopes: projectScopes,
    });

    assert.ok(byRef);
    assert.ok(byId);
    assert.deepEqual(byRef.run, byId.run);
    assert.equal(byRef.run.step_states.length, 2);
    const doneStep = byRef.run.step_states.find((s) => s.status === 'done');
    assert.equal(doneStep?.verified, true);
  });

  it('personal scope never sees project overseer run', () => {
    const dataDir = path.join(tmpRoot, 'scope');
    fs.mkdirSync(dataDir);
    const personal = new Set(['personal']);
    const got = getFlowRun(dataDir, 'default', OVERSEER_FIXTURE_RUN_REF, {
      visibleScopes: personal,
    });
    assert.equal(got, null);
  });
});
