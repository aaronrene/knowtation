/**
 * Tier 4 — STRESS: many version rows with shared step_ids (7A-10c).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertFlowVersion, getFlow } from '../lib/flow/flow-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-versioned-step-keying-stress');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow store — versioned step keying (stress)', () => {
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

  it('50 semver bumps each retain distinct step instruction text', () => {
    const flowId = 'flow_10c_stress';
    const instructions = [];
    for (let minor = 0; minor < 50; minor += 1) {
      const version = `1.${minor}.0`;
      const bundle = makeFlowBundle({ flowId, version, steps: 3 });
      bundle.steps[0].instruction = `Instruction for ${version}`;
      instructions.push(bundle.steps[0].instruction);
      upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
    }

    for (let minor = 0; minor < 50; minor += 1) {
      const version = `1.${minor}.0`;
      const got = getFlow(dataDir, vaultId, flowId, {
        filterScopes: visible, version, starterDir,
      });
      assert.equal(got.steps[0].instruction, instructions[minor]);
    }
  });
});
