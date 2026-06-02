/**
 * Refresh-token core tests — Aaron's 7-tier standard.
 *
 * Tiers covered here (pure module; HTTP end-to-end lands with route wiring):
 *   1. unit            — generate/hash/parse + each operation in isolation
 *   2. integration     — multi-step login -> rotate -> rotate chains
 *   3. lifecycle (e2e) — full session lifecycle within the module boundary
 *   4. stress          — large stores and long rotation chains
 *   5. data-integrity  — purity (no input mutation), persisted shape, no secret leakage
 *   6. performance     — rotation stays O(1)-ish under a large store
 *   7. security        — reuse detection, secret-at-rest, tampering, expiry, family cap
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOKEN_TTL_MS,
  DEFAULT_FAMILY_TTL_MS,
  REFRESH_FAILURE,
  hashSecret,
  generateRefreshToken,
  parseToken,
  issueToken,
  rotateToken,
  revokeToken,
  revokeFamily,
  revokeAllForSub,
  pruneExpired,
} from '../hub/lib/refresh-token-core.mjs';

const SUB = 'google:123456';
const T0 = 1_000_000_000_000; // fixed base "now" for deterministic tests

/**
 * Build a large store directly (O(n)) for performance/stress probes, instead of calling
 * issueToken n times (which clones the growing store each call → O(n^2) and slows CI).
 * @returns {{ records: Record<string, object>, firstToken: string }}
 */
function buildLargeStore(n, now) {
  const records = {};
  let firstToken = null;
  for (let i = 0; i < n; i++) {
    const g = generateRefreshToken();
    records[g.id] = {
      sub: `google:${i}`,
      family_id: `family-${i}`,
      token_hash: g.tokenHash,
      created_at: now,
      expires_at: now + DEFAULT_TOKEN_TTL_MS,
      family_expires_at: now + DEFAULT_FAMILY_TTL_MS,
      rotated_to: null,
      used_at: null,
      revoked: false,
      meta: {},
    };
    if (i === 0) firstToken = g.token;
  }
  return { records, firstToken };
}

// ---------------------------------------------------------------------------
// 1. unit
// ---------------------------------------------------------------------------
describe('1. unit — primitives', () => {
  it('generateRefreshToken returns id.secret with a stored hash and no plaintext reuse', () => {
    const t = generateRefreshToken();
    assert.ok(t.id && t.secret && t.token && t.tokenHash);
    assert.equal(t.token, `${t.id}.${t.secret}`);
    assert.equal(t.tokenHash, hashSecret(t.secret));
    assert.notEqual(t.tokenHash, t.secret, 'hash must differ from secret');
  });

  it('generateRefreshToken is unpredictable (no collisions across many draws)', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const t = generateRefreshToken();
      assert.ok(!seen.has(t.token), 'tokens must be unique');
      seen.add(t.token);
    }
  });

  it('parseToken splits valid tokens and rejects malformed input', () => {
    assert.deepEqual(parseToken('abc.def'), { id: 'abc', secret: 'def' });
    assert.equal(parseToken(''), null);
    assert.equal(parseToken('noseparator'), null);
    assert.equal(parseToken('.leadingdot'), null);
    assert.equal(parseToken('trailingdot.'), null);
    assert.equal(parseToken('a.b.c'), null, 'secret may not contain a dot');
    assert.equal(parseToken(null), null);
    assert.equal(parseToken(42), null);
  });

  it('hashSecret is deterministic and base64url', () => {
    assert.equal(hashSecret('x'), hashSecret('x'));
    assert.notEqual(hashSecret('x'), hashSecret('y'));
    assert.match(hashSecret('x'), /^[A-Za-z0-9_-]+$/);
  });

  it('issueToken requires a sub', () => {
    assert.throws(() => issueToken({}, { sub: '' }), /sub is required/);
    assert.throws(() => issueToken({}, {}), /sub is required/);
  });

  it('issueToken creates exactly one record with the expected fields', () => {
    const { records, token, id, familyId } = issueToken({}, { sub: SUB, now: T0 });
    assert.equal(Object.keys(records).length, 1);
    const rec = records[id];
    assert.equal(rec.sub, SUB);
    assert.equal(rec.family_id, familyId);
    assert.equal(rec.expires_at, T0 + DEFAULT_TOKEN_TTL_MS);
    assert.equal(rec.family_expires_at, T0 + DEFAULT_FAMILY_TTL_MS);
    assert.equal(rec.rotated_to, null);
    assert.equal(rec.revoked, false);
    assert.equal(rec.token_hash, hashSecret(parseToken(token).secret));
  });
});

