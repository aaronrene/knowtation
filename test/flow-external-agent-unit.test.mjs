/**
 * Tier 1 — UNIT: external-agent gate helpers, grant schema, harness gating.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getFlowExternalAgentEnabled,
  collectFlowExternalToolRefs,
  intersectGrantTools,
  grantForClient,
  hashGrantBearer,
  FLOW_EXTERNAL_GRANT_SCHEMA,
} from '../lib/flow/external-agent.mjs';
import {
  isHarnessActive,
  isAgentBundleInert,
  renderAgentBundle,
  INERT_HARNESSES,
} from '../lib/flow/projection-generator.mjs';
import { writeExternalAgentPolicy, makeExternalToolFlowBundle } from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-unit');

describe('Flow external-agent — unit', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
  });

  it('gate defaults off; policy file can enable', () => {
    const dataDir = path.join(tmpRoot, 'off');
    fs.mkdirSync(dataDir);
    assert.equal(getFlowExternalAgentEnabled(dataDir), false);
    writeExternalAgentPolicy(dataDir);
    assert.equal(getFlowExternalAgentEnabled(dataDir), true);
  });

  it('isHarnessActive: agent_bundle only when gate on', () => {
    assert.equal(isHarnessActive('agent_bundle'), false);
    assert.equal(isHarnessActive('agent_bundle', { agentBundleEnabled: true }), true);
    assert.equal(isAgentBundleInert(false), true);
    assert.equal(isAgentBundleInert(true), false);
    assert.ok(INERT_HARNESSES.has('agent_bundle'));
  });

  it('grantForClient never includes bearer hash', () => {
    const stored = {
      schema: FLOW_EXTERNAL_GRANT_SCHEMA,
      grant_id: 'fgrnt_test',
      grant_bearer_hash: hashGrantBearer('fgrnt_bearer_secret'),
    };
    const client = grantForClient(stored);
    assert.equal(client.grant_bearer_hash, undefined);
    assert.equal(JSON.stringify(client).includes('bearer'), false);
  });

  it('allowlist intersection is deterministic', () => {
    const bundle = makeExternalToolFlowBundle();
    const refs = collectFlowExternalToolRefs(bundle.steps);
    const vault = new Set(['web_search', 'slack_notify']);
    const out = intersectGrantTools(refs, vault, ['web_search', 'slack_notify']);
    assert.deepEqual(out, ['web_search']);
  });

  it('renderAgentBundle validates JSON schema fields', () => {
    const bundle = makeExternalToolFlowBundle();
    const json = JSON.parse(renderAgentBundle(bundle.flow, bundle.steps, ['web_search']));
    assert.equal(json.schema, 'knowtation.agent_bundle/v0');
    assert.equal(json.grant_required, true);
    assert.deepEqual(json.allowed_tools, ['web_search']);
    assert.equal(json.steps.length, 1);
    assert.equal(json.steps[0].skill_refs[0].kind, 'external_tool');
  });
});
