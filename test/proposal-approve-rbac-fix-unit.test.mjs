/**
 * Unit tests — proposal approve RBAC fix.
 *
 * Covers the structural changes to resolveHostedActorRole in hub/gateway/server.mjs:
 *   1. Bridge unreachable (network error) → falls back to JWT payload role.
 *   2. Bridge returns non-OK (e.g. 401, SESSION_SECRET mismatch) → falls back to JWT payload.
 *   3. Bridge returns OK with 'admin' → normal path, no override needed.
 *   4. Gateway admin override: HUB_ADMIN_USER_IDS trumps bridge 'member'.
 *   5. approveProposal error path uses showToast, not a silent muted paragraph.
 *   6. discardProposal error path uses showToast, not a silent muted paragraph.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SERVER_SRC = path.join(ROOT, 'hub/gateway/server.mjs');
const HUB_SRC = path.join(ROOT, 'web/hub/hub.js');

describe('resolveHostedActorRole — unit wiring', () => {
  let src;
  const load = () => {
    if (!src) src = fs.readFileSync(SERVER_SRC, 'utf8');
    return src;
  };

  test('resolveHostedActorRole exists in server.mjs', () => {
    const s = load();
    assert.ok(s.includes('async function resolveHostedActorRole'), 'function is defined');
  });

  test('bridge fallback: bridgeResolved flag is declared and checked', () => {
    const s = load();
    const fn = s.slice(s.indexOf('async function resolveHostedActorRole'), s.indexOf('\n}\n', s.indexOf('async function resolveHostedActorRole')));
    assert.ok(fn.includes('bridgeResolved'), 'bridgeResolved flag present');
    assert.ok(fn.includes('!bridgeResolved'), 'fallback check on bridgeResolved');
  });

  test('bridge fallback path: uses once-verified bearerPayload (not raw header parse)', () => {
    const s = load();
    const fn = s.slice(s.indexOf('async function resolveHostedActorRole'), s.indexOf('\n}\n', s.indexOf('async function resolveHostedActorRole')) + 3);
    // SEC-KN-3: verify runs once at the top into bearerPayload; fallback reuses it.
    // SEC-KN-P6-ROTATE: the entry verify is the dual-secret rotation helper
    // (verifyJwtWithSecretRotation), replacing the raw single-secret jwt.verify.
    const helperCount = (fn.match(/verifyJwtWithSecretRotation/g) || []).length;
    assert.equal(helperCount, 1, `rotation-helper verify called exactly once at entry (got ${helperCount})`);
    const rawVerifyCount = (fn.match(/jwt\.verify/g) || []).length;
    assert.equal(rawVerifyCount, 0, `no raw jwt.verify remains in resolveHostedActorRole (got ${rawVerifyCount})`);
    const fallbackBlock = fn.slice(fn.indexOf('!bridgeResolved'));
    assert.ok(
      fallbackBlock.includes('roleFromVerifiedAccessPayload(bearerPayload'),
      'bridge fallback resolves role from verified bearerPayload',
    );
    assert.ok(!fallbackBlock.includes('JSON.parse'), 'bridge fallback does not JSON.parse the raw header');
  });

  test('gateway admin override: roleForSub check present after bridge/else branches', () => {
    const s = load();
    const fn = s.slice(s.indexOf('async function resolveHostedActorRole'), s.indexOf('\n}\n', s.indexOf('async function resolveHostedActorRole')) + 3);
    assert.ok(fn.includes('roleForSub(actorSub)'), 'roleForSub used in gateway admin override');
    assert.ok(fn.includes("role !== 'admin'"), 'override is guarded by role !== admin');
    assert.ok(fn.includes("role = 'admin'"), 'override sets role to admin');
    assert.ok(fn.includes('mayApproveProposals = true'), 'override sets mayApproveProposals true');
  });

  test('gateway admin override: comment explains the lockout-prevention rationale', () => {
    const s = load();
    const fn = s.slice(s.indexOf('async function resolveHostedActorRole'), s.indexOf('\n}\n', s.indexOf('async function resolveHostedActorRole')) + 3);
    assert.ok(fn.includes('locked out'), 'comment explains lockout-prevention intent');
  });

  test('bridge fallback: placed inside the BRIDGE_URL branch, not outside', () => {
    const s = load();
    const fnStart = s.indexOf('async function resolveHostedActorRole');
    const fnEnd = s.indexOf('\n}\n', fnStart) + 3;
    const fn = s.slice(fnStart, fnEnd);
    // The bridgeResolved fallback block should appear before the final gateway override block
    const bridgeFallbackIdx = fn.indexOf('!bridgeResolved');
    const overrideIdx = fn.indexOf('Gateway-level admin override');
    assert.ok(bridgeFallbackIdx < overrideIdx, 'bridge fallback block appears before gateway override');
  });
});

describe('hub.js approveProposal — error visibility wiring', () => {
  let src;
  const load = () => {
    if (!src) src = fs.readFileSync(HUB_SRC, 'utf8');
    return src;
  };

  test('approveProposal catch uses showToast, not appendChild', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    assert.ok(fnStart > 0, 'approveProposal function exists');
    const fnEnd = s.indexOf('\n  }\n', fnStart + 100);
    const fn = s.slice(fnStart, fnEnd + 5);
    assert.ok(fn.includes('showToast'), 'showToast used in approveProposal catch');
    assert.ok(!fn.includes("className = 'muted'"), 'muted paragraph removed from approveProposal');
    assert.ok(!fn.includes('db.appendChild'), 'appendChild pattern removed from approveProposal catch');
  });

  test('discardProposal catch uses showToast, not appendChild', () => {
    const s = load();
    const fnStart = s.indexOf('async function discardProposal');
    assert.ok(fnStart > 0, 'discardProposal function exists');
    const fnEnd = s.indexOf('\n  }\n', fnStart + 100);
    const fn = s.slice(fnStart, fnEnd + 5);
    assert.ok(fn.includes('showToast'), 'showToast used in discardProposal catch');
    assert.ok(!fn.includes("className = 'muted'"), 'muted paragraph removed from discardProposal');
    assert.ok(!fn.includes('db.appendChild'), 'appendChild pattern removed from discardProposal catch');
  });

  test('approveProposal toast passes isError=true', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    assert.ok(fn.includes('showToast(') && fn.includes(', true)'), 'approveProposal toast marks error=true');
  });

  test('discardProposal toast passes isError=true', () => {
    const s = load();
    const fnStart = s.indexOf('async function discardProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  el(', fnStart));
    assert.ok(fn.includes('showToast(') && fn.includes(', true)'), 'discardProposal toast marks error=true');
  });

  test('approveProposal still closes the panel on success (hideDetailPanelChrome present)', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    assert.ok(fn.includes('hideDetailPanelChrome()'), 'panel close preserved in success path');
    assert.ok(fn.includes('loadProposals()'), 'proposals reload preserved in success path');
  });
});

describe('resolveHostedActorRole — logic invariants (structural)', () => {
  const load = () => fs.readFileSync(SERVER_SRC, 'utf8');

  test('bridge fallback only runs when bridge did not resolve (guards are symmetric)', () => {
    const s = load();
    const fnStart = s.indexOf('async function resolveHostedActorRole');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    // bridgeResolved = false precedes the fallback block
    const resolvedFalse = fn.indexOf('bridgeResolved = false');
    const resolvedTrue = fn.indexOf('bridgeResolved = true');
    const fallback = fn.indexOf('!bridgeResolved');
    assert.ok(resolvedFalse < fallback, 'bridgeResolved initially false before fallback');
    assert.ok(resolvedTrue < fallback, 'bridgeResolved set true on success before fallback guard');
  });

  test('mayApproveProposals defaults to false (fail-closed)', () => {
    const s = load();
    const fnStart = s.indexOf('async function resolveHostedActorRole');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    // Default must be false (fail-closed)
    assert.ok(fn.includes('let mayApproveProposals = false'), 'mayApproveProposals defaults to false');
  });

  test('role defaults to member (fail-closed)', () => {
    const s = load();
    const fnStart = s.indexOf('async function resolveHostedActorRole');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    assert.ok(fn.includes("let role = 'member'"), "role defaults to 'member'");
  });

  test('function returns role, mayApproveProposals, and isMcpAccess', () => {
    const s = load();
    // SEC-KN-3: isMcpAccess is required so callers can bar agent tokens from self-apply.
    // SEC-SEAM-1: payload accompanies both returns for sessionBound classification.
    assert.ok(
      s.includes('return { role, mayApproveProposals, isMcpAccess: true, payload: bearerPayload }'),
      'mcp_access early-return includes isMcpAccess: true',
    );
    assert.ok(
      s.includes('return { role, mayApproveProposals, isMcpAccess: false, payload: bearerPayload }'),
      'non-agent path returns isMcpAccess: false',
    );
  });
});
