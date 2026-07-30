/**
 * Tier 1 — UNIT: capture thresholds, validation, confidence, gating envelopes.
 *
 * @see lib/flow/flow-capture.mjs
 * @see docs/FLOW-CAPTURE-FLYWHEEL-CONTRACT-7A-L4.md §4, §10
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOW_CAPTURE_MIN_REPETITIONS,
  FLOW_CAPTURE_MIN_CONFIDENCE,
  FLOW_CAPTURE_PER_SESSION_CAP,
  FLOW_CAPTURE_DEDUP_OVERLAP,
  MAX_SESSION_SIGNAL_REFS,
  MAX_CANDIDATE_SUMMARIES,
  MAX_DRAFT_STEPS,
  FLOW_CANDIDATE_SCHEMA,
  FLOW_CAPTURE_PROPOSAL_SCHEMA,
  validateSessionMeta,
  deriveConfidence,
  validateCandidate,
  runDetectors,
  getFlowCaptureDetectionEnabled,
  getFlowCaptureWritesEnabled,
  handleFlowCaptureObserveRequest,
  handleFlowCaptureProposeRequest,
  handleFlowCaptureDismissRequest,
} from '../lib/flow/flow-capture.mjs';
import { upsertCandidate } from '../lib/flow/flow-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { validSessionMeta, payloadBearingSessionMeta, makeCandidateRecord } from './fixtures/flow/capture-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-capture-unit');

describe('pinned threshold constants', () => {
  it('match contract §4.3', async () => {
    assert.equal(FLOW_CAPTURE_MIN_REPETITIONS, 3);
    assert.equal(FLOW_CAPTURE_MIN_CONFIDENCE, 'medium');
    assert.equal(FLOW_CAPTURE_PER_SESSION_CAP, 2);
    assert.equal(FLOW_CAPTURE_DEDUP_OVERLAP, 0.8);
    assert.equal(MAX_SESSION_SIGNAL_REFS, 64);
    assert.equal(MAX_CANDIDATE_SUMMARIES, 50);
    assert.equal(MAX_DRAFT_STEPS, 32);
  });
});

describe('validateSessionMeta — rejects raw content', () => {
  it('accepts valid structural meta', async () => {
    const r = validateSessionMeta(validSessionMeta());
    assert.equal(r.ok, true);
  });

  it('rejects payload-bearing forbidden keys', async () => {
    const r = validateSessionMeta(payloadBearingSessionMeta());
    assert.equal(r.ok, false);
  });

  it('rejects unbounded step_sequence_refs', async () => {
    const refs = Array.from({ length: MAX_SESSION_SIGNAL_REFS + 1 }, (_, i) => `flow_x#${i + 1}`);
    const r = validateSessionMeta(validSessionMeta({ step_sequence_refs: refs }));
    assert.equal(r.ok, false);
  });
});

describe('deriveConfidence — bounded enum', () => {
  it('low at threshold edge with single signal', async () => {
    assert.equal(deriveConfidence('repetition', 2), 'low');
  });

  it('medium at threshold', async () => {
    assert.equal(deriveConfidence('repetition', FLOW_CAPTURE_MIN_REPETITIONS), 'medium');
  });

  it('high at 2× threshold or multi-signal', async () => {
    assert.equal(deriveConfidence('repetition', FLOW_CAPTURE_MIN_REPETITIONS * 2), 'high');
    assert.equal(deriveConfidence('repetition', 3, 2), 'high');
  });
});

describe('validateCandidate — stamps knowtation.flow_candidate/v0', () => {
  it('accepts canonical candidate', async () => {
    const r = validateCandidate(makeCandidateRecord());
    assert.equal(r.ok, true);
    assert.equal(r.candidate.schema, FLOW_CANDIDATE_SCHEMA);
  });

  it('rejects malformed candidate_id', async () => {
    const r = validateCandidate(makeCandidateRecord({ candidate_id: 'bad' }));
    assert.equal(r.ok, false);
  });
});

describe('runDetectors — server-side only', () => {
  it('emits repetition when count meets threshold', async () => {
    const hits = runDetectors(validSessionMeta(), { session_extraction_opt_in: false });
    assert.ok(hits.some((h) => h.signal === 'repetition'));
  });
});

describe('gating — sub-gates default OFF', () => {
  const dataDir = path.join(tmpRoot, 'gate');

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
  });

  it('detection defaults off', async () => {
    assert.equal(getFlowCaptureDetectionEnabled(dataDir), false);
    assert.equal(getFlowCaptureWritesEnabled(dataDir), false);
  });

  it('observe off ⇒ detection_authorized false, no candidates', async () => {
    const r = handleFlowCaptureObserveRequest({
      dataDir,
      vaultId: 'default',
      sessionMeta: validSessionMeta(),
    });
    assert.equal(r.ok, true);
    assert.equal(r.payload.detection_authorized, false);
    assert.equal(r.payload.returned_count, 0);
  });

  it('propose off ⇒ FLOW_CAPTURE_WRITES_DISABLED', async () => {
    const r = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      candidateId: 'cand_a1b2c3d4',
      confirmedScope: 'personal',
      intent: 'promote',
      createProposal,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'FLOW_CAPTURE_WRITES_DISABLED');
  });

  it('dismiss off ⇒ FLOW_CAPTURE_WRITES_DISABLED', async () => {
    const r = await handleFlowCaptureDismissRequest({
      dataDir,
      vaultId: 'default',
      candidateId: 'cand_a1b2c3d4',
      intent: 'dismiss',
      createProposal,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'FLOW_CAPTURE_WRITES_DISABLED');
  });
});

describe('proposal envelopes when writes forced on', () => {
  const dataDir = path.join(tmpRoot, 'writes');
  const visible = new Set(['personal', 'project', 'org']);

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_CAPTURE_WRITES_ENABLED = '1';
    process.env.FLOW_CAPTURE_DETECTION_ENABLED = '1';
    upsertCandidate(dataDir, 'default', makeCandidateRecord());
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_CAPTURE_WRITES_ENABLED;
    delete process.env.FLOW_CAPTURE_DETECTION_ENABLED;
  });

  it('propose stamps flow_candidate_promote envelope', async () => {
    const r = await handleFlowCaptureProposeRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_a1b2c3d4',
      confirmedScope: 'personal',
      intent: 'Promote weekly verify',
      createProposal,
    });
    assert.equal(r.ok, true);
    assert.equal(r.payload.schema, FLOW_CAPTURE_PROPOSAL_SCHEMA);
    assert.equal(r.payload.proposal_kind, 'flow_candidate_promote');
  });

  it('dismiss stamps flow_candidate_dismiss envelope', async () => {
    const r = await handleFlowCaptureDismissRequest({
      dataDir,
      vaultId: 'default',
      visibleScopes: visible,
      candidateId: 'cand_a1b2c3d4',
      intent: 'Not recurring',
      createProposal,
    });
    assert.equal(r.ok, true);
    assert.equal(r.payload.proposal_kind, 'flow_candidate_dismiss');
  });
});
