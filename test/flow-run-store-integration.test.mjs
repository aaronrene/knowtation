/**
 * Tier 2 — INTEGRATION: flow_run read parity CLI = MCP = Hub handler (P-FLOW).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleFlowRunGetRequest,
  handleFlowRunListRequest,
  handleFlowRunMcpRequest,
} from '../lib/flow/flow-execution.mjs';
import { OVERSEER_FIXTURE_RUN_REF } from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-run-store-integration');

describe('Flow run store — triple-surface parity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('Hub handler and MCP get by run_ref produce deep-equal payloads', async () => {
    const hubDir = path.join(tmpRoot, 'hub');
    const mcpDir = path.join(tmpRoot, 'mcp');
    fs.mkdirSync(hubDir);
    fs.mkdirSync(mcpDir);
    const scopes = ['personal', 'project', 'org'];

    const hub = handleFlowRunGetRequest({
      dataDir: hubDir,
      vaultId: 'default',
      cliScopes: scopes,
      runId: OVERSEER_FIXTURE_RUN_REF,
    });
    const mcp = await handleFlowRunMcpRequest({
      dataDir: mcpDir,
      vaultId: 'default',
      cliScopes: scopes,
      action: 'get',
      run_id: OVERSEER_FIXTURE_RUN_REF,
    });

    assert.equal(hub.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(hub.payload, mcp.payload);
    assert.equal(hub.payload.run.run_ref, OVERSEER_FIXTURE_RUN_REF);
  });

  it('list by flow_id matches filtered store rows', () => {
    const dataDir = path.join(tmpRoot, 'list');
    fs.mkdirSync(dataDir);
    const scopes = ['personal', 'project', 'org'];
    const list = handleFlowRunListRequest({
      dataDir,
      vaultId: 'default',
      cliScopes: scopes,
      flowId: 'flow_overseer_handover',
    });
    assert.equal(list.ok, true);
    assert.ok(list.payload.runs.every((r) => r.flow_id === 'flow_overseer_handover'));
  });
});
