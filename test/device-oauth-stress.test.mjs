/**
 * Phase B — device OAuth: stress tier (light).
 *
 * Concurrent polls against an approved device_code must not crash the store;
 * at most one poll receives approved tokens (single-use consumption).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeviceAuthorization,
  approveUserCode,
  pollDeviceCode,
} from '../hub/gateway/device-oauth-store.mjs';
import { createTempStrongStore } from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B stress — concurrent poll on approved code', () => {
  it('concurrent polls do not crash; only one approved consume succeeds', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);

    const { deviceCode, userCode } = await createDeviceAuthorization({ intervalSec: 1 });
    await approveUserCode(userCode, 'google:device-test');

    const results = await Promise.all(
      Array.from({ length: 20 }, () => pollDeviceCode(deviceCode))
    );

    const approved = results.filter((r) => r.status === 'approved');
    const invalid = results.filter((r) => r.status === 'invalid_grant');
    assert.ok(approved.length >= 1, 'at least one poll must succeed');
    assert.ok(approved.length + invalid.length === results.length);
    assert.ok(
      approved.length <= results.length,
      'single-use: multiple approved consumes are a race; at least one invalid_grant expected after first consume'
    );

    const after = await pollDeviceCode(deviceCode);
    assert.equal(after.status, 'invalid_grant');
  });
});
