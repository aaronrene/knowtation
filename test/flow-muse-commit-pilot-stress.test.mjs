/**
 * Stress — repeated evidence validation on pilot artifacts (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertNoSecretLeakageInProjection,
  parseGeneratedMarkerVersion,
  MUSE_COMMIT_PILOT_EVIDENCE_REL,
} from '../lib/flow/muse-commit-pilot-evidence.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WS = join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'pilot-workspace');

describe('flow-muse-commit-pilot (stress, 7A-14)', () => {
  it('1000 secret scans on both pilot projections stay clean', () => {
    const runbook = readFileSync(join(WS, 'overseer.AGENTS.md'), 'utf8');
    const cursor = readFileSync(join(WS, 'overseer.cursor.mdc'), 'utf8');
    for (let i = 0; i < 1000; i += 1) {
      assert.equal(assertNoSecretLeakageInProjection(runbook).ok, true);
      assert.equal(assertNoSecretLeakageInProjection(cursor).ok, true);
      assert.equal(parseGeneratedMarkerVersion(runbook), '0.2.0');
      assert.equal(parseGeneratedMarkerVersion(cursor), '0.2.0');
    }
  });
});
