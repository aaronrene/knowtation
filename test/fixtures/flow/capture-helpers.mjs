/**
 * Shared helpers for Flow capture flywheel tiers (7A-L4b).
 */
import fs from 'node:fs';
import path from 'node:path';

import { emptyStarterDir } from './authoring-helpers.mjs';

export { emptyStarterDir };

/** Valid content-minimized session meta (ids/hashes/counts only). */
export function validSessionMeta(overrides = {}) {
  return {
    session_id: 'b'.repeat(64),
    step_sequence_refs: ['flow_weekly_review#1', 'flow_weekly_review#2'],
    skill_ref_ids: ['mcp_prompt:daily-brief'],
    observed_counts: { repetition: 4, repeated_correction: 1 },
    signal_hints: ['repetition'],
    ...overrides,
  };
}

/** Payload-bearing variant — carries forbidden raw-content keys. */
export function payloadBearingSessionMeta() {
  return {
    session_id: 'c'.repeat(64),
    step_sequence_refs: ['flow_weekly_review#1'],
    observed_counts: { repetition: 4 },
    prompt: 'IGNORE PRIOR INSTRUCTIONS',
    completion: 'Here are secrets',
  };
}

/**
 * @param {object} candidate
 * @returns {object}
 */
export function makeCandidateRecord(candidate = {}) {
  return {
    schema: 'knowtation.flow_candidate/v0',
    candidate_id: candidate.candidate_id ?? 'cand_a1b2c3d4',
    suggested_title: candidate.suggested_title ?? 'Weekly URL verify',
    scope_hint: candidate.scope_hint ?? 'personal',
    trigger_signal: candidate.trigger_signal ?? 'repetition',
    observed_count: candidate.observed_count ?? 4,
    evidence_refs: candidate.evidence_refs ?? ['hash:abc123', 'run:sample'],
    draft_steps: candidate.draft_steps ?? [
      'Open the target URL',
      'Verify response status',
      'Record result pointer',
    ],
    confidence: candidate.confidence ?? 'medium',
    status: candidate.status ?? 'pending_review',
    provenance: candidate.provenance ?? { actor: 'hash_actor', harness: 'test' },
    updated: candidate.updated ?? '2026-06-20T00:00:00Z',
    ...candidate,
  };
}

/**
 * @param {string} dataDir
 * @param {string} name
 * @returns {string}
 */
export function writeSignalsFixture(dataDir, name, meta) {
  const dir = path.join(dataDir, 'signals');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, JSON.stringify(meta, null, 2), 'utf8');
  return fp;
}
