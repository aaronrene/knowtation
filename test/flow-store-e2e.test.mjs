/**
 * Tier 3 — E2E: empty vault seed walkthrough and scope-filtered list/get.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFlowListRequest, handleFlowGetRequest } from '../lib/flow/flow-handlers.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-e2e');
const starterDir = path.join(getRepoRoot(), 'flows/starter');

describe('E2E — Flow read walkthrough', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('empty vault → first list seeds six starters → get handover returns six ordered steps', () => {
    const list = handleFlowListRequest({
      dataDir,
      vaultId,
      role: 'admin',
      starterDir,
    });
    assert.equal(list.ok, true);
    assert.equal(list.payload.flows.length, 6);

    const got = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_overseer_handover',
      role: 'admin',
      starterDir,
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.steps.length, 6);
    const kinds = new Set(got.payload.steps.map((s) => s.verification.kind));
    assert.ok(kinds.has('human_review'));
    assert.ok(kinds.has('artifact_exists'));
  });

  it('list --scope personal returns exactly four personal flows', () => {
    handleFlowListRequest({ dataDir, vaultId, role: 'admin', starterDir });
    const personal = handleFlowListRequest({
      dataDir,
      vaultId,
      role: 'admin',
      scope: 'personal',
      starterDir,
    });
    assert.equal(personal.ok, true);
    assert.equal(personal.payload.flows.length, 4);
    assert.ok(personal.payload.flows.every((f) => f.scope === 'personal'));
  });

  it('pinned version returns that version; absent returns latest', () => {
    handleFlowListRequest({ dataDir, vaultId, role: 'admin', starterDir });
    const latest = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_capture_to_note',
      role: 'admin',
      starterDir,
    });
    assert.equal(latest.ok, true);
    assert.equal(latest.payload.flow.version, '0.1.0');

    const pinned = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_capture_to_note',
      version: '0.1.0',
      role: 'admin',
      starterDir,
    });
    assert.equal(pinned.ok, true);
    assert.equal(pinned.payload.flow.version, '0.1.0');
  });
});
