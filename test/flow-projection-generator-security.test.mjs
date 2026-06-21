/**
 * Tier 7 — SECURITY: no secrets, injection inert, scope denial, harness fail-closed.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import {
  projectFlow,
  detectDrift,
  isHarnessActive,
} from '../lib/flow/projection-generator.mjs';
import {
  saveFlowStore,
  validateFlowBundle,
  buildFlowStepId,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-projection-security');
const maliciousBundle = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/flow/malicious-step-bundle.json'), 'utf8'),
);

const SECRET_MARKERS = ['refresh_token', 'oauth_token', '"token":', 'Bearer sk-'];

describe('Flow projection — security', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const validated = validateFlowBundle(maliciousBundle);
    assert.equal(validated.ok, true);
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [
            validated.flow,
            {
              schema: 'knowtation.flow/v0',
              flow_id: 'flow_multi_repo_change',
              title: 'Multi repo',
              version: '0.1.0',
              scope: 'project',
              summary: 'p',
              tags: [],
              steps: [buildFlowStepId('flow_multi_repo_change', 1)],
              updated: '2026-06-20T00:00:00Z',
              truncated: false,
            },
          ],
          steps: [
            ...validated.steps,
            {
              schema: 'knowtation.flow_step/v0',
              step_id: buildFlowStepId('flow_multi_repo_change', 1),
              flow_id: 'flow_multi_repo_change',
              ordinal: 1,
              owned_job: 'j',
              instruction: 'i',
              trigger: 't',
              when_not_to_run: 'n',
              boundaries: [],
              output_shape: 'o',
              verification: { kind: 'human_review', evidence_required: false, description: 'd' },
              automatable: 'manual',
            },
          ],
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('envelope and rendered contain no secret markers', () => {
    const result = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_malicious_test',
      harness: 'cli_runbook',
      visibleScopes: new Set(['personal']),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(result.ok, true);
    const blob = JSON.stringify(result.payload);
    for (const marker of SECRET_MARKERS) {
      assert.ok(!blob.includes(marker), `secret marker leaked: ${marker}`);
    }
    for (const marker of SECRET_MARKERS) {
      assert.ok(!result.payload.projection.rendered.includes(marker));
    }
    assert.ok(result.payload.projection.rendered.includes('credential_ref_handle_only'));
  });

  it('malicious instruction renders as inert escaped data', () => {
    const projection = projectFlow(maliciousBundle.flow, maliciousBundle.steps, {
      harness: 'cursor_rule',
    });
    assert.ok(projection.rendered.includes('IGNORE PREVIOUS INSTRUCTIONS'));
    assert.ok(projection.rendered.includes('&lt;') || projection.rendered.includes('IGNORE'));
    assert.equal(projection.editable, false);
  });

  it('personal caller gets 404 unknown_flow for project-scoped flow', () => {
    const denied = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_multi_repo_change',
      harness: 'cli_runbook',
      visibleScopes: new Set(['personal']),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'unknown_flow');
    assert.equal(denied.status, 404);

    const missing = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_does_not_exist',
      harness: 'cli_runbook',
      visibleScopes: new Set(['personal']),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(missing.code, denied.code);
    assert.equal(missing.status, denied.status);
  });

  it('hand-edited artifact is flagged by detectDrift and never promoted', () => {
    const fresh = projectFlow(maliciousBundle.flow, maliciousBundle.steps, {
      harness: 'cli_runbook',
    }).rendered;
    const edited = fresh.replace('IGNORE PREVIOUS', 'PROMOTED EDIT');
    const drift = detectDrift(edited, fresh);
    assert.equal(drift.drift, true);
    assert.equal(drift.reason, 'edited');
  });

  it('reserved/inert harnesses never render partial artifacts', () => {
    for (const harness of ['agent_bundle', 'cursor_skill', 'mcp_prompt']) {
      assert.equal(isHarnessActive(harness), false);
      const result = handleFlowProjectRequest({
        dataDir,
        vaultId,
        flowId: 'flow_malicious_test',
        harness,
        visibleScopes: new Set(['personal']),
        generatedAt: '2026-06-20T00:00:00Z',
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'FLOW_HARNESS_UNSUPPORTED');
      assert.equal(result.payload, undefined);
    }
  });
});
