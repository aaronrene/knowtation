/**
 * Tier 7 — SECURITY: scope denial, no existence leak, no secrets in run payloads (P-FLOW).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleFlowRunGetRequest,
} from '../lib/flow/flow-execution.mjs';
import {
  getFlowRun,
  listFlowRuns,
  OVERSEER_FIXTURE_RUN_REF,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-security');

const SECRET_MARKERS = ['token', 'oauth', 'refresh_token', 'password', 'secret'];

describe('Flow run store — security', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('personal scope never returns project overseer run', () => {
    const dataDir = path.join(tmpRoot, 'scope');
    fs.mkdirSync(dataDir);
    const personal = new Set(['personal']);
    const list = listFlowRuns(dataDir, 'default', {
      visibleScopes: personal,
      filterScopes: personal,
      effectiveScope: 'personal',
    });
    assert.ok(list.runs.every((r) => r.scope === 'personal'));
    assert.equal(getFlowRun(dataDir, 'default', OVERSEER_FIXTURE_RUN_REF, {
      visibleScopes: personal,
    }), null);
  });

  it('no existence leak: scope-invisible equals missing (404 unknown_run)', () => {
    const dataDir = path.join(tmpRoot, 'leak');
    fs.mkdirSync(dataDir);
    const storeResult = handleFlowRunGetRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      runId: OVERSEER_FIXTURE_RUN_REF,
    });
    assert.equal(storeResult.ok, false);
    assert.equal(storeResult.status, 404);
    assert.equal(storeResult.code, 'unknown_run');

    const missing = handleFlowRunGetRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['personal'],
      runId: 'run_does_not_exist',
    });
    assert.equal(missing.code, 'unknown_run');
  });

  it('serialized list/get payloads contain no secret markers', () => {
    const dataDir = path.join(tmpRoot, 'secrets');
    fs.mkdirSync(dataDir);
    const scopes = new Set(['project', 'org']);
    const list = listFlowRuns(dataDir, 'default', {
      visibleScopes: scopes,
      filterScopes: scopes,
      effectiveScope: 'project',
    });
    const got = getFlowRun(dataDir, 'default', OVERSEER_FIXTURE_RUN_REF, {
      visibleScopes: scopes,
    });
    const blob = JSON.stringify({ list, got }).toLowerCase();
    for (const marker of SECRET_MARKERS) {
      assert.ok(!blob.includes(marker), `found forbidden marker: ${marker}`);
    }
  });

  it('invalid lookup keys fail closed at handler boundary', () => {
    const dataDir = path.join(tmpRoot, 'bad');
    fs.mkdirSync(dataDir);
    const bad = handleFlowRunGetRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: ['project'],
      runId: '../../../etc/passwd',
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
  });
});
