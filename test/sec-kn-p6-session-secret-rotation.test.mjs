/**
 * SEC-KN-P6-ROTATE — seven-tier coverage for the dual-secret SESSION_SECRET
 * rotation helper and its mandatory wire-up (docs/SEC-KN-P6-ROTATE-FREEZE.md
 * §6.2 / §7 P6-C1–C3, §8 test matrix).
 *
 * Frozen requirements:
 *   - `verifyJwtWithSecretRotation(token, primary, previous)` — try primary,
 *     fall back to previous (verify-only), fail closed on missing primary.
 *   - EVERY G10 access-JWT verify site calls the helper (source-scan tier);
 *     missing one host/path during P1–P2 means OLD tokens 401 on that path.
 *   - Signing (jwt.sign, bridge GitHub-token encrypt, HMAC) uses primary only.
 *   - Secrets never appear in thrown messages.
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import {
  verifyJwtWithSecretRotation,
  resolveSessionSecretPrevious,
} from '../hub/lib/session-secret-rotation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HELPER_SRC_PATH = path.join(ROOT, 'hub/lib/session-secret-rotation.mjs');
const GATEWAY_SERVER = path.join(ROOT, 'hub/gateway/server.mjs');
const METADATA_BULK = path.join(ROOT, 'hub/gateway/metadata-bulk-canister.mjs');
const MCP_OAUTH = path.join(ROOT, 'hub/gateway/mcp-oauth-provider.mjs');
const BRIDGE_SERVER = path.join(ROOT, 'hub/bridge/server.mjs');
const FLOW_ROUTES = path.join(ROOT, 'hub/bridge/flow-routes.mjs');
const FLOW_CAPTURE_ROUTES = path.join(ROOT, 'hub/bridge/flow-capture-routes.mjs');
const TASK_ROUTES = path.join(ROOT, 'hub/bridge/task-routes.mjs');

const OLD_SECRET = 'test-old-secret-0123456789abcdef0123456789abcdef';
const NEW_SECRET = 'test-new-secret-fedcba9876543210fedcba9876543210';
const ATTACKER_SECRET = 'attacker-secret-not-in-any-domain-x-x-x-x-x-x-x';

function sign(secret, claims = {}) {
  return jwt.sign({ sub: 'google:p6-user', type: 'session', ...claims }, secret, { expiresIn: '5m' });
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

/** Extract a named function block from source (entry to next top-level close). */
function fnBlock(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `source contains ${marker}`);
  const end = src.indexOf('\n}', start);
  return src.slice(start, end + 2);
}

