/**
 * Phase C — performance: local exchange/verify budget.
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
});
