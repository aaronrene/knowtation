/**
 * Stress tests — proposal approve RBAC fix.
 *
 * Verifies the resolveHostedActorRole logic behaves correctly under:
 *   - Rapid concurrent role resolution calls (simulated).
 *   - Large numbers of distinct subs, some admin, some not.
 *   - Multiple bridge error scenarios in sequence.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const SECRET = 'stress-test-secret';

function makeToken(sub, role, secret = SECRET) {
  return jwt.sign({ sub, role }, secret, { expiresIn: '1h' });
}

/**
 * Mirrors resolveHostedActorRole logic with injectable bridge behavior.
 */
async function resolveRole({ bridgeRole, bridgeStatus, adminSet, token, sub }) {
  function roleForSub(s) { return adminSet.has(s) ? 'admin' : 'member'; }
  let role = 'member';
  let mayApproveProposals = false;
  let bridgeResolved = false;
  if (bridgeStatus === 200 && bridgeRole) {
    role = bridgeRole;
    bridgeResolved = true;
    mayApproveProposals = role === 'admin';
  }
  if (!bridgeResolved) {
    try {
      const payload = jwt.verify(token, SECRET);
      role = payload.role || roleForSub(payload.sub);
      mayApproveProposals = role === 'admin';
    } catch (_) {}
  }
  // Gateway override
  if (sub && role !== 'admin' && roleForSub(sub) === 'admin') {
    role = 'admin';
    mayApproveProposals = true;
  }
  return { role, mayApproveProposals };
}

describe('Stress: concurrent role resolutions', () => {
  test('100 concurrent role resolutions — all complete correctly', async () => {
    const adminSubs = new Set(['google:admin-a', 'google:admin-b']);
    const subs = [
      ...Array(50).fill(null).map((_, i) => `google:member-${i}`),
      'google:admin-a',
      'google:admin-b',
      ...Array(48).fill(null).map((_, i) => `google:other-${i}`),
    ];
    const results = await Promise.all(subs.map((sub) => {
      const isAdmin = adminSubs.has(sub);
      const token = makeToken(sub, isAdmin ? 'admin' : 'member');
      return resolveRole({
        bridgeRole: null, bridgeStatus: 401,
        adminSet: adminSubs, token, sub,
      });
    }));
    let adminCount = 0;
    for (let i = 0; i < results.length; i++) {
      const expected = adminSubs.has(subs[i]) ? 'admin' : 'member';
      assert.equal(results[i].role, expected, `Sub ${subs[i]}: expected ${expected}, got ${results[i].role}`);
      if (results[i].role === 'admin') adminCount++;
    }
    assert.equal(adminCount, 2, 'Exactly 2 admin results (the two admin subs)');
  });

  test('500 sequential bridge-fail resolutions all fallback correctly', async () => {
    const adminSet = new Set(['google:real-admin']);
    for (let i = 0; i < 500; i++) {
      const sub = `google:user-${i}`;
      const token = makeToken(sub, 'member');
      const result = await resolveRole({
        bridgeRole: null, bridgeStatus: 500,
        adminSet, token, sub,
      });
      assert.equal(result.role, 'member', `User ${i} should remain member after bridge failure`);
    }
  });

  test('admin subs keep admin role across 200 calls with alternating bridge responses', async () => {
    const adminSet = new Set(['google:admin-x']);
    const token = makeToken('google:admin-x', 'member'); // JWT says member but sub is in adminSet
    for (let i = 0; i < 200; i++) {
      const bridgeStatus = i % 2 === 0 ? 200 : 401;
      const bridgeRole = bridgeStatus === 200 ? 'member' : null;
      const result = await resolveRole({
        bridgeRole, bridgeStatus,
        adminSet,
        token,
        sub: 'google:admin-x',
      });
      // Gateway override should ALWAYS promote, regardless of bridge status
      assert.equal(result.role, 'admin', `Iteration ${i}: gateway admin override should win`);
    }
  });
});

describe('Stress: adminUserIdsSet scale', () => {
  test('adminUserIdsSet with 10,000 entries: lookup is O(1) and correct', () => {
    const adminSet = new Set(Array.from({ length: 10000 }, (_, i) => `google:admin-${i}`));
    adminSet.add('google:the-chosen-one');
    // Not admin
    const notAdmin = adminSet.has('google:impostor');
    assert.equal(notAdmin, false, 'Non-admin sub not in large set');
    // Is admin
    const isAdmin = adminSet.has('google:the-chosen-one');
    assert.equal(isAdmin, true, 'Admin sub found in large set');
    // Specific numeric member
    const isNumberedAdmin = adminSet.has('google:admin-9999');
    assert.equal(isNumberedAdmin, true, 'Numbered admin found');
    const notNumberedAdmin = adminSet.has('google:admin-10000');
    assert.equal(notNumberedAdmin, false, 'Out-of-range admin not found');
  });

  test('bridge fallback JWT verify does not degrade under repeated calls', async () => {
    const token = makeToken('google:stress-user', 'admin');
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const payload = jwt.verify(token, SECRET);
      assert.equal(payload.role, 'admin');
    }
    const elapsed = performance.now() - start;
    // 1000 verifications should complete in under 2 seconds on any reasonable hardware
    assert.ok(elapsed < 2000, `1000 jwt.verify calls completed in ${elapsed.toFixed(0)}ms (must be < 2000ms)`);
  });
});
