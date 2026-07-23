/**
 * Phase B — device OAuth: performance tier (light).
 *
 * Bulk device authorization creation completes within a reasonable wall-clock
 * budget on a temp data directory.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceAuthorization } from '../hub/gateway/device-oauth-store.mjs';
import { createTempStrongStore } from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B performance — bulk authorization create', () => {
  it('50 createDeviceAuthorization calls complete under 5 seconds', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);

    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      const created = await createDeviceAuthorization({ clientId: `perf-${i}` });
      assert.ok(created.deviceCode);
      assert.ok(created.userCode);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `50 creates took ${elapsed}ms (budget 5000ms)`);
  });
});
