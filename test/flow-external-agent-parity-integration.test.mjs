/**
 * Tier 2 — INTEGRATION: MCP = Hub handler = CLI parity for grants + agent_bundle gate off.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import {
  handleFlowExternalGrantMintRequest,
  handleFlowExternalGrantListRequest,
} from '../lib/flow/external-agent.mjs';
import { upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import {
  writeExternalAgentPolicy,
  makeExternalToolFlowBundle,
} from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-parity');

function stripVolatileMint(payload) {
  const copy = structuredClone(payload);
  delete copy.bearer;
  if (copy.grant) {
    delete copy.grant.grant_id;
    delete copy.grant.expires_at;
    delete copy.grant.issued_at;
  }
  delete copy.expires_at;
  return copy;
}

describe('Flow external-agent — parity integration', () => {
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

  it('mint parity across Hub and CLI surfaces', () => {
    const hub = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      role: 'admin',
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
    });
    const cli = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project'],
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
    });
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.deepEqual(stripVolatileMint(hub.payload), stripVolatileMint(cli.payload));
    assert.ok(hub.payload.bearer.startsWith('fgrnt_bearer_'));
  });

  it('gate off ⇒ agent_bundle FLOW_HARNESS_UNSUPPORTED', () => {
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
    const policyPath = path.join(dataDir, 'hub_flow_external_agent_policy.json');
    fs.rmSync(policyPath);
    const result = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      harness: 'agent_bundle',
      cliScopes: ['personal'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_HARNESS_UNSUPPORTED');
  });

  it('gate off ⇒ mint FLOW_EXTERNAL_AGENT_DISABLED', () => {
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
    const policyPath = path.join(dataDir, 'hub_flow_external_agent_policy.json');
    fs.rmSync(policyPath);
    const result = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_EXTERNAL_AGENT_DISABLED');
  });

  it('list returns grants without bearer', () => {
    handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
    });
    const list = handleFlowExternalGrantListRequest({ dataDir, vaultId });
    assert.equal(list.ok, true);
    assert.equal(list.payload.grants.length, 1);
    assert.equal(JSON.stringify(list.payload).includes('bearer'), false);
  });
});
