/**
 * Tier 6 — PERFORMANCE: observe + dedup scan + list bounded.
 *
 * @see lib/flow/flow-capture.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowCaptureObserveRequest,
  handleFlowCaptureListRequest,
  handleFlowCaptureProposeRequest,
  computeStructuralOverlap,
} from '../lib/flow/flow-capture.mjs';
import { applyFlowProposalToIndex } from '../lib/flow/flow-authoring.mjs';
import { upsertCandidate } from '../lib/flow/flow-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { makeFlowBundle, emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';
import { validSessionMeta, makeCandidateRecord } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-perf');
const visible = new Set(['personal', 'project', 'org']);
const P95_BUDGET_MS = 500;

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Flow capture — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_CAPTURE_DETECTION_ENABLED = '1';
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('observe + dedup overlap scan within p95 budget on large index', async () => {
    const starterDir = emptyStarterDir(dataDir);
    for (let i = 0; i < 40; i += 1) {
      const bundle = makeFlowBundle({ flowId: `flow_perf_${i}`, steps: 3 });
      applyFlowProposalToIndex(dataDir, vaultId, bundle.flow, bundle.steps);
    }
    upsertCandidate(dataDir, vaultId, makeCandidateRecord({ candidate_id: 'cand_perf1' }));

    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      await handleFlowCaptureProposeRequest({
        dataDir, vaultId, visibleScopes: visible, candidateId: 'cand_perf1', confirmedScope: 'personal', intent: 'x', createProposal, starterDir,
      });
      samples.push(performance.now() - t0);
    }
    assert.ok(p95(samples) < P95_BUDGET_MS, `p95 ${p95(samples)}ms exceeds ${P95_BUDGET_MS}ms`);
  });

  it('list candidates bounded', async () => {
    for (let i = 0; i < 60; i += 1) {
      upsertCandidate(dataDir, vaultId, makeCandidateRecord({ candidate_id: `cand_p${String(i).padStart(3, '0')}` }));
    }
    const t0 = performance.now();
    const r = handleFlowCaptureListRequest({ dataDir, vaultId, visibleScopes: visible, limit: 50 });
    const elapsed = performance.now() - t0;
    assert.equal(r.payload.candidates.length, 50);
    assert.ok(elapsed < P95_BUDGET_MS);
  });

  it('overlap helper is linear in token sets', async () => {
    const draft = Array.from({ length: 32 }, (_, i) => `step token${i} action verify`);
    const steps = Array.from({ length: 32 }, (_, i) => ({
      owned_job: `token${i}`,
      instruction: `action verify step ${i}`,
      skill_refs: [],
    }));
    const t0 = performance.now();
    for (let i = 0; i < 200; i += 1) computeStructuralOverlap(draft, steps);
    assert.ok(performance.now() - t0 < P95_BUDGET_MS);
  });

  it('observe path bounded for valid meta', async () => {
    const samples = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      handleFlowCaptureObserveRequest({
        dataDir, vaultId, visibleScopes: visible, sessionMeta: validSessionMeta({ session_id: 'a'.repeat(64) }),
      });
      samples.push(performance.now() - t0);
    }
    assert.ok(p95(samples) < P95_BUDGET_MS);
  });
});
