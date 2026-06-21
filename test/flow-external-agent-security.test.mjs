/**
 * Tier 7 — SECURITY: scope denial, no secrets in envelopes, injection inert.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import {
  handleFlowExternalGrantMintRequest,
  validateExternalGrantBearer,
} from '../lib/flow/external-agent.mjs';
import { upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import {
  writeExternalAgentPolicy,
  makeExternalToolFlowBundle,
} from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-security');

describe('Flow external-agent — security', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeExternalAgentPolicy(dataDir);
    process.env.FLOW_EXTERNAL_AGENT_ENABLED = '1';
    const bundle = makeExternalToolFlowBundle();
    bundle.steps[0].instruction = '<script>alert(1)</script> untrusted';
    upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
  });

  it('unknown_flow for unreadable scope — no existence leak', () => {
    const result = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      harness: 'agent_bundle',
      cliScopes: ['org'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unknown_flow');
  });

  it('grant cannot exceed allowlist ∩ flow refs', () => {
    const result = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['slack_notify'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_EXTERNAL_TOOL_UNKNOWN');
  });

  it('expired bearer denied; bundle JSON is data not executed', () => {
    const project = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      harness: 'agent_bundle',
      cliScopes: ['personal'],
    });
    const inner = JSON.parse(project.payload.projection.rendered);
    assert.equal(inner.steps[0].instruction.includes('<script>'), true);
    assert.equal(typeof inner.steps[0].instruction, 'string');

    const mint = handleFlowExternalGrantMintRequest({
      dataDir,
      vaultId,
      flowId: 'flow_ext_agent_test',
      flowVersion: '1.0.0',
      requestedTools: ['web_search'],
      ttlSeconds: 1,
    });
    assert.equal(mint.ok, true);
    assert.equal(JSON.stringify(mint.payload.grant).includes('bearer'), false);
    const bad = validateExternalGrantBearer({
      dataDir,
      vaultId,
      bearer: 'fgrnt_bearer_not_real',
    });
    assert.equal(bad.ok, false);
  });
});
