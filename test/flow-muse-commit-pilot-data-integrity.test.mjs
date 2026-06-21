/**
 * Data-integrity — pilot workspace versions align across harnesses (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseGeneratedMarkerVersion,
  MUSE_COMMIT_PILOT_EVIDENCE_REL,
} from '../lib/flow/muse-commit-pilot-evidence.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ART = join(REPO_ROOT, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts');

describe('flow-muse-commit-pilot (data-integrity, 7A-14)', () => {
  it('v0.1.0 and v0.2.0 artifact pairs share harness-specific marker versions', () => {
    const pairs = [
      ['overseer.AGENTS.v0.1.0.md', 'overseer.AGENTS.v0.2.0.md'],
      ['overseer.v0.1.0.mdc', 'overseer.v0.2.0.mdc'],
    ];
    for (const [v1, v2] of pairs) {
      const oldContent = readFileSync(join(ART, v1), 'utf8');
      const newContent = readFileSync(join(ART, v2), 'utf8');
      assert.equal(parseGeneratedMarkerVersion(oldContent), '0.1.0');
      assert.equal(parseGeneratedMarkerVersion(newContent), '0.2.0');
    }
  });

  it('hand-edited artifact differs from canonical v0.2.0 render', () => {
    const canonical = readFileSync(join(ART, 'overseer.AGENTS.v0.2.0.md'), 'utf8');
    const handedited = readFileSync(join(ART, 'overseer.AGENTS.handedited.md'), 'utf8');
    assert.ok(handedited.includes('hand-scribbled note'));
    assert.ok(handedited.length > canonical.length);
  });
});
