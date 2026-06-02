/**
 * Hosted gateway refresh-token store — 7-tier suite.
 *
 * The gateway store is the hosted analogue of the self-hosted file store: it persists to a
 * Netlify Blob in production (here a stub) and a local JSON file in dev/test, while delegating
 * all security logic to the shared, pure `hub/lib/refresh-token-core.mjs`. These tests prove the
 * I/O layer is correct and that the security guarantees (hash-at-rest, rotation, reuse detection,
 * revocation, fail-closed corruption handling) survive the round-trip through both backends.
 *
 * Tiers: unit · integration · end-to-end · stress · data-integrity · performance · security.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForSub,
  pruneRefreshTokens,
  loadRefreshRecords,
  createGatewayRefreshStore,
} from '../hub/gateway/refresh-token-store.mjs';

const AUTH_BLOB_GLOBAL = '__knowtation_gateway_auth_blob';
const BLOB_KEY = 'refresh-tokens-v1';

/** In-memory stub mirroring the Netlify Blob `get`/`setJSON` contract used by the store. */
function createStubBlobStore() {
  const map = new Map();
  return {
    _map: map,
    writes: 0,
    async get(key, opts) {
      const raw = map.get(key);
      if (raw === undefined) return null;
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async setJSON(key, value) {
      this.writes += 1;
      map.set(key, JSON.stringify(value));
    },
  };
}

// ---------------------------------------------------------------------------
// Blob-backed (production path)
// ---------------------------------------------------------------------------
describe('gateway refresh store — blob backend', () => {
  let stub;
  beforeEach(() => {
    stub = createStubBlobStore();
    globalThis[AUTH_BLOB_GLOBAL] = stub;
  });
  afterEach(() => { delete globalThis[AUTH_BLOB_GLOBAL]; });

  // -------- unit --------
  it('unit: issue returns a "<id>.<secret>" token and persists under the tokens key', async () => {
    const { token, id, familyId } = await issueRefreshToken('google:1', { now: 1000 });
    assert.ok(token.includes('.'), 'token is id.secret');
    assert.ok(id && familyId);
    const persisted = await stub.get(BLOB_KEY, { type: 'json' });
    assert.ok(persisted.tokens[id], 'record stored by id');
    assert.equal(persisted.tokens[id].sub, 'google:1');
  });

  // -------- integration --------
  it('integration: a rotated token yields a new token and the old one is consumed', async () => {
    const first = await issueRefreshToken('google:1', { now: 1000 });
    const rotated = await rotateRefreshToken(first.token, { now: 2000 });
    assert.equal(rotated.ok, true);
    assert.notEqual(rotated.token, first.token);
    assert.equal(rotated.sub, 'google:1');
  });

  // -------- end-to-end / lifecycle --------
  it('e2e: issue → rotate×3 → logout → rotate fails (full session lifecycle)', async () => {
    let cur = (await issueRefreshToken('github:42', { now: 1000 })).token;
    for (let i = 0; i < 3; i++) {
      const r = await rotateRefreshToken(cur, { now: 2000 + i });
      assert.equal(r.ok, true);
      cur = r.token;
    }
    const out = await revokeRefreshToken(cur);
    assert.equal(out.revoked, true);
    const afterLogout = await rotateRefreshToken(cur, { now: 9000 });
    assert.equal(afterLogout.ok, false);
  });

  // -------- stress --------
  it('stress: 200 independent sessions issue + rotate without cross-contamination', async () => {
    const live = [];
    for (let i = 0; i < 200; i++) {
      const { token } = await issueRefreshToken(`google:${i}`, { now: 1000 });
      live.push({ i, token });
    }
    for (const s of live) {
      const r = await rotateRefreshToken(s.token, { now: 2000 });
      assert.equal(r.ok, true);
      assert.equal(r.sub, `google:${s.i}`, 'each rotation returns its own subject');
    }
    const persisted = await stub.get(BLOB_KEY, { type: 'json' });
    // 200 fresh successors live + 200 consumed tombstones retained for reuse detection.
    assert.equal(Object.keys(persisted.tokens).length, 400);
  });

  // -------- data-integrity --------
  it('data-integrity: a foreign/corrupt blob payload normalizes to an empty store (fail-closed)', async () => {
    stub._map.set(BLOB_KEY, JSON.stringify({ tokens: { junk: { not: 'a token' }, '': null }, garbage: 1 }));
    const records = await loadRefreshRecords();
    assert.deepEqual(records, {}, 'only well-formed records survive; nothing throws');
  });

  it('data-integrity: the raw secret is never written to the store (only its hash)', async () => {
    const { token, id } = await issueRefreshToken('google:1', { now: 1000 });
    const secret = token.slice(token.indexOf('.') + 1);
    const persistedRaw = stub._map.get(BLOB_KEY);
    assert.ok(!persistedRaw.includes(secret), 'raw secret must not appear in persisted JSON');
    const rec = JSON.parse(persistedRaw).tokens[id];
    assert.ok(typeof rec.token_hash === 'string' && rec.token_hash.length > 0);
    assert.equal(rec.secret, undefined);
  });

  // -------- performance --------
  it('performance: 300 issue+rotate cycles complete well under budget', async () => {
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) {
      const { token } = await issueRefreshToken(`u:${i}`, { now: 1000 });
      await rotateRefreshToken(token, { now: 1001 });
    }
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 5000, `expected < 5s, took ${elapsed}ms`);
  });

  // -------- security --------
  it('security: replaying a rotated token is detected as reuse and burns the whole family', async () => {
    const first = await issueRefreshToken('google:1', { now: 1000 });
    const rotated = await rotateRefreshToken(first.token, { now: 2000 });
    assert.equal(rotated.ok, true);
    // Replay the original (already-rotated) token.
    const replay = await rotateRefreshToken(first.token, { now: 3000 });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, 'reuse');
    // The successor minted from the stolen family is now dead too.
    const successorAfterBurn = await rotateRefreshToken(rotated.token, { now: 4000 });
    assert.equal(successorAfterBurn.ok, false);
  });

  it('security: revokeAllRefreshTokensForSub signs out every session for a user', async () => {
    const a = await issueRefreshToken('google:1', { now: 1000 });
    const b = await issueRefreshToken('google:1', { now: 1000 });
    const { count } = await revokeAllRefreshTokensForSub('google:1');
    assert.equal(count, 2);
    assert.equal((await rotateRefreshToken(a.token, { now: 2000 })).ok, false);
    assert.equal((await rotateRefreshToken(b.token, { now: 2000 })).ok, false);
  });

  it('security: read-after-write — a rotation observes its own consume immediately', async () => {
    // The blob is configured strong-consistency in prod; the stub is synchronous-by-await here,
    // proving the store reads back the state it just wrote before the next decision.
    const first = await issueRefreshToken('google:1', { now: 1000 });
    await rotateRefreshToken(first.token, { now: 2000 });
    const persisted = await stub.get(BLOB_KEY, { type: 'json' });
    const id = first.token.slice(0, first.token.indexOf('.'));
    assert.ok(persisted.tokens[id].rotated_to, 'old record carries a rotated_to tombstone');
  });

  it('createGatewayRefreshStore exposes a working async { issue, rotate, revoke } adapter', async () => {
    const store = createGatewayRefreshStore();
    const { token } = await store.issue('google:1', { now: 1000 });
    const r = await store.rotate(token, { now: 2000 });
    assert.equal(r.ok, true);
    const out = await store.revoke(r.token);
    assert.equal(out.revoked, true);
  });
});

