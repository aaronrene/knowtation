/**
 * Tier 7 — SECURITY: flow_version never leaks on wire; no cross-version bleed (7A-10c).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertFlowVersion, getFlow, listFlows } from '../lib/flow/flow-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-versioned-step-keying-sec');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow store — versioned step keying (security)', () => {
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

  it('getFlow and listFlows responses omit store-internal flow_version', () => {
    const v1 = makeFlowBundle({ flowId: 'flow_10c_sec', version: '1.0.0', steps: 1 });
    const v2 = structuredClone(makeFlowBundle({ flowId: 'flow_10c_sec', version: '2.0.0', steps: 1 }));
    upsertFlowVersion(dataDir, vaultId, v1.flow, v1.steps);
    upsertFlowVersion(dataDir, vaultId, v2.flow, v2.steps);

    const got = getFlow(dataDir, vaultId, 'flow_10c_sec', { filterScopes: visible, starterDir });
    const listed = listFlows(dataDir, vaultId, {
      filterScopes: visible, effectiveScope: 'personal', starterDir,
    });
    const serialized = JSON.stringify({ got, listed });
    assert.ok(!serialized.includes('flow_version'));
  });

  it('pinned read cannot return a newer version step body', () => {
    const v1 = makeFlowBundle({ flowId: 'flow_10c_bleed', version: '1.0.0', steps: 1 });
    const v2 = structuredClone(makeFlowBundle({ flowId: 'flow_10c_bleed', version: '2.0.0', steps: 1 }));
    v1.steps[0].instruction = 'SECRET_V1_ONLY';
    v2.steps[0].instruction = 'SECRET_V2_ONLY';
    upsertFlowVersion(dataDir, vaultId, v1.flow, v1.steps);
    upsertFlowVersion(dataDir, vaultId, v2.flow, v2.steps);

    const pinned = getFlow(dataDir, vaultId, 'flow_10c_bleed', {
      filterScopes: visible, version: '1.0.0', starterDir,
    });
    assert.equal(pinned.steps[0].instruction, 'SECRET_V1_ONLY');
    assert.ok(!JSON.stringify(pinned).includes('SECRET_V2_ONLY'));
  });
});
