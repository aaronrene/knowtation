/**
 * Tier 3 — E2E: mint → bundle → invoke → revoke → import sandbox.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import { handleFlowProposeRequest } from '../lib/flow/flow-authoring.mjs';
import {
  handleFlowExternalGrantMintRequest,
  handleFlowExternalGrantRevokeRequest,
  handleFlowExternalToolInvokeRequest,
  validateExternalGrantBearer,
} from '../lib/flow/external-agent.mjs';
import { upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  writeExternalAgentPolicy,
  makeExternalToolFlowBundle,
} from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-e2e');

describe('Flow external-agent — e2e', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeExternalAgentPolicy(dataDir);
    process.env.FLOW_EXTERNAL_AGENT_ENABLED = '1';
    process.env.FLOW_AUTHORING_WRITES = '1';
    const bundle = makeExternalToolFlowBundle();
    upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
    delete process.env.FLOW_AUTHORING_WRITES;
  });

  it('mint grant → fetch agent_bundle → invoke → revoke', async () => {
    const mint = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
    });
    assert.equal(mint.ok, true);

    const project = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      harness: 'agent_bundle',
      cliScopes: ['personal'],
    });
    assert.equal(project.ok, true);
    const bundle = JSON.parse(project.payload.projection.rendered);
    assert.equal(bundle.schema, 'knowtation.agent_bundle/v0');

    const invoke = handleFlowExternalToolInvokeRequest({
      dataDir,
      vaultId,
      toolId: 'web_search',
      bearer: mint.payload.bearer,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
    });
    assert.equal(invoke.ok, true);

    const revoke = handleFlowExternalGrantRevokeRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
    });
    assert.equal(revoke.ok, true);

    const denied = validateExternalGrantBearer({
      dataDir,
      vaultId,
      bearer: mint.payload.bearer,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'FLOW_EXTERNAL_GRANT_REVOKED');
  });

  it('import with unknown external_tool refused before proposal', async () => {
    const bad = makeExternalToolFlowBundle({ toolId: 'unknown_tool_xyz' });
    const result = await handleFlowProposeRequest({
      dataDir,
      vaultId,
      kind: 'import',
      bundle: bad,
      intent: 'import bad tools',
      createProposal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_IMPORT_EXTERNAL_TOOL_DENIED');
  });
});
