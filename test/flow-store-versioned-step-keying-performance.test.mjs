/**
 * Tier 6 — PERFORMANCE: version resolution stays bounded (7A-10c).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertFlowVersion, getFlow, stepsForFlowVersion, loadFlowStore } from '../lib/flow/flow-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-versioned-step-keying-perf');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow store — versioned step keying (performance)', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  let starterDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    starterDir = emptyStarterDir(dataDir);

    const flowId = 'flow_10c_perf';
    for (let i = 0; i < 30; i += 1) {
      const bundle = makeFlowBundle({ flowId, version: `1.${i}.0`, steps: 20 });
      upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('pinned getFlow p95 stays under 25ms for 30 versions × 20 steps', () => {
    const samples = [];
    for (let i = 0; i < 40; i += 1) {
      const version = `1.${i % 30}.0`;
      const t0 = performance.now();
      const got = getFlow(dataDir, vaultId, 'flow_10c_perf', {
        filterScopes: visible, version, starterDir,
      });
      samples.push(performance.now() - t0);
      assert.ok(got);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    assert.ok(p95 < 25, `p95 ${p95}ms exceeds budget`);
  });

  it('stepsForFlowVersion is O(steps) not O(versions×steps)', () => {
    const store = loadFlowStore(dataDir);
    const vault = store.vaults[vaultId];
    const t0 = performance.now();
    for (let i = 0; i < 200; i += 1) {
      stepsForFlowVersion(vault, 'flow_10c_perf', '1.15.0');
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 50, `200 lookups took ${elapsed}ms`);
  });
});
