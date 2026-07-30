/**
 * Tier 4 — STRESS: caps, concurrent propose, list truncation.
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
  MAX_SESSION_SIGNAL_REFS,
  MAX_CANDIDATE_SUMMARIES,
  FLOW_CAPTURE_PER_SESSION_CAP,
} from '../lib/flow/flow-capture.mjs';
import { upsertCandidate } from '../lib/flow/flow-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { validSessionMeta, makeCandidateRecord } from './fixtures/flow/capture-helpers.mjs';
import { emptyStarterDir } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-stress');
const visible = new Set(['personal', 'project', 'org']);

describe('Flow capture — stress', () => {
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

  it('rejects observe at MAX_SESSION_SIGNAL_REFS + 1', async () => {
    const refs = Array.from({ length: MAX_SESSION_SIGNAL_REFS + 1 }, (_, i) => `flow_x#${i + 1}`);
    const r = handleFlowCaptureObserveRequest({
      dataDir, vaultId, visibleScopes: visible, sessionMeta: validSessionMeta({ step_sequence_refs: refs }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'FLOW_CAPTURE_SIGNAL_MALFORMED');
  });

  it('enforces per-session cap on new candidates', async () => {
    const meta = validSessionMeta({
      observed_counts: {
        repetition: 4,
        re_explanation: 4,
        repeated_correction: 4,
        review_debt: 2,
      },
    });
    const r = handleFlowCaptureObserveRequest({ dataDir, vaultId, visibleScopes: visible, sessionMeta: meta });
    assert.equal(r.ok, true);
    assert.ok(r.payload.returned_count <= FLOW_CAPTURE_PER_SESSION_CAP);
  });

  it('list at MAX_CANDIDATE_SUMMARIES sets truncated', async () => {
    for (let i = 0; i < MAX_CANDIDATE_SUMMARIES + 5; i += 1) {
      upsertCandidate(
        dataDir,
        vaultId,
        makeCandidateRecord({ candidate_id: `cand_${String(i).padStart(4, '0')}` }),
      );
    }
    const r = handleFlowCaptureListRequest({ dataDir, vaultId, visibleScopes: visible, limit: MAX_CANDIDATE_SUMMARIES });
    assert.equal(r.payload.candidates.length, MAX_CANDIDATE_SUMMARIES);
    assert.equal(r.payload.truncated, true);
  });

  it('concurrent propose on same candidate — exactly one succeeds', async () => {
    upsertCandidate(dataDir, vaultId, makeCandidateRecord({ candidate_id: 'cand_concurrent' }));
    const starterDir = emptyStarterDir(dataDir);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        handleFlowCaptureProposeRequest({
          dataDir,
          vaultId,
          visibleScopes: visible,
          candidateId: 'cand_concurrent',
          confirmedScope: 'personal',
          intent: 'x',
          createProposal,
          starterDir,
        }),
      ),
    );
    const okCount = results.filter((r) => r.ok).length;
    assert.equal(okCount, 1);
    const conflict = results.filter((r) => !r.ok && r.code === 'FLOW_CANDIDATE_NOT_PROMOTABLE');
    assert.ok(conflict.length >= 1);
  });
});
