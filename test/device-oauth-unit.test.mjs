/**
 * Phase B — device OAuth (RFC 8628): unit tier.
 *
 * Store primitives (user/device code generation, normalization, hash-at-rest),
 * approve/deny/poll state machine, scope ceiling helper, TTL constants, and
 * single-use consumption after approval.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  generateUserCode,
  normalizeUserCode,
  hashDeviceCode,
  createDeviceAuthorization,
  approveUserCode,
  denyUserCode,
  pollDeviceCode,
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_SEC,
} from '../hub/gateway/device-oauth-store.mjs';
import {
  applyDeviceScopeCeiling,
  DEVICE_CODE_TTL_MS as PROVIDER_TTL_MS,
  MCP_TOKEN_EXPIRY_SECONDS,
} from '../hub/gateway/device-oauth-provider.mjs';
import { createTempStrongStore } from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B unit — code helpers', () => {
  it('generateUserCode produces XXXX-XXXX with safe alphabet', () => {
    const code = generateUserCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(!code.includes('O'));
    assert.ok(!code.includes('0'));
    assert.ok(!code.includes('I'));
    assert.ok(!code.includes('1'));
  });

  it('normalizeUserCode strips spaces/hyphens and uppercases', () => {
    assert.equal(normalizeUserCode('abcd-efgh'), 'ABCD-EFGH');
    assert.equal(normalizeUserCode(' abcd efgh '), 'ABCD-EFGH');
    assert.equal(normalizeUserCode('ABCD EFGH'), 'ABCD-EFGH');
  });

  it('hashDeviceCode is deterministic sha256 hex', () => {
    const h1 = hashDeviceCode('secret-device-code');
    const h2 = hashDeviceCode('secret-device-code');
    assert.equal(h1, h2);
    assert.match(h1, /^[a-f0-9]{64}$/);
    assert.notEqual(h1, hashDeviceCode('other'));
  });
});

describe('Phase B unit — TTL constants', () => {
  it('device code TTL is 15 minutes and poll interval defaults to 5s', () => {
    assert.equal(DEVICE_CODE_TTL_MS, 15 * 60 * 1000);
    assert.equal(DEVICE_POLL_INTERVAL_SEC, 5);
    assert.equal(PROVIDER_TTL_MS, DEVICE_CODE_TTL_MS);
    assert.equal(MCP_TOKEN_EXPIRY_SECONDS, 3600);
  });
});

describe('Phase B unit — applyDeviceScopeCeiling', () => {
  it('filters requested scopes to ceiling', () => {
    assert.deepEqual(
      applyDeviceScopeCeiling(['vault:read', 'vault:write', 'admin'], ['vault:read', 'vault:write']),
      ['vault:read', 'vault:write']
    );
  });

  it('empty ceiling falls back to vault:read only', () => {
    assert.deepEqual(applyDeviceScopeCeiling(['vault:write'], []), ['vault:read']);
  });

  it('empty requested returns full ceiling', () => {
    assert.deepEqual(applyDeviceScopeCeiling([], ['vault:read', 'vault:write']), ['vault:read', 'vault:write']);
  });
});

describe('Phase B unit — store lifecycle', () => {
  it('createDeviceAuthorization stores hash not raw device_code', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const created = await createDeviceAuthorization({ clientId: 'unit-test' });
    const raw = await fs.readFile(path.join(tmp.dir, 'device_pending_codes.json'), 'utf8');
    assert.ok(!raw.includes(created.deviceCode), 'raw device_code must not appear in store');
    assert.ok(raw.includes(hashDeviceCode(created.deviceCode)), 'store key must be hash');
    assert.ok(raw.includes(created.userCode), 'user_code is stored for Hub lookup');
  });

  it('approveUserCode / denyUserCode / pollDeviceCode happy paths', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const { deviceCode, userCode } = await createDeviceAuthorization({ intervalSec: 1 });

    const pending = await pollDeviceCode(deviceCode);
    assert.equal(pending.status, 'authorization_pending');

    const approved = await approveUserCode(userCode, 'google:device-test');
    assert.equal(approved.ok, true);
    assert.equal(approved.entry.status, 'approved');
    assert.equal(approved.entry.userId, 'google:device-test');

    const pollOk = await pollDeviceCode(deviceCode);
    assert.equal(pollOk.status, 'approved');
    assert.equal(pollOk.entry.userId, 'google:device-test');
  });

  it('denyUserCode yields access_denied on poll', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const { deviceCode, userCode } = await createDeviceAuthorization({ intervalSec: 1 });
    const denied = await denyUserCode(userCode, 'google:device-test');
    assert.equal(denied.ok, true);
    const poll = await pollDeviceCode(deviceCode);
    assert.equal(poll.status, 'access_denied');
  });

  it('single-use: second poll after approve returns invalid_grant', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const { deviceCode, userCode } = await createDeviceAuthorization({ intervalSec: 1 });
    await approveUserCode(userCode, 'google:device-test');
    const first = await pollDeviceCode(deviceCode);
    assert.equal(first.status, 'approved');
    const second = await pollDeviceCode(deviceCode);
    assert.equal(second.status, 'invalid_grant');
  });

  it('poll too fast within interval returns slow_down', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const { deviceCode } = await createDeviceAuthorization({ intervalSec: 60 });
    const first = await pollDeviceCode(deviceCode);
    assert.equal(first.status, 'authorization_pending');
    const fast = await pollDeviceCode(deviceCode);
    assert.equal(fast.status, 'slow_down');
  });
});