// ---------------------------------------------------------------------------
// File-backed (dev / persistent-gateway fallback)
// ---------------------------------------------------------------------------
describe('gateway refresh store — file backend', () => {
  let dir, savedEnv;
  beforeEach(() => {
    delete globalThis[AUTH_BLOB_GLOBAL]; // force file path
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-gw-refresh-'));
    savedEnv = process.env.KNOWTATION_GATEWAY_DATA_DIR;
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
    else process.env.KNOWTATION_GATEWAY_DATA_DIR = savedEnv;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* noop */ }
  });

  it('integration: issue persists a JSON file that rotate can read back', async () => {
    const { token } = await issueRefreshToken('google:1', { now: 1000 });
    const file = path.join(dir, 'hosted_refresh_tokens.json');
    assert.ok(fs.existsSync(file), 'store file written');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(parsed.tokens && Object.keys(parsed.tokens).length === 1);
    const r = await rotateRefreshToken(token, { now: 2000 });
    assert.equal(r.ok, true);
  });

  it('data-integrity: a missing store file loads as empty (no throw)', async () => {
    const records = await loadRefreshRecords();
    assert.deepEqual(records, {});
  });

  it('data-integrity: a corrupt store file fails closed to empty', async () => {
    fs.writeFileSync(path.join(dir, 'hosted_refresh_tokens.json'), '{ this is not json', 'utf8');
    const records = await loadRefreshRecords();
    assert.deepEqual(records, {});
  });

  it('prune removes dead records once the family lifetime has elapsed', async () => {
    await issueRefreshToken('google:1', { now: 1000, tokenTtlMs: 10, familyTtlMs: 10 });
    const { removed } = await pruneRefreshTokens({ now: 10_000_000 });
    assert.ok(removed >= 1);
  });
});
