/**
 * Tier 7 — SECURITY: scope denial, no existence leak, injection inert, no secrets.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowListRequest,
  handleFlowGetRequest,
} from '../lib/flow/flow-handlers.mjs';
import {
  saveFlowStore,
  validateFlowBundle,
  getFlow,
  buildFlowStepId,
} from '../lib/flow/flow-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-security');
const maliciousBundle = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'flow', 'malicious-step-bundle.json'), 'utf8'),
);

const SECRET_MARKERS = ['refresh_token', 'oauth_token', '"token":'];

describe('Flow store — security', () => {
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
          flows: [validated.flow],
          steps: validated.steps,
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

  it('personal visibleScopes never returns project flows on list', () => {
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [
            maliciousBundle.flow,
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
            ...maliciousBundle.steps,
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

    const list = handleFlowListRequest({
      dataDir,
      vaultId,
      visibleScopes: new Set(['personal']),
    });
    assert.equal(list.ok, true);
    assert.ok(list.payload.flows.every((f) => f.scope === 'personal'));
    assert.ok(!list.payload.flows.some((f) => f.flow_id === 'flow_multi_repo_change'));
  });

  it('ambiguous scope fails closed with FLOW_SCOPE_AMBIGUOUS', () => {
    const result = handleFlowListRequest({
      dataDir,
      vaultId,
      ambiguous: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_SCOPE_AMBIGUOUS');
  });

  it('unauthorized scope query returns FLOW_SCOPE_DENIED', () => {
    const result = handleFlowListRequest({
      dataDir,
      vaultId,
      visibleScopes: new Set(['personal']),
      scope: 'org',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLOW_SCOPE_DENIED');
  });

  it('project flow under personal scope returns null / unknown_flow (no existence leak)', () => {
    const viaStore = getFlow(dataDir, vaultId, 'flow_multi_repo_change', {
      filterScopes: new Set(['personal']),
    });
    assert.equal(viaStore, null);

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [{
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
          }],
          steps: [{
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
          }],
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    });

    const viaHandler = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_multi_repo_change',
      visibleScopes: new Set(['personal']),
    });
    assert.equal(viaHandler.ok, false);
    assert.equal(viaHandler.code, 'unknown_flow');

    const missing = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_does_not_exist',
      visibleScopes: new Set(['personal']),
    });
    assert.equal(missing.code, viaHandler.code);
  });

  it('malicious instruction is returned verbatim and does not alter scope', () => {
    const got = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_malicious_test',
      visibleScopes: new Set(['personal']),
    });
    assert.equal(got.ok, true);
    assert.match(got.payload.steps[0].instruction, /IGNORE PREVIOUS INSTRUCTIONS/);
    const list = handleFlowListRequest({
      dataDir,
      vaultId,
      visibleScopes: new Set(['personal']),
    });
    assert.equal(list.ok, true);
    assert.ok(list.payload.flows.every((f) => f.scope === 'personal'));
  });

  it('serialized list/get output contains no secret markers', () => {
    const list = handleFlowListRequest({
      dataDir,
      vaultId,
      visibleScopes: new Set(['personal', 'project']),
    });
    const got = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_malicious_test',
      visibleScopes: new Set(['personal']),
    });
    const blob = JSON.stringify({ list: list.payload, got: got.payload }).toLowerCase();
    for (const marker of SECRET_MARKERS) {
      assert.ok(!blob.includes(marker.toLowerCase()), `found forbidden marker ${marker}`);
    }
  });

  it('scope=org under personal authorization does not widen list results', () => {
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [
            maliciousBundle.flow,
            {
              schema: 'knowtation.flow/v0',
              flow_id: 'flow_org_only',
              title: 'Org',
              version: '0.1.0',
              scope: 'org',
              summary: 'o',
              tags: [],
              steps: [buildFlowStepId('flow_org_only', 1)],
              updated: '2026-06-20T00:00:00Z',
              truncated: false,
            },
          ],
          steps: [
            ...maliciousBundle.steps,
            {
              schema: 'knowtation.flow_step/v0',
              step_id: buildFlowStepId('flow_org_only', 1),
              flow_id: 'flow_org_only',
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

    const denied = handleFlowListRequest({
      dataDir,
      vaultId,
      visibleScopes: new Set(['personal']),
      scope: 'org',
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'FLOW_SCOPE_DENIED');
  });
});