// ---------------------------------------------------------------------------
// Tier 1 — unit (helper contract)
// ---------------------------------------------------------------------------
describe('P6 unit — verifyJwtWithSecretRotation contract', () => {
  test('accepts a primary-signed token', () => {
    const payload = verifyJwtWithSecretRotation(sign(NEW_SECRET), NEW_SECRET, OLD_SECRET);
    assert.equal(payload?.sub, 'google:p6-user');
  });

  test('accepts a previous-signed token when previous is set (rotation window)', () => {
    const payload = verifyJwtWithSecretRotation(sign(OLD_SECRET), NEW_SECRET, OLD_SECRET);
    assert.equal(payload?.sub, 'google:p6-user');
  });

  test('rejects a previous-signed token when previous is unset (window closed)', () => {
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), NEW_SECRET, null), null);
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), NEW_SECRET, undefined), null);
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), NEW_SECRET, ''), null);
  });

  test('rejects garbage tokens and attacker-signed tokens', () => {
    assert.equal(verifyJwtWithSecretRotation('invalid.invalid.invalid', NEW_SECRET, OLD_SECRET), null);
    assert.equal(verifyJwtWithSecretRotation(sign(ATTACKER_SECRET), NEW_SECRET, OLD_SECRET), null);
    assert.equal(verifyJwtWithSecretRotation('', NEW_SECRET, OLD_SECRET), null);
    assert.equal(verifyJwtWithSecretRotation(null, NEW_SECRET, OLD_SECRET), null);
    assert.equal(verifyJwtWithSecretRotation(42, NEW_SECRET, OLD_SECRET), null);
  });

  test('fail-closed: missing/empty primary refuses even a previous-signed token', () => {
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), '', OLD_SECRET), null);
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), null, OLD_SECRET), null);
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), undefined, OLD_SECRET), null);
  });

  test('previous === primary is a misconfig no-op (no second verify, no weakening)', () => {
    assert.equal(verifyJwtWithSecretRotation(sign(OLD_SECRET), NEW_SECRET, NEW_SECRET), null);
    const ok = verifyJwtWithSecretRotation(sign(NEW_SECRET), NEW_SECRET, NEW_SECRET);
    assert.equal(ok?.sub, 'google:p6-user');
  });

  test('helper module never signs (no jwt.sign in source)', () => {
    assert.ok(!read(HELPER_SRC_PATH).includes('jwt.sign'), 'rotation helper must be verify-only');
  });

  test('resolveSessionSecretPrevious reads only SESSION_SECRET_PREVIOUS and normalizes empty to null', () => {
    assert.equal(resolveSessionSecretPrevious({ SESSION_SECRET_PREVIOUS: 'x' }), 'x');
    assert.equal(resolveSessionSecretPrevious({ SESSION_SECRET_PREVIOUS: '' }), null);
    assert.equal(resolveSessionSecretPrevious({}), null);
    assert.equal(resolveSessionSecretPrevious({ HUB_JWT_SECRET: 'y' }), null);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (gateway decodeVerifiedToken path during the window)
// ---------------------------------------------------------------------------
describe('P6 integration — gateway decodeVerifiedToken path accepts previous during window', () => {
  test('decodeVerifiedToken delegates to the rotation helper with both secrets', () => {
    const block = fnBlock(read(GATEWAY_SERVER), 'function decodeVerifiedToken(token)');
    assert.ok(
      block.includes('verifyJwtWithSecretRotation(token, SESSION_SECRET, SESSION_SECRET_PREVIOUS)'),
      'decodeVerifiedToken uses the dual-secret helper',
    );
  });

  test('behavioral: gateway-shaped session token signed with OLD verifies while previous=OLD', () => {
    // Same call shape as decodeVerifiedToken after the wire-up.
    const token = jwt.sign(
      { sub: 'google:it-user', provider: 'google', id: 'it-user', name: '', role: 'member', type: 'session' },
      OLD_SECRET,
      { expiresIn: '24h' },
    );
    const during = verifyJwtWithSecretRotation(token, NEW_SECRET, OLD_SECRET);
    assert.equal(during?.sub, 'google:it-user');
    assert.equal(during?.type, 'session');
  });

  test('verifyToken and resolveHostedActorRole entry also use the helper', () => {
    const src = read(GATEWAY_SERVER);
    const vt = fnBlock(src, 'function verifyToken(token)');
    assert.ok(vt.includes('verifyJwtWithSecretRotation(token, SESSION_SECRET, SESSION_SECRET_PREVIOUS)'));
    const rhar = src.slice(src.indexOf('async function resolveHostedActorRole'));
    assert.ok(
      rhar.slice(0, 2000).includes('verifyJwtWithSecretRotation(token, SESSION_SECRET, SESSION_SECRET_PREVIOUS)'),
      'resolveHostedActorRole entry verify uses the dual-secret helper',
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (simulated cutover P0 → P1 → P3)
// ---------------------------------------------------------------------------
describe('P6 e2e — simulated cutover', () => {
  test('sign with OLD → set PREVIOUS+NEW → verify OK → clear PREVIOUS → verify fail', () => {
    // P0: primary = OLD, previous unset. Existing tokens verify.
    const oldToken = sign(OLD_SECRET);
    assert.ok(verifyJwtWithSecretRotation(oldToken, OLD_SECRET, null));

    // P1: primary = NEW, previous = OLD. Old AND new tokens verify.
    const newToken = sign(NEW_SECRET);
    assert.ok(verifyJwtWithSecretRotation(oldToken, NEW_SECRET, OLD_SECRET), 'OLD token verifies during window');
    assert.ok(verifyJwtWithSecretRotation(newToken, NEW_SECRET, OLD_SECRET), 'NEW token verifies during window');

    // P3: previous unset. Only NEW-signed tokens verify; OLD → refuse (expected 401 upstream).
    assert.equal(verifyJwtWithSecretRotation(oldToken, NEW_SECRET, null), null, 'OLD token refused after window');
    assert.ok(verifyJwtWithSecretRotation(newToken, NEW_SECRET, null), 'NEW token still verifies after window');
  });

  test('cutover never accepts a token signed with neither secret', () => {
    const forged = sign(ATTACKER_SECRET);
    for (const [primary, previous] of [
      [OLD_SECRET, null],
      [NEW_SECRET, OLD_SECRET],
      [NEW_SECRET, null],
    ]) {
      assert.equal(verifyJwtWithSecretRotation(forged, primary, previous), null);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress (rapid alternating OLD/NEW verifies, concurrent)
// ---------------------------------------------------------------------------
describe('P6 stress — alternating OLD/NEW verify under concurrency', () => {
  test('500 interleaved verifications stay correct', async () => {
    const oldToken = sign(OLD_SECRET);
    const newToken = sign(NEW_SECRET);
    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        Promise.resolve().then(() => {
          const token = i % 2 === 0 ? oldToken : newToken;
          const payload = verifyJwtWithSecretRotation(token, NEW_SECRET, OLD_SECRET);
          return payload?.sub === 'google:p6-user';
        }),
      ),
    );
    assert.ok(results.every(Boolean), 'every interleaved verify resolved the correct payload');
  });

  test('concurrent mixed valid/garbage tokens never cross-contaminate', async () => {
    const valid = sign(NEW_SECRET);
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        Promise.resolve().then(() =>
          verifyJwtWithSecretRotation(i % 3 === 0 ? 'garbage.garbage.garbage' : valid, NEW_SECRET, OLD_SECRET),
        ),
      ),
    );
    results.forEach((payload, i) => {
      if (i % 3 === 0) assert.equal(payload, null);
      else assert.equal(payload?.sub, 'google:p6-user');
    });
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity (signing/encrypt paths stay primary-only)
// ---------------------------------------------------------------------------
describe('P6 data-integrity — primary-only signing and encrypt invariants', () => {
  /** Extract the full argument text of every `jwt.sign(...)` call via paren matching. */
  function jwtSignCallArgs(src) {
    const calls = [];
    let idx = src.indexOf('jwt.sign(');
    while (idx !== -1) {
      let depth = 0;
      let end = idx + 'jwt.sign'.length;
      for (; end < src.length; end++) {
        if (src[end] === '(') depth++;
        else if (src[end] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      calls.push(src.slice(idx, end + 1));
      idx = src.indexOf('jwt.sign(', end);
    }
    return calls;
  }

  test('no jwt.sign anywhere uses SESSION_SECRET_PREVIOUS', () => {
    for (const p of [GATEWAY_SERVER, MCP_OAUTH, BRIDGE_SERVER, METADATA_BULK]) {
      for (const call of jwtSignCallArgs(read(p))) {
        assert.ok(
          !call.includes('SESSION_SECRET_PREVIOUS') && !call.includes('_sessionSecretPrevious'),
          `${path.basename(p)}: jwt.sign never uses the previous secret`,
        );
      }
    }
  });

  test('bridge HMAC state signing and GitHub-token encrypt stay on SESSION_SECRET only', () => {
    const src = read(BRIDGE_SERVER);
    assert.ok(
      !/createHmac\([^)]*SESSION_SECRET_PREVIOUS/.test(src),
      'signState/verifyState HMAC never keyed by the previous secret',
    );
    assert.ok(
      !/(scrypt|pbkdf2|createCipheriv|createDecipheriv)[\s\S]{0,200}?SESSION_SECRET_PREVIOUS/.test(src),
      'GitHub-token encrypt/decrypt never keyed by the previous secret (freeze §6.4: re-connect, not dual-decrypt)',
    );
  });

  test('MCP OAuth provider signs access tokens with the primary secret only', () => {
    const src = read(MCP_OAUTH);
    const signs = src.match(/jwt\.sign\([\s\S]*?\)/g) || [];
    assert.ok(signs.length >= 1, 'provider still signs mcp_access tokens');
    for (const s of signs) {
      assert.ok(s.includes('this._sessionSecret'), 'mcp_access signing uses primary');
      assert.ok(!s.includes('Previous'), 'mcp_access signing never uses previous');
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance (dual verify overhead bound)
// ---------------------------------------------------------------------------
describe('P6 performance — dual verify overhead', () => {
  test('worst case (primary miss → previous hit) p95 under 5ms per verify', () => {
    const oldToken = sign(OLD_SECRET);
    // warm-up
    for (let i = 0; i < 50; i++) verifyJwtWithSecretRotation(oldToken, NEW_SECRET, OLD_SECRET);
    const samples = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      const payload = verifyJwtWithSecretRotation(oldToken, NEW_SECRET, OLD_SECRET);
      samples.push(performance.now() - t0);
      assert.ok(payload, 'verify succeeded via previous');
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    assert.ok(p95 < 5, `dual-verify p95 ${p95.toFixed(3)}ms must stay under 5ms (two HS256 verifies)`);
  });

  test('no retry/sleep storms in the helper (single fall-through, no loops/timers)', () => {
    const src = read(HELPER_SRC_PATH);
    assert.ok(!/setTimeout|setInterval|while\s*\(|for\s*\(/.test(src), 'helper is straight-line verify logic');
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (regression + no secret leakage + G10 source scan)
// ---------------------------------------------------------------------------
describe('P6 security — regression and leakage', () => {
  test('REGRESSION: single-secret-only verify fails the previous-signed case during the window', () => {
    // Pre-P6 shape: jwt.verify(token, SESSION_SECRET) with primary = NEW only.
    const oldToken = sign(OLD_SECRET);
    let singleSecretPayload = null;
    try {
      singleSecretPayload = jwt.verify(oldToken, NEW_SECRET);
    } catch (_) {
      singleSecretPayload = null;
    }
    assert.equal(singleSecretPayload, null, 'single-secret verify drops OLD tokens (the outage the helper prevents)');
    assert.ok(
      verifyJwtWithSecretRotation(oldToken, NEW_SECRET, OLD_SECRET),
      'dual-secret helper keeps OLD tokens alive during the drain window',
    );
  });

  test('helper never throws and never echoes secret material', () => {
    let threw = null;
    try {
      verifyJwtWithSecretRotation(sign(ATTACKER_SECRET), NEW_SECRET, OLD_SECRET);
      verifyJwtWithSecretRotation('x.y.z', NEW_SECRET, OLD_SECRET);
      verifyJwtWithSecretRotation(sign(OLD_SECRET), '', OLD_SECRET);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, null, 'helper swallows verify errors to null');
    const src = read(HELPER_SRC_PATH);
    assert.ok(!/console\.(log|error|warn)/.test(src), 'helper never logs (no secret echo path)');
  });

  test('mcp-oauth verifyAccessToken error text carries no secret values', () => {
    const block = fnBlock(read(MCP_OAUTH), 'async verifyAccessToken(token)');
    assert.ok(!block.includes('_sessionSecret}'), 'no secret interpolation in error messages');
    assert.ok(block.includes('Invalid access token'), 'stable generic error prefix retained');
  });

  test('SEC-KN-3 role-cap suite file still present and asserting (companion gate)', () => {
    const p = path.join(ROOT, 'test/sec-kn-3-mcp-access-role-cap.test.mjs');
    assert.ok(fs.existsSync(p), 'SEC-KN-3 suite must stay in-tree (run in the same test pass)');
  });
});

// ---------------------------------------------------------------------------
// Tier 7b — G10 source scan (frozen: every access-JWT verify site uses helper)
// ---------------------------------------------------------------------------
describe('P6 security — G10 source scan: every access-JWT verify site calls the helper', () => {
  const HELPER_CALL = 'verifyJwtWithSecretRotation(';

  test('gateway server.mjs: verifyToken, decodeVerifiedToken, resolveHostedActorRole', () => {
    const src = read(GATEWAY_SERVER);
    assert.ok(fnBlock(src, 'function verifyToken(token)').includes(HELPER_CALL), 'G10 verifyToken');
    assert.ok(fnBlock(src, 'function decodeVerifiedToken(token)').includes(HELPER_CALL), 'G10 decodeVerifiedToken');
    const rhar = src.slice(src.indexOf('async function resolveHostedActorRole'));
    assert.ok(rhar.slice(0, 2000).includes(HELPER_CALL), 'G10 resolveHostedActorRole bearer verify');
    assert.ok(
      !src.includes('jwt.verify(token, SESSION_SECRET)'),
      'no single-secret jwt.verify(token, SESSION_SECRET) remains in gateway server.mjs',
    );
  });

  test('gateway metadata-bulk-canister.mjs resolveRole', () => {
    const src = read(METADATA_BULK);
    assert.ok(src.includes(HELPER_CALL), 'G10 metadata bulk role resolve');
    assert.ok(!src.includes('jwt.verify('), 'no raw jwt.verify remains in metadata-bulk-canister.mjs');
  });

  test('gateway mcp-oauth-provider.mjs verifyAccessToken', () => {
    const src = read(MCP_OAUTH);
    assert.ok(fnBlock(src, 'async verifyAccessToken(token)').includes(HELPER_CALL), 'G10 MCP OAuth access verify');
    assert.ok(!src.includes('jwt.verify('), 'no raw jwt.verify remains in mcp-oauth-provider.mjs');
  });

  test('bridge server.mjs userIdFromJwt', () => {
    const src = read(BRIDGE_SERVER);
    assert.ok(fnBlock(src, 'function userIdFromJwt(token)').includes(HELPER_CALL), 'G10 bridge Bearer verify');
    assert.ok(!src.includes('jwt.verify('), 'no raw jwt.verify remains in bridge server.mjs');
  });

  test('bridge flow / capture / task route sessionBoundFromReq', () => {
    for (const p of [FLOW_ROUTES, FLOW_CAPTURE_ROUTES, TASK_ROUTES]) {
      const src = read(p);
      assert.ok(
        fnBlock(src, 'function sessionBoundFromReq(req)').includes(HELPER_CALL),
        `G10 ${path.basename(p)} sessionBoundFromReq`,
      );
      assert.ok(!src.includes('jwt.verify('), `no raw jwt.verify remains in ${path.basename(p)}`);
    }
  });

  test('both servers resolve SESSION_SECRET_PREVIOUS via the shared resolver', () => {
    assert.ok(read(GATEWAY_SERVER).includes('resolveSessionSecretPrevious()'), 'gateway boot-time previous resolve');
    assert.ok(read(BRIDGE_SERVER).includes('resolveSessionSecretPrevious()'), 'bridge boot-time previous resolve');
  });
});
