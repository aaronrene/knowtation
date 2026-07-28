/**
 * Phase C — stress: concurrent exchanges must not revoke opaque credential.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mintCredential,
  verifyCredential,
} from '../hub/lib/agent-credential-core.mjs';

describe('Phase C stress — concurrent verify', () => {
  it('100 sequential verifies leave credential valid (no consume-on-use)', () => {
    let { records, credential } = mintCredential({}, {
      sub: 'google:1',
      name: 'stress',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
      now: Date.now(),
    });
    for (let i = 0; i < 100; i += 1) {
      const v = verifyCredential(records, credential, { now: Date.now() + i });
      assert.equal(v.ok, true, `verify ${i} failed`);
      records = v.records;
    }
    const last = verifyCredential(records, credential, { now: Date.now() + 1000 });
    assert.equal(last.ok, true);
  });

  it('parallel verify clones do not invent reuse failures', async () => {
    const { records, credential } = mintCredential({}, {
      sub: 'google:1',
      name: 'stress-p',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
    });
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        Promise.resolve(verifyCredential(records, credential))
      )
    );
    assert.ok(results.every((r) => r.ok === true));
  });
});
