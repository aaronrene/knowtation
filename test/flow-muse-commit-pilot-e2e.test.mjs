/**
 * E2E — Muse commit pilot transcript proves full loop (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TRANSCRIPT = join(REPO_ROOT, 'docs/evidence/7A-14/artifacts/transcript.txt');

describe('flow-muse-commit-pilot (e2e, 7A-14)', () => {
  it('transcript documents generate → muse commit → regenerate → muse commit loop', () => {
    const text = readFileSync(TRANSCRIPT, 'utf8');
    assert.ok(text.includes('Muse commit pilot (7A-14)'));
    assert.ok(text.includes('muse commit v0.1.0 pilot baseline'));
    assert.ok(text.includes('muse commit v0.2.0 pilot update'));
    assert.ok(text.includes('IDENTICAL: regenerated artifact'));
    assert.ok(text.includes('drift: true'));
    assert.ok(text.includes('stale: true'));
  });

  it('transcript records both harness generations into pilot-workspace', () => {
    const text = readFileSync(TRANSCRIPT, 'utf8');
    assert.ok(text.includes('pilot-workspace/overseer.AGENTS.md'));
    assert.ok(text.includes('pilot-workspace/overseer.cursor.mdc'));
  });
});