// ---------------------------------------------------------------------------
// 2. integration
// ---------------------------------------------------------------------------
describe('2. integration — rotation chains', () => {
  it('a valid token rotates to a new working token; the old one is consumed', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const r1 = rotateToken(issued.records, issued.token, { now: T0 + 1000 });
    assert.equal(r1.ok, true);
    assert.equal(r1.sub, SUB);
    assert.notEqual(r1.token, issued.token);

    // New token works again
    const r2 = rotateToken(r1.records, r1.token, { now: T0 + 2000 });
    assert.equal(r2.ok, true);
    assert.notEqual(r2.token, r1.token);
  });

  it('rotation preserves the family id across the chain', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const r1 = rotateToken(issued.records, issued.token, { now: T0 + 1 });
    const r2 = rotateToken(r1.records, r1.token, { now: T0 + 2 });
    assert.equal(r1.familyId, issued.familyId);
    assert.equal(r2.familyId, issued.familyId);
  });

  it('rotation carries the absolute family ceiling forward (rotation cannot extend it)', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const familyCap = issued.records[issued.id].family_expires_at;
    const r1 = rotateToken(issued.records, issued.token, { now: T0 + 5000 });
    const newRec = Object.values(r1.records).find((rec) => rec.rotated_to === null && !rec.revoked);
    assert.equal(newRec.family_expires_at, familyCap, 'family ceiling must not move on rotation');
  });

  it('two independent logins create independent families', () => {
    const a = issueToken({}, { sub: SUB, now: T0 });
    const b = issueToken(a.records, { sub: SUB, now: T0 });
    assert.notEqual(a.familyId, b.familyId);
    // Revoking family A leaves B usable.
    const burned = revokeFamily(b.records, a.familyId, T0);
    const rb = rotateToken(burned, b.token, { now: T0 + 1 });
    assert.equal(rb.ok, true);
  });
});

// ---------------------------------------------------------------------------
// 3. lifecycle (end-to-end within the module)
// ---------------------------------------------------------------------------
describe('3. lifecycle — login, refresh repeatedly, logout', () => {
  it('models a real session: login then many refreshes then logout invalidates', () => {
    let { records, token } = issueToken({}, { sub: SUB, now: T0 });
    let now = T0;
    for (let i = 0; i < 50; i++) {
      now += 60_000; // refresh every minute
      const r = rotateToken(records, token, { now });
      assert.equal(r.ok, true, `refresh #${i} should succeed`);
      records = r.records;
      token = r.token;
    }
    // Logout the current token.
    const out = revokeToken(records, token);
    assert.equal(out.revoked, true);
    // The token can no longer be used.
    const after = rotateToken(out.records, token, { now: now + 1000 });
    assert.equal(after.ok, false);
    assert.equal(after.reason, REFRESH_FAILURE.INVALID);
  });
});

// ---------------------------------------------------------------------------
// 4. stress
// ---------------------------------------------------------------------------
describe('4. stress — large stores and long chains', () => {
  it('handles many concurrent families without cross-contamination', () => {
    let records = {};
    const tokens = [];
    for (let i = 0; i < 1500; i++) {
      const res = issueToken(records, { sub: `google:${i}`, now: T0 });
      records = res.records;
      tokens.push(res.token);
    }
    assert.equal(Object.keys(records).length, 1500);
    // Rotate a sampling; each must succeed and keep the store consistent.
    for (const idx of [0, 750, 1499]) {
      const r = rotateToken(records, tokens[idx], { now: T0 + 1 });
      assert.equal(r.ok, true);
      records = r.records;
    }
  });

  it('survives a 500-deep rotation chain', () => {
    let { records, token } = issueToken({}, { sub: SUB, now: T0 });
    for (let i = 0; i < 500; i++) {
      const r = rotateToken(records, token, { now: T0 + i });
      assert.equal(r.ok, true);
      records = r.records;
      token = r.token;
    }
  });
});

// ---------------------------------------------------------------------------
// 5. data-integrity
// ---------------------------------------------------------------------------
describe('5. data-integrity — purity and no secret leakage', () => {
  it('issueToken does not mutate the input records object', () => {
    const input = {};
    const frozen = Object.freeze(input);
    const res = issueToken(frozen, { sub: SUB, now: T0 });
    assert.equal(Object.keys(input).length, 0, 'input must be untouched');
    assert.equal(Object.keys(res.records).length, 1);
  });

  it('rotateToken does not mutate the input records object', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const snapshot = JSON.stringify(issued.records);
    rotateToken(issued.records, issued.token, { now: T0 + 1 });
    assert.equal(JSON.stringify(issued.records), snapshot, 'rotate must not mutate caller records');
  });

  it('the raw secret is never present anywhere in the persisted records', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const { secret } = parseToken(issued.token);
    assert.ok(!JSON.stringify(issued.records).includes(secret), 'secret must not be stored');
  });

  it('persisted records are JSON-serializable and round-trip identically', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const round = JSON.parse(JSON.stringify(issued.records));
    const r = rotateToken(round, issued.token, { now: T0 + 1 });
    assert.equal(r.ok, true, 'rotation must work on a JSON round-tripped store');
  });

  it('meta is sanitized to known short fields only', () => {
    const issued = issueToken({}, {
      sub: SUB,
      now: T0,
      meta: { ua: 'x'.repeat(1000), ip: 'y'.repeat(200), evil: { nested: true }, fn: () => {} },
    });
    const rec = issued.records[issued.id];
    assert.equal(rec.meta.ua.length, 256);
    assert.equal(rec.meta.ip.length, 64);
    assert.equal(rec.meta.evil, undefined);
    assert.equal(rec.meta.fn, undefined);
  });
});

