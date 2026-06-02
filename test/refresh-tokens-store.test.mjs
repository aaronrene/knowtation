/**
 * Durable refresh-token store tests (self-hosted file backend).
 *
 * Tiers: unit (each store op), integration (issue->rotate->revoke via disk),
 * data-integrity (atomic write, corruption fails closed, no secret on disk),
 * security (reuse detection persists across reads, wrong secret rejected),
 * performance (write stays bounded).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readRefreshTokens,
  writeRefreshTokens,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForSub,
  pruneRefreshTokens,
} from '../hub/refresh-tokens.mjs';
import { parseToken, REFRESH_FAILURE } from '../hub/lib/refresh-token-core.mjs';

const SUB = 'github:777';
let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-rt-'));
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
});

const storeFile = () => path.join(dataDir, 'hub_refresh_tokens.json');

describe('store — unit', () => {
  it('reads empty when no file exists', () => {
    assert.deepEqual(readRefreshTokens(dataDir), {});
  });

  it('issueRefreshToken writes a file and returns a usable token', () => {
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    assert.ok(token.includes('.'));
    assert.ok(fs.existsSync(storeFile()));
    const records = readRefreshTokens(dataDir);
    assert.equal(Object.keys(records).length, 1);
  });

  it('write is atomic — no leftover .tmp files remain', () => {
    issueRefreshToken(dataDir, SUB, { now: 1000 });
    const leftovers = fs.readdirSync(dataDir).filter((f) => f.endsWith('.tmp'));
    assert.equal(leftovers.length, 0, 'temp files must be renamed away');
  });
});

describe('store — integration via disk', () => {
  it('issue -> rotate -> rotate persists state across separate reads', () => {
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    const r1 = rotateRefreshToken(dataDir, token, { now: 2000 });
    assert.equal(r1.ok, true);
    const r2 = rotateRefreshToken(dataDir, r1.token, { now: 3000 });
    assert.equal(r2.ok, true);
    assert.equal(r2.sub, SUB);
  });

  it('logout via revokeRefreshToken invalidates the token on disk', () => {
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    const out = revokeRefreshToken(dataDir, token);
    assert.equal(out.revoked, true);
    const after = rotateRefreshToken(dataDir, token, { now: 2000 });
    assert.equal(after.ok, false);
  });

  it('revokeAllRefreshTokensForSub clears every session for a user on disk', () => {
    issueRefreshToken(dataDir, SUB, { now: 1000 });
    issueRefreshToken(dataDir, SUB, { now: 1000 });
    issueRefreshToken(dataDir, 'github:other', { now: 1000 });
    const { count } = revokeAllRefreshTokensForSub(dataDir, SUB);
    assert.equal(count, 2);
    const remaining = readRefreshTokens(dataDir);
    assert.equal(Object.values(remaining).every((r) => r.sub === 'github:other'), true);
  });
});

describe('store — data integrity', () => {
  it('a corrupt store file fails closed (reads empty) instead of throwing', () => {
    fs.writeFileSync(storeFile(), '{ this is : not json ', 'utf8');
    assert.deepEqual(readRefreshTokens(dataDir), {});
    // And we can recover by issuing fresh.
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    assert.ok(token);
  });

  it('records with no token_hash are ignored on read (schema guard)', () => {
    fs.writeFileSync(storeFile(), JSON.stringify({ tokens: { bad: { sub: SUB } } }), 'utf8');
    assert.deepEqual(readRefreshTokens(dataDir), {});
  });

  it('the raw secret never appears in the on-disk file', () => {
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    const { secret } = parseToken(token);
    const onDisk = fs.readFileSync(storeFile(), 'utf8');
    assert.ok(!onDisk.includes(secret), 'plaintext secret must not be written to disk');
  });

  it('store file is written with owner-only permissions (0600) where supported', () => {
    issueRefreshToken(dataDir, SUB, { now: 1000 });
    if (process.platform === 'win32') return; // POSIX perms not meaningful on Windows
    const mode = fs.statSync(storeFile()).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  });
});

describe('store — security', () => {
  it('reuse detection survives a round-trip through disk and burns the family', () => {
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    const r1 = rotateRefreshToken(dataDir, token, { now: 2000 });
    assert.equal(r1.ok, true);
    // Replay the original (already-rotated) token — read fresh from disk each call.
    const replay = rotateRefreshToken(dataDir, token, { now: 3000 });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, REFRESH_FAILURE.REUSE);
    // Victim's live successor is now dead too.
    const victim = rotateRefreshToken(dataDir, r1.token, { now: 4000 });
    assert.equal(victim.ok, false);
  });

  it('wrong secret for a known id is rejected and leaves the real session intact', () => {
    const { token } = issueRefreshToken(dataDir, SUB, { now: 1000 });
    const { id } = parseToken(token);
    const bad = rotateRefreshToken(dataDir, `${id}.${'Z'.repeat(43)}`, { now: 2000 });
    assert.equal(bad.ok, false);
    const good = rotateRefreshToken(dataDir, token, { now: 3000 });
    assert.equal(good.ok, true);
  });
});

describe('store — maintenance', () => {
  it('pruneRefreshTokens removes dead families', () => {
    issueRefreshToken(dataDir, 'github:dead', { now: 1000, tokenTtlMs: 1000, familyTtlMs: 1000 });
    issueRefreshToken(dataDir, 'github:live', { now: 1000 });
    const { removed } = pruneRefreshTokens(dataDir, { now: 5000 });
    assert.equal(removed, 1);
    assert.equal(Object.values(readRefreshTokens(dataDir)).every((r) => r.sub === 'github:live'), true);
  });

  it('writeRefreshTokens requires a data dir', () => {
    assert.throws(() => writeRefreshTokens('', {}), /data_dir required/);
  });
});
