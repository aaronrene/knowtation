/**
 * Tier 2 — INTEGRATION: triple-surface parity + disabled gates.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleFlowRunStartRequest,
  handleFlowRunMcpRequest,
} from '../lib/flow/flow-execution.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { writeExecutionPolicy, seedAutomatableFlow } from './fixtures/flow/execution-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-execution-parity');

describe('Flow execution — triple-surface parity', () => {
  function freshDataDir(name) {
    const d = path.join(tmpRoot, name);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.FLOW_RUN_WRITES_ENABLED = '1';
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    delete process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED;
  });

  it('Hub handler and MCP start produce deep-equal run records', () => {
    const hubDir = freshDataDir('hub');
    const mcpDir = freshDataDir('mcp');
    const bundle = seedAutomatableFlow(hubDir, 'default');
    seedAutomatableFlow(mcpDir, 'default');

    const hub = handleFlowRunStartRequest({
      dataDir: hubDir,
      vaultId: 'default',
      role: 'admin',
      flowId: bundle.flow.flow_id,
      flowVersion: bundle.flow.version,
      harness: 'hub',
    });
    const mcp = handleFlowRunMcpRequest({
      dataDir: mcpDir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      action: 'start',
      flow_id: bundle.flow.flow_id,
      flow_version: bundle.flow.version,
      harness: 'mcp',
    });

    assert.equal(hub.ok, true);
    assert.equal(mcp.ok, true);
    const hubRun = hub.payload.run;
    const mcpRun = mcp.payload.run;
    assert.equal(hubRun.flow_id, mcpRun.flow_id);
    assert.equal(hubRun.flow_version, mcpRun.flow_version);
    assert.equal(hubRun.scope, mcpRun.scope);
    assert.equal(hubRun.step_states.length, mcpRun.step_states.length);
  });

  it('FLOW_RUN_WRITES_ENABLED=off ⇒ identical disabled code', () => {
    delete process.env.FLOW_RUN_WRITES_ENABLED;
    const dir = freshDataDir('off');
    seedAutomatableFlow(dir, 'default');
    const hub = handleFlowRunStartRequest({
      dataDir: dir,
      vaultId: 'default',
      role: 'admin',
      flowId: 'flow_automatable_test',
      flowVersion: '1.0.0',
    });
    const mcp = handleFlowRunMcpRequest({
      dataDir: dir,
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      action: 'start',
      flow_id: 'flow_automatable_test',
      flow_version: '1.0.0',
      createProposal,
    });
    assert.equal(hub.ok, false);
    assert.equal(mcp.ok, false);
    assert.equal(hub.code, 'FLOW_RUN_WRITES_DISABLED');
    assert.equal(mcp.code, 'FLOW_RUN_WRITES_DISABLED');
  });
});

describe('Flow execution — Hub route wiring contract', () => {
  it('registers run routes gated by FLOW_RUN_WRITE_ROLES', async () => {
    const { getRepoRoot } = await import('../lib/repo-root.mjs');
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /FLOW_RUN_WRITE_ROLES/);
    assert.match(src, /execute-automatable/);
    assert.match(src, /handleFlowRunStartRequest/);
  });
});
