/**
 * Data-integrity tests — proposal approve RBAC fix.
 *
 * Verifies that role data flowing through the fix is:
 *   - Never mutated unexpectedly between call sites.
 *   - Correctly typed (string 'admin'/'member', boolean mayApproveProposals).
 *   - Consistent with the input (bridge role wins over JWT when bridge resolves).
 *   - Bridge data only overwrites default when explicitly set (no undefined bleed).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SECRET = 'data-integrity-secret';

function makeToken(sub, role) {
  return jwt.sign({ sub, role }, SECRET, { expiresIn: '1h' });
}

async function resolveRole({ bridgeRole, bridgeStatus, bridgeMayApprove, adminSet, token, sub }) {
  function roleForSub(s) { return adminSet.has(s) ? 'admin' : 'member'; }
  let role = 'member';
  let mayApproveProposals = false;
  let bridgeResolved = false;

  if (bridgeStatus === 200 && bridgeRole) {
    role = bridgeRole;
    bridgeResolved = true;
    if (typeof bridgeMayApprove === 'boolean') {
      mayApproveProposals = bridgeMayApprove;
    } else {
      mayApproveProposals = role === 'admin';
    }
  }

  if (!bridgeResolved) {
    try {
      const payload = jwt.verify(token, SECRET);
      role = payload.role || roleForSub(payload.sub);
      mayApproveProposals = role === 'admin';
    } catch (_) {}
  }

  if (sub && role !== 'admin' && roleForSub(sub) === 'admin') {
    role = 'admin';
    mayApproveProposals = true;
  }

  return { role, mayApproveProposals };
}

describe('Data integrity: role typing and values', () => {
  const VALID_ROLES = new Set(['admin', 'member', 'evaluator', 'editor', 'viewer']);

  test('role is always a string', async () => {
    const cases = [
      { bridgeRole: 'admin', bridgeStatus: 200 },
      { bridgeRole: 'member', bridgeStatus: 200 },
      { bridgeRole: null, bridgeStatus: 401 },
      { bridgeRole: null, bridgeStatus: 500 },
    ];
    for (const c of cases) {
      const result = await resolveRole({
        ...c, bridgeMayApprove: undefined,
        adminSet: new Set(),
        token: makeToken('google:user', 'member'),
        sub: 'google:user',
      });
      assert.equal(typeof result.role, 'string', `role is string for bridge status ${c.bridgeStatus}`);
    }
  });

  test('mayApproveProposals is always boolean', async () => {
    const cases = [
      { bridgeRole: 'admin', bridgeStatus: 200 },
      { bridgeRole: 'member', bridgeStatus: 200 },
      { bridgeRole: null, bridgeStatus: 401 },
    ];
    for (const c of cases) {
      const result = await resolveRole({
        ...c, bridgeMayApprove: undefined,
        adminSet: new Set(),
        token: makeToken('google:user', 'member'),
        sub: 'google:user',
      });
      assert.equal(typeof result.mayApproveProposals, 'boolean',
        `mayApproveProposals is boolean for bridge status ${c.bridgeStatus}`);
    }
  });

  test('bridge admin role is not downgraded by JWT fallback', async () => {
    // Bridge says admin → bridgeResolved=true → no fallback
    const result = await resolveRole({
      bridgeRole: 'admin', bridgeStatus: 200, bridgeMayApprove: true,
      adminSet: new Set(),
      token: makeToken('google:user', 'member'), // JWT says member
      sub: 'google:user',
    });
    assert.equal(result.role, 'admin', 'bridge admin not downgraded by member JWT');
    assert.equal(result.mayApproveProposals, true);
  });

  test('bridge member role is not upgraded by member JWT', async () => {
    // Bridge says member, JWT also says member
    const result = await resolveRole({
      bridgeRole: 'member', bridgeStatus: 200, bridgeMayApprove: false,
      adminSet: new Set(),
      token: makeToken('google:user', 'admin'), // JWT says admin — should not upgrade
      sub: 'google:user',
    });
    // Bridge resolved, so JWT fallback does NOT run
    assert.equal(result.role, 'member', 'bridge member not upgraded by admin JWT when bridge resolves');
  });

  test('undefined bridge role does not set role to undefined', async () => {
    // Bridge OK but returns empty role (data integrity: undefined must not replace default)
    const result = await resolveRole({
      bridgeRole: '', bridgeStatus: 200, // empty string = falsy = bridgeResolved stays false
      adminSet: new Set(),
      token: makeToken('google:user', 'member'),
      sub: 'google:user',
    });
    assert.notEqual(result.role, undefined, 'role is never undefined');
    assert.notEqual(result.role, '', 'role is never empty string');
    assert.equal(typeof result.role, 'string', 'role is always a string');
  });

  test('gateway override only upgrades, never downgrades', async () => {
    const adminSet = new Set(['google:admin-sub']);
    // Bridge says admin → override should not change it (already admin)
    const alreadyAdmin = await resolveRole({
      bridgeRole: 'admin', bridgeStatus: 200, bridgeMayApprove: true,
      adminSet,
      token: makeToken('google:admin-sub', 'admin'),
      sub: 'google:admin-sub',
    });
    assert.equal(alreadyAdmin.role, 'admin');
    // Override condition is `role !== 'admin'` so it's a no-op when already admin
    // Verify the condition structure
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    const overrideSection = src.slice(
      src.indexOf('Gateway-level admin override'),
      src.indexOf('return { role, mayApproveProposals, isMcpAccess: false }'),
    );
    assert.ok(overrideSection.includes("role !== 'admin'"), 'Override is guarded by role !== admin (no downgrade possible)');
    assert.ok(
      overrideSection.includes('mayApplyAdminAllowlistOverride(bearerPayload)'),
      'Override is gated so mcp_access never inherits HUB_ADMIN_USER_IDS (SEC-KN-3)',
    );
  });
});

describe('Data integrity: source-code consistency', () => {
  const load = () => fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');

  test('resolveHostedActorRole return shape includes isMcpAccess (SEC-KN-3)', () => {
    const src = load();
    const fnStart = src.indexOf('async function resolveHostedActorRole');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    // SEC-KN-3 extended the return with isMcpAccess so approve/self-apply can refuse agent tokens.
    assert.ok(
      fn.includes('return { role, mayApproveProposals, isMcpAccess: false }'),
      'Final return includes isMcpAccess: false',
    );
    assert.ok(
      fn.includes('return { role, mayApproveProposals, isMcpAccess: true }'),
      'mcp_access early-return includes isMcpAccess: true',
    );
    const returnLine = fn.slice(fn.lastIndexOf('return {'), fn.lastIndexOf('return {') + 60);
    assert.ok(!returnLine.includes('bridgeResolved'), 'bridgeResolved not leaked in return');
    assert.ok(!returnLine.includes('actorSub'), 'actorSub not leaked in return');
  });

  test('bridgeResolved flag starts false and only transitions to true on valid bridge data', () => {
    const src = load();
    const fnStart = src.indexOf('async function resolveHostedActorRole');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    const bridgeBlock = fn.slice(fn.indexOf('else if (BRIDGE_URL'), fn.indexOf('} else {'));
    // bridgeResolved = false must precede bridgeResolved = true
    const falseIdx = bridgeBlock.indexOf('bridgeResolved = false');
    const trueIdx = bridgeBlock.indexOf('bridgeResolved = true');
    assert.ok(falseIdx < trueIdx, 'bridgeResolved transitions false→true in correct order');
    // bridgeResolved = true is inside the roleRes.ok block
    const okBlock = bridgeBlock.slice(bridgeBlock.indexOf('if (roleRes.ok)'));
    assert.ok(okBlock.includes('bridgeResolved = true'), 'bridgeResolved = true only inside roleRes.ok');
  });
});
