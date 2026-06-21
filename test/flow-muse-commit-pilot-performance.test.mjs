/**
 * Performance — evidence validators stay fast on pilot artifact sizes (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertNoSecretLeakageInProjection,
  assertCleanAntiDriftDiff,
  MUSE_COMMIT_PILOT_EVIDENCE_REL,
} from '../lib/flow/muse-commit-pilot-evidence.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ART = join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts');
const WS = join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'pilot-workspace');

describe('flow-muse-commit-pilot (performance, 7A-14)', () => {
  it('100 secret scans + diff checks complete under 500ms p95 budget', () => {
    const runbook = readFileSync(join(WS, 'overseer.AGENTS.md'), 'utf8');
    const diff = readFileSync(join(ART, 'overseer.runbook.v1-to-v2.diff'), 'utf8');
    const start = performance.now();
    for (let i = 0; i < 100; i += 1) {
      assertNoSecretLeakageInProjection(runbook);
      assertCleanAntiDriftDiff(diff);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 500, `elapsed ${elapsed}ms exceeds 500ms budget`);
  });
});
