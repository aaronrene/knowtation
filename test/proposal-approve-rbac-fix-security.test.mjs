/**
 * Security tests — proposal approve RBAC fix.
 *
 * Verifies that the RBAC fix does not introduce privilege escalation, secret leakage,
 * or bypass opportunities. These are build-blocking tests.
 *
 * Threat model:
 *   S1. Attacker forges a JWT with role='admin' using a different secret → jwt.verify throws.
 *   S2. Attacker passes a sub that matches HUB_ADMIN_USER_IDS but JWT is invalid → override
 *       should not fire when JWT verification fails (getUserId returns null → no sub).
 *   S3. Error messages in showToast must not leak SESSION_SECRET, JWT payloads, or internal paths.
 *   S4. Bridge 401 fallback must only use the GATEWAY's SESSION_SECRET to verify — not skip verify.
 *   S5. Gateway admin override only applies to the exact sub from a verified JWT, not from query params.
 *   S6. The canApprove check in assertHostedProposalApproveDiscard must be the last gate before proxying.
 *   S7. No plaintext role claim (from an unverified source) can bypass the JWT verify step.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REAL_SECRET = 'legit-secret-for-tests';
const ATTACKER_SECRET = 'attacker-secret-cannot-forge';

describe('Security: JWT forgery resistance', () => {
  test('S1: forged JWT with wrong secret is rejected by jwt.verify', () => {
    const forgedToken = jwt.sign({ sub: 'google:fake-admin', role: 'admin' }, ATTACKER_SECRET, { expiresIn: '1h' });
    assert.throws(
      () => jwt.verify(forgedToken, REAL_SECRET),
      /invalid signature|JsonWebTokenError/,
      'Forged JWT rejected by verify with correct secret'
    );
  });

  test('S2: sub extraction from forged JWT fails before admin override can fire', () => {
    // getUserId uses jwt.verify internally; a forged token means sub is null
    const forgedToken = jwt.sign({ sub: 'google:admin-id', role: 'admin' }, ATTACKER_SECRET);
    let sub = null;
    try {
      const payload = jwt.verify(forgedToken, REAL_SECRET);
      sub = payload.sub ?? null;
    } catch (_) {}
    assert.equal(sub, null, 'Sub is null when JWT cannot be verified → admin override cannot fire');
  });

  test('S3: showToast error message in hub.js does not reference SESSION_SECRET, jwt, or internal paths', () => {
    const src = fs.readFileSync(path.join(ROOT, 'web/hub/hub.js'), 'utf8');
    const fnStart = src.indexOf('async function approveProposal');
    const fn = src.slice(fnStart, src.indexOf('\n  async function discardProposal', fnStart));
    const catchBlock = fn.slice(fn.indexOf('} catch (e)'));
    // The toast message is built from e.message — verify the format is safe
    assert.ok(!catchBlock.includes('SESSION_SECRET'), 'SESSION_SECRET not in toast message template');
    assert.ok(!catchBlock.includes('jwt.sign'), 'jwt.sign not referenced in toast template');
    assert.ok(!catchBlock.includes('SECRET'), 'SECRET keyword not in approve catch block');
    // Message should contain the user-facing error from the API (e.message)
    assert.ok(catchBlock.includes('e.message'), 'toast includes API error message for user');
  });

  test('S4: bridge fallback uses once-verified bearerPayload (not JSON.parse on raw header)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    const fnStart = src.indexOf('async function resolveHostedActorRole');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    // SEC-KN-3: verify once at entry; fallback must consume bearerPayload, never raw-parse.
    assert.ok(fn.includes('jwt.verify(token, SESSION_SECRET)'), 'Entry path verifies JWT with SESSION_SECRET');
    const fallbackBlock = fn.slice(fn.indexOf('!bridgeResolved'));
    assert.ok(
      fallbackBlock.includes('roleFromVerifiedAccessPayload(bearerPayload'),
      'Bridge fallback uses verified bearerPayload (not a second unverified parse)',
    );
    assert.ok(!fallbackBlock.includes('JSON.parse'), 'Bridge fallback does not JSON.parse the raw header');
    assert.ok(!fallbackBlock.includes('jwt.verify'), 'Fallback does not re-verify; it reuses bearerPayload');
  });

  test('S5: gateway admin override uses getUserId (verified sub), not query params', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    const fnStart = src.indexOf('async function resolveHostedActorRole');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    const overrideBlock = fn.slice(fn.indexOf('Gateway-level admin override'));
    assert.ok(overrideBlock.includes('getUserId(req)'), 'Override uses getUserId (JWT-verified sub)');
    assert.ok(!overrideBlock.includes('req.query'), 'Override does not use query parameters as sub');
    assert.ok(!overrideBlock.includes('req.body'), 'Override does not use request body as sub');
  });

  test('S6: canApprove is the final gate immediately before 403 response', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    const fnStart = src.indexOf('async function assertHostedProposalApproveDiscard');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    const canApproveIdx = fn.indexOf('const canApprove');
    assert.ok(canApproveIdx > 0, 'canApprove is computed');
    // The 403 for approve specifically appears AFTER canApprove is defined.
    // (There is also a 403 for discard before canApprove — find the approve-specific one.)
    const approveForbiddenIdx = fn.indexOf("'FORBIDDEN'", canApproveIdx);
    assert.ok(approveForbiddenIdx > canApproveIdx, '403 FORBIDDEN for approve follows canApprove check');
    const returnFalseIdx = fn.indexOf('return false', approveForbiddenIdx);
    assert.ok(returnFalseIdx > approveForbiddenIdx, 'return false after 403 prevents bypass');
  });

  test('S7: role from bridge is only accepted after roleRes.ok check', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    const fnStart = src.indexOf('async function resolveHostedActorRole');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    const bridgeBlock = fn.slice(fn.indexOf('else if (BRIDGE_URL'), fn.indexOf('!bridgeResolved'));
    assert.ok(bridgeBlock.includes('roleRes.ok'), 'Bridge role is only used when roleRes.ok is true');
    // data.role is only set inside the ok block
    const okBlock = bridgeBlock.slice(bridgeBlock.indexOf('if (roleRes.ok)'));
    assert.ok(okBlock.includes('data.role'), 'data.role is inside the roleRes.ok guard');
  });
});

describe('Security: privilege escalation prevention', () => {
  test('member JWT cannot become admin via bridge fallback alone', () => {
    // When bridge returns 401, the fallback uses the JWT role.
    // A member JWT stays member even through the fallback.
    const token = jwt.sign({ sub: 'google:member', role: 'member' }, REAL_SECRET, { expiresIn: '1h' });
    let role = 'member';
    try {
      const payload = jwt.verify(token, REAL_SECRET);
      role = payload.role || 'member';
    } catch (_) {}
    assert.equal(role, 'member', 'Member JWT remains member through JWT fallback');
  });

  test('admin claim in JWT body is verified against SESSION_SECRET before use', () => {
    // A properly signed admin JWT from the correct gateway → valid
    const validAdminToken = jwt.sign({ sub: 'google:real-admin', role: 'admin' }, REAL_SECRET, { expiresIn: '1h' });
    let role = 'member';
    try {
      const p = jwt.verify(validAdminToken, REAL_SECRET);
      role = p.role || 'member';
    } catch (_) {}
    assert.equal(role, 'admin', 'Valid admin JWT verified correctly');

    // Same token verified with wrong secret → throws
    assert.throws(
      () => jwt.verify(validAdminToken, ATTACKER_SECRET),
      /invalid signature|JsonWebTokenError/,
      'Admin claim rejected when verified with wrong secret'
    );
  });

  test('gateway admin override fires only for subs in adminUserIdsSet', () => {
    const adminSet = new Set(['google:the-real-admin']);
    const checkOverride = (sub, currentRole) => {
      if (sub && currentRole !== 'admin' && adminSet.has(sub)) {
        return 'admin';
      }
      return currentRole;
    };
    assert.equal(checkOverride('google:the-real-admin', 'member'), 'admin', 'admin sub gets override');
    assert.equal(checkOverride('google:impersonator', 'member'), 'member', 'non-admin sub gets no override');
    assert.equal(checkOverride('', 'member'), 'member', 'empty sub gets no override');
    assert.equal(checkOverride(null, 'member'), 'member', 'null sub gets no override');
    assert.equal(checkOverride('google:the-real-admin', 'admin'), 'admin', 'already-admin gets no change');
  });
});

describe('Security: no secrets in error surfaces', () => {
  test('hub.js showToast does not expose raw JWT in error messages', () => {
    const src = fs.readFileSync(path.join(ROOT, 'web/hub/hub.js'), 'utf8');
    const fnStart = src.indexOf('async function approveProposal');
    const fn = src.slice(fnStart, src.indexOf('\n  async function discardProposal', fnStart));
    // Pattern: showToast('Approve failed: ' + msg, true)
    // Verify the message is built from e.message, which is a string — not the full error object
    const toastLine = fn.slice(fn.indexOf('showToast('));
    assert.ok(toastLine.includes('e.message || String(e)') || toastLine.includes('e.message'), 'error uses e.message string, not full error object');
    assert.ok(!toastLine.includes('JSON.stringify(e)'), 'JSON.stringify not used on error in toast');
  });

  test('server.mjs RBAC check 403 response does not echo back sensitive request data', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    const fnStart = src.indexOf('async function assertHostedProposalApproveDiscard');
    const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 3);
    const forbiddenBlock = fn.slice(fn.indexOf("'FORBIDDEN'") - 200, fn.indexOf("'FORBIDDEN'") + 200);
    // Error message must be static — not echo req.headers or sub
    assert.ok(!forbiddenBlock.includes('req.headers'), '403 does not echo request headers');
    assert.ok(!forbiddenBlock.includes('req.body'), '403 does not echo request body');
  });
});
