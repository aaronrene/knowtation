/**
 * Tier 5 — DATA INTEGRITY: bundle round-trip; grant list/revoke metadata stable.
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
  grantForClient,
} from '../lib/flow/external-agent.mjs';
import { upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import {
  writeExternalAgentPolicy,
  makeExternalToolFlowBundle,
} from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-integrity');

describe('Flow external-agent — data integrity', () => {
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

  it('agent_bundle preserves steps and skill_refs', () => {
    const result = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      harness: 'agent_bundle',
      cliScopes: ['personal'],
    });
    assert.equal(result.ok, true);
    const inner = JSON.parse(result.payload.projection.rendered);
    assert.equal(inner.steps[0].skill_refs[0].id, 'web_search');
    assert.equal(inner.flow_id, 'flow_ext_agent_test');
    assert.equal(inner.flow_version, '1.0.0');
  });

  it('grant metadata survives list with no bearer field', () => {
    const mint = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
    });
    assert.equal(mint.ok, true);
    const list = handleFlowExternalGrantListRequest({ dataDir, vaultId });
    const listed = list.payload.grants[0];
    assert.deepEqual(grantForClient(listed), mint.payload.grant);
    assert.equal('bearer' in listed, false);
  });
});
