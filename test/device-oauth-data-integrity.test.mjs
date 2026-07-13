/**
 * Phase B — device OAuth: data-integrity tier.
 *
 * Corrupt pending store fail-closed, expired entry pruning, and hash-at-rest
 * invariants for device codes on disk.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createDeviceAuthorization,
  findByUserCode,
  pruneExpiredDeviceCodes,
  listPendingForDisplay,
  hashDeviceCode,
} from '../hub/gateway/device-oauth-store.mjs';
import { createTempStrongStore } from './helpers/device-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase B data-integrity — store durability', () => {
  it('corrupt device_pending_codes.json fails closed (empty lookup)', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    await fs.writeFile(path.join(tmp.dir, 'device_pending_codes.json'), '{not-json', 'utf8');
    const found = await findByUserCode('ABCD-EFGH');
    assert.equal(found, null);
  });

  it('malformed device entries are dropped on read', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const goodHash = hashDeviceCode('device-secret-for-integrity');
    await fs.writeFile(
      path.join(tmp.dir, 'device_pending_codes.json'),
      JSON.stringify({
        devices: {
          [goodHash]: {
            userCode: 'WXYZ-2345',
            clientId: 'good',
            expires: Date.now() + 600_000,
            status: 'pending',
          },
          bad: { userCode: 'x' },
          alsoBad: null,
        },
      }),
      'utf8'
    );
    const found = await findByUserCode('WXYZ-2345');
    assert.ok(found);
    assert.equal(found.entry.clientId, 'good');
  });

  it('expired codes are pruned and omitted from pending list', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const expiredHash = hashDeviceCode('expired-device');
    const liveHash = hashDeviceCode('live-device');
    const now = Date.now();
    await fs.writeFile(
      path.join(tmp.dir, 'device_pending_codes.json'),
      JSON.stringify({
        devices: {
          [expiredHash]: {
            userCode: 'EXPI-RED1',
            clientId: 'old',
            clientName: 'Old',
            scopes: ['vault:read'],
            userId: null,
            status: 'pending',
            interval: 5,
            lastPollAt: 0,
            expires: now - 1000,
            vaultId: null,
          },
          [liveHash]: {
            userCode: 'LIVE-CODE',
            clientId: 'new',
            clientName: 'New',
            scopes: ['vault:read'],
            userId: null,
            status: 'pending',
            interval: 5,
            lastPollAt: 0,
            expires: now + 600_000,
            vaultId: null,
          },
        },
      }),
      'utf8'
    );

    const { removed } = await pruneExpiredDeviceCodes();
    assert.equal(removed, 1);

    const pending = await listPendingForDisplay();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].userCode, 'LIVE-CODE');
  });

  it('hash-at-rest: createDeviceAuthorization never persists raw device_code', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    const created = await createDeviceAuthorization();
    const raw = await fs.readFile(path.join(tmp.dir, 'device_pending_codes.json'), 'utf8');
    assert.ok(!raw.includes(created.deviceCode));
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed.devices);
    assert.equal(keys.length, 1);
    assert.equal(keys[0], hashDeviceCode(created.deviceCode));
  });
});
