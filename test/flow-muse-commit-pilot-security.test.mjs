/**
 * Security — pilot projections resist injection and leak scans (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertNoSecretLeakageInProjection,
  MUSE_COMMIT_PILOT_EVIDENCE_REL,
} from '../lib/flow/muse-commit-pilot-evidence.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WS = join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'pilot-workspace');

describe('flow-muse-commit-pilot (security, 7A-14)', () => {
  it('pilot projections escape angle brackets in step instructions', () => {
    const runbook = readFileSync(join(WS, 'overseer.AGENTS.md'), 'utf8');
    assert.match(runbook, /muse -C .*&lt;abs path&gt;/);
    assert.doesNotMatch(runbook, /muse -C <abs path>/);
  });

  it('no credential patterns in any committed pilot-workspace byte', () => {
    for (const name of ['overseer.AGENTS.md', 'overseer.cursor.mdc']) {
      const content = readFileSync(join(WS, name), 'utf8');
      const check = assertNoSecretLeakageInProjection(content);
      assert.equal(check.ok, true, check.ok ? '' : check.matches?.join('; '));
    }
  });

  it('hand-edited artifact is not byte-equal to canonical (drift input)', () => {
    const art = join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts');
    const canonical = readFileSync(join(art, 'overseer.AGENTS.v0.2.0.md'), 'utf8');
    const handedited = readFileSync(join(art, 'overseer.AGENTS.handedited.md'), 'utf8');
    assert.notEqual(handedited, canonical);
  });
});