// ---------------------------------------------------------------------------
// 6. performance
// ---------------------------------------------------------------------------
describe('6. performance — rotation cost under a large store', () => {
  it('rotates within a tight budget even with 20k records present', () => {
    const { records, firstToken } = buildLargeStore(20_000, T0);
    const start = process.hrtime.bigint();
    const r = rotateToken(records, firstToken, { now: T0 + 1 });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(r.ok, true);
    // Generous CI-safe ceiling; the operation itself is dominated by the clone, not lookup.
    assert.ok(elapsedMs < 250, `rotation took ${elapsedMs.toFixed(1)}ms, expected < 250ms`);
  });
});

// ---------------------------------------------------------------------------
// 7. security
// ---------------------------------------------------------------------------
describe('7. security — the parts that must never regress', () => {
  it('replaying an already-rotated token is detected as REUSE and burns the family', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const r1 = rotateToken(issued.records, issued.token, { now: T0 + 1 });
    assert.equal(r1.ok, true);

    // Attacker replays the ORIGINAL (already-rotated) token.
    const replay = rotateToken(r1.records, issued.token, { now: T0 + 2 });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, REFRESH_FAILURE.REUSE);

    // The legitimate successor token is now dead too (whole family revoked).
    const victim = rotateToken(replay.records, r1.token, { now: T0 + 3 });
    assert.equal(victim.ok, false);
    assert.equal(victim.reason, REFRESH_FAILURE.REVOKED);
  });

  it('a wrong secret for a known id is rejected as INVALID and does not consume the token', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const { id } = parseToken(issued.token);
    const forged = `${id}.${'A'.repeat(43)}`;
    const bad = rotateToken(issued.records, forged, { now: T0 + 1 });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, REFRESH_FAILURE.INVALID);
    // The real token still works (forged attempt must not have rotated/locked it).
    const good = rotateToken(bad.records, issued.token, { now: T0 + 2 });
    assert.equal(good.ok, true);
  });

  it('an unknown id is INVALID', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const res = rotateToken(issued.records, 'unknownid.unknownsecret', { now: T0 + 1 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, REFRESH_FAILURE.INVALID);
  });

  it('a per-token-expired token is EXPIRED and removed', () => {
    const issued = issueToken({}, { sub: SUB, now: T0, tokenTtlMs: 1000 });
    const res = rotateToken(issued.records, issued.token, { now: T0 + 2000 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, REFRESH_FAILURE.EXPIRED);
    assert.equal(Object.keys(res.records).length, 0, 'expired record should be pruned on use');
  });

  it('rotation is refused once the absolute family ceiling passes, even with a fresh token', () => {
    const issued = issueToken({}, { sub: SUB, now: T0, tokenTtlMs: 10_000, familyTtlMs: 5000 });
    const res = rotateToken(issued.records, issued.token, { now: T0 + 6000 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, REFRESH_FAILURE.EXPIRED);
  });

  it('revokeToken requires the correct secret — a known id alone cannot evict a session', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const { id } = parseToken(issued.token);
    const attempt = revokeToken(issued.records, `${id}.wrongsecret`);
    assert.equal(attempt.revoked, false);
    assert.equal(Object.keys(attempt.records).length, 1, 'session must survive a wrong-secret revoke');
  });

  it('revokeAllForSub clears only the targeted user', () => {
    let r = issueToken({}, { sub: 'google:a', now: T0 });
    r = issueToken(r.records, { sub: 'google:a', now: T0 });
    r = issueToken(r.records, { sub: 'google:b', now: T0 });
    const { records, count } = revokeAllForSub(r.records, 'google:a');
    assert.equal(count, 2);
    assert.equal(Object.values(records).every((rec) => rec.sub === 'google:b'), true);
  });

  it('a revoked token reports REVOKED, not success', () => {
    const issued = issueToken({}, { sub: SUB, now: T0 });
    const burned = revokeFamily(issued.records, issued.familyId, T0);
    const res = rotateToken(burned, issued.token, { now: T0 + 1 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, REFRESH_FAILURE.REVOKED);
  });

  it('pruneExpired removes dead families but keeps live tokens', () => {
    let r = issueToken({}, { sub: 'google:live', now: T0, familyTtlMs: DEFAULT_FAMILY_TTL_MS });
    r = issueToken(r.records, { sub: 'google:dead', now: T0, tokenTtlMs: 1000, familyTtlMs: 1000 });
    const { records, removed } = pruneExpired(r.records, { now: T0 + 2000 });
    assert.equal(removed, 1);
    assert.equal(Object.values(records).every((rec) => rec.sub === 'google:live'), true);
  });
});
