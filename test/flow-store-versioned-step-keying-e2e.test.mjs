/**
 * Tier 3 — E2E: seed → version bump → pin both versions (7A-10c).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedStarterFlows, getFlow, upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import { makeFlowBundle } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-versioned-step-keying-e2e');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow store — versioned step keying (e2e)', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  const starterDir = path.join(tmpRoot, 'starters');

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(starterDir, { recursive: true });

    const v1 = makeFlowBundle({ flowId: 'flow_10c_e2e', version: '1.0.0', steps: 2 });
    fs.writeFileSync(path.join(starterDir, 'flow_10c_e2e.json'), JSON.stringify(v1, null, 2));
    seedStarterFlows(dataDir, vaultId, { starterDir });

    const v2 = structuredClone(makeFlowBundle({ flowId: 'flow_10c_e2e', version: '2.0.0', steps: 2 }));
    v2.steps[1].instruction = 'E2E-only step 2 wording.';
    upsertFlowVersion(dataDir, vaultId, v2.flow, v2.steps);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('seeded v1 and upserted v2 are both readable end-to-end', () => {
    const pinnedV1 = getFlow(dataDir, vaultId, 'flow_10c_e2e', {
      filterScopes: visible, version: '1.0.0', starterDir,
    });
    const pinnedV2 = getFlow(dataDir, vaultId, 'flow_10c_e2e', {
      filterScopes: visible, version: '2.0.0', starterDir,
    });
    assert.equal(pinnedV1.flow.version, '1.0.0');
    assert.equal(pinnedV2.flow.version, '2.0.0');
    assert.notEqual(pinnedV1.steps[1].instruction, pinnedV2.steps[1].instruction);
    assert.equal(pinnedV2.steps[1].instruction, 'E2E-only step 2 wording.');
  });
});
