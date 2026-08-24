/**
 * Phase C + Lane D — performance: local exchange/verify budget with failure persist.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mintCredential, verifyCredential } from '../hub/lib/agent-credential-core.mjs';

describe('Phase C performance — agent credentials', () => {
  it('1000 verifies complete under 250ms locally', () => {
    const { records, credential } = mintCredential({}, {
      sub: 'google:1',
      name: 'perf',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
    });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      const v = verifyCredential(records, credential);
      assert.equal(v.ok, true);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `expected <250ms, got ${ms.toFixed(1)}ms`);
  });

  it('500 known-id failure persists stay under 250ms locally', () => {
    const { records, credential, id } = mintCredential({}, {
      sub: 'google:1',
      name: 'perf-fail',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
    });
    const bad = credential.replace(/.$/, 'x');
    const t0 = performance.now();
    for (let i = 0; i < 500; i += 1) {
      const v = verifyCredential(records, bad, { now: Date.now() + i });
      assert.equal(v.ok, false);
      assert.equal(v.id, id);
      assert.ok(v.records);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `expected <250ms, got ${ms.toFixed(1)}ms`);
  });
});
