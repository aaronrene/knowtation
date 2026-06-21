/**
 * Integration tests — pilot evidence on disk + generator parity (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPilotEvidencePathsExist,
  loadAndValidatePilotProjection,
  assertCleanAntiDriftDiff,
  MUSE_COMMIT_PILOT_EVIDENCE_REL,
} from '../lib/flow/muse-commit-pilot-evidence.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('flow-muse-commit-pilot (integration, 7A-14)', () => {
  it('evidence directory contains pilot workspace, artifacts, and driver', () => {
    const result = assertPilotEvidencePathsExist(REPO_ROOT);
    assert.equal(result.ok, true, result.ok ? '' : `missing: ${result.missing?.join(', ')}`);
  });

  it('pilot-workspace projections carry v0.2.0 marker after pilot run', () => {
    loadAndValidatePilotProjection(REPO_ROOT, 'overseer.AGENTS.md', '0.2.0');
    loadAndValidatePilotProjection(REPO_ROOT, 'overseer.cursor.mdc', '0.2.0');
  });

  it('anti-drift diffs in artifacts/ are clean (marker + one content line)', () => {
    const runbookDiff = readFileSync(
      join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts', 'overseer.runbook.v1-to-v2.diff'),
      'utf8',
    );
    const cursorDiff = readFileSync(
      join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts', 'overseer.cursor.v1-to-v2.diff'),
      'utf8',
    );
    assert.deepEqual(assertCleanAntiDriftDiff(runbookDiff), { ok: true });
    assert.deepEqual(assertCleanAntiDriftDiff(cursorDiff), { ok: true });
  });

  it('transcript records muse commit SHAs before and after pilot commits', () => {
    const before = readFileSync(
      join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts', 'muse-sha-before.txt'),
      'utf8',
    );
    const after = readFileSync(
      join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts', 'muse-sha-after.txt'),
      'utf8',
    );
    assert.match(before, /sha256:[a-f0-9]{64}/);
    assert.match(after, /sha256:[a-f0-9]{64}/);
    assert.notEqual(before, after);
  });
});
