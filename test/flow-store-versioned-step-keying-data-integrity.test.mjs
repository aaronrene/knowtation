/**
 * Tier 5 — DATA-INTEGRITY: divergent step bodies across flow versions (7A-10c).
 *
 * Regression for the 7A-12 store finding: two versions of one Flow must carry
 * independent step text when pinned by semver.
 *
 * @see docs/evidence/7A-12/README.md
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  upsertFlowVersion,
  getFlow,
  loadFlowStore,
} from '../lib/flow/flow-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-versioned-step-keying');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow store — versioned step keying (data integrity)', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('two versions with the same step_id retain divergent instruction text', () => {
    const v1 = makeFlowBundle({ flowId: 'flow_10c_di', version: '1.0.0', steps: 2 });
    const v2 = structuredClone(makeFlowBundle({ flowId: 'flow_10c_di', version: '2.0.0', steps: 2 }));
    v2.steps[0].instruction = 'Reworded step 1 for v2.0.0.';
    v2.steps[1].instruction = 'Reworded step 2 for v2.0.0.';

    upsertFlowVersion(dataDir, vaultId, v1.flow, v1.steps);
    upsertFlowVersion(dataDir, vaultId, v2.flow, v2.steps);

    const gotV1 = getFlow(dataDir, vaultId, 'flow_10c_di', {
      filterScopes: visible, version: '1.0.0', starterDir,
    });
    const gotV2 = getFlow(dataDir, vaultId, 'flow_10c_di', {
      filterScopes: visible, version: '2.0.0', starterDir,
    });
    const gotLatest = getFlow(dataDir, vaultId, 'flow_10c_di', {
      filterScopes: visible, starterDir,
    });

    assert.ok(gotV1);
    assert.ok(gotV2);
    assert.ok(gotLatest);
    assert.equal(gotV1.steps[0].instruction, v1.steps[0].instruction);
    assert.equal(gotV2.steps[0].instruction, v2.steps[0].instruction);
    assert.equal(gotLatest.flow.version, '2.0.0');
    assert.equal(gotLatest.steps[0].instruction, v2.steps[0].instruction);
    assert.notEqual(gotV1.steps[0].instruction, gotV2.steps[0].instruction);
  });

  it('upserting v2 does not mutate v1 step bodies in the store file', () => {
    const v1 = makeFlowBundle({ flowId: 'flow_10c_preserve', version: '1.0.0', steps: 1 });
    const v2 = structuredClone(makeFlowBundle({ flowId: 'flow_10c_preserve', version: '2.0.0', steps: 1 }));
    v2.steps[0].instruction = 'Only v2 text.';

    upsertFlowVersion(dataDir, vaultId, v1.flow, v1.steps);
    upsertFlowVersion(dataDir, vaultId, v2.flow, v2.steps);

    const store = loadFlowStore(dataDir);
    const rows = store.vaults[vaultId].steps.filter((s) => s.flow_id === 'flow_10c_preserve');
    assert.equal(rows.length, 2);
    const rowV1 = rows.find((s) => s.flow_version === '1.0.0');
    const rowV2 = rows.find((s) => s.flow_version === '2.0.0');
    assert.ok(rowV1);
    assert.ok(rowV2);
    assert.equal(rowV1.instruction, v1.steps[0].instruction);
    assert.equal(rowV2.instruction, v2.steps[0].instruction);
  });

  it('flowDefinitionForClient omits store-internal flow_version on wire', () => {
    const bundle = makeFlowBundle({ flowId: 'flow_10c_wire', version: '1.0.0', steps: 1 });
    upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
    const got = getFlow(dataDir, vaultId, 'flow_10c_wire', { filterScopes: visible, starterDir });
    assert.ok(got);
    assert.equal(got.steps[0].flow_version, undefined);
    assert.ok(!('flow_version' in got.steps[0]));
  });
});
