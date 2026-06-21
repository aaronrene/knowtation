/**
 * Tier 6 — PERFORMANCE: start/advance bounded on fixture.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFlowRunStartRequest } from '../lib/flow/flow-execution.mjs';
import { writeExecutionPolicy, seedAutomatableFlow } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-perf');
const P95_MS = 50;

describe('Flow execution — performance', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.FLOW_RUN_WRITES_ENABLED = '1';
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_RUN_WRITES_ENABLED;
  });

  it('start run completes within p95 budget', () => {
    const dataDir = path.join(tmpRoot, 'perf');
    fs.mkdirSync(dataDir);
    writeExecutionPolicy(dataDir);
    seedAutomatableFlow(dataDir, 'default');
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      const r = handleFlowRunStartRequest({
        dataDir,
        vaultId: 'default',
        cliScopes: ['personal', 'project', 'org'],
        flowId: 'flow_automatable_test',
        flowVersion: '1.0.0',
      });
      samples.push(performance.now() - t0);
      assert.equal(r.ok, true);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1];
    assert.ok(p95 < P95_MS, `p95 ${p95}ms exceeds ${P95_MS}ms`);
  });
});
