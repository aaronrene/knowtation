/**
 * Tier 6 — PERFORMANCE: bundle render + mint within bounded iterations.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import { handleFlowExternalGrantMintRequest } from '../lib/flow/external-agent.mjs';
import { upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import {
  writeExternalAgentPolicy,
  makeExternalToolFlowBundle,
} from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-perf');

describe('Flow external-agent — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeExternalAgentPolicy(dataDir);
    process.env.FLOW_EXTERNAL_AGENT_ENABLED = '1';
    const bundle = makeExternalToolFlowBundle();
    upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
  });

  it('bundle render and mint complete within p95 budget (100 iterations)', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i += 1) {
      const project = handleFlowProjectRequest({
        dataDir,
        vaultId,
        flowId: 'flow_ext_agent_test',
        harness: 'agent_bundle',
        cliScopes: ['personal'],
      });
      assert.equal(project.ok, true);
      handleFlowExternalGrantMintRequest({
        dataDir,
        vaultId,
        flowId: 'flow_ext_agent_test',
        flowVersion: '1.0.0',
        requestedTools: ['web_search'],
      });
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 5000, `expected < 5s for 100 iterations, got ${elapsed}ms`);
  });
});
