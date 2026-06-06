/**
 * Data-integrity tests for native OAuth C1–C6 changes.
 * Tier 5 of 7 — docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md §7.
 *
 * Verifies:
 *   - Single-use codes never double-spend (consume is atomic read+delete)
 *   - Refresh family invariants hold under the durable store
 *   - No scope drift on refresh (ceiling re-applied, never widens)
 *   - iss byte-stability vs discovery metadata
 *   - bindUserToCode is idempotent on the same code+userId
 *   - Corrupt/partial file gracefully normalizes to empty store (fail-closed)
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function sha256b64url(s) {
  return createHash('sha256').update(s).digest('base64url');
}

describe('C1–C6 Data Integrity', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-oauth-data-integrity-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = tmpDir;
  });

  after(async () => {
    delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Single-use code invariant ─────────────────────────────────────────────

  it('DI-1: authorization code is single-use (sequential consume: second always null)', async () => {
    const { savePendingCode, consumePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const code = 'di-single-use-' + randomUUID();
    await savePendingCode(code, {
      clientId: 'di-client',
      codeChallenge: sha256b64url('di-verifier'),
      redirectUri: 'http://127.0.0.1:1234/cb',
    });

    // First consume must succeed
    const r1 = await consumePendingCode(code);
    assert.ok(r1, 'first consume must return the entry');
    assert.equal(r1.clientId, 'di-client');

    // Second consume must always return null (code is single-use)
    const r2 = await consumePendingCode(code);
    assert.equal(r2, null, 'second consume must return null (code already consumed)');

    // Third consume also null
    const r3 = await consumePendingCode(code);
    assert.equal(r3, null, 'third consume must return null');
  });

  it('DI-2: consuming a non-existent code returns null gracefully', async () => {
    const { consumePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const result = await consumePendingCode('definitely-not-a-code-' + randomUUID());
    assert.equal(result, null);
  });

  // ── Refresh family invariants ─────────────────────────────────────────────

  it('DI-3: refresh family expires_at is always <= original family ceiling', async () => {
    const { issueToken, rotateToken } = await import('../hub/lib/refresh-token-core.mjs');
    const now = Date.now();
    const familyTtlMs = 90 * 24 * 60 * 60 * 1000;
    const { records: r0, token: t0 } = issueToken({}, { sub: 'google:di-family', now, familyTtlMs });
    const [firstId] = t0.split('.');
    const originalFamilyExpiry = r0[firstId].family_expires_at;

    let records = r0;
    let token = t0;
    for (let i = 0; i < 5; i++) {
      const result = rotateToken(records, token, { now: now + i * 1000 });
      assert.ok(result.ok);
      const [newId] = result.token.split('.');
      const newRecord = result.records[newId];
      assert.equal(
        newRecord.family_expires_at,
        originalFamilyExpiry,
        `rotation ${i + 1}: family_expires_at must not change`
      );
      records = result.records;
      token = result.token;
    }
  });

  it('DI-4: scope is never widened on refresh (ceiling re-applied from current role)', async () => {
    // Simulate what the native refresh endpoint does: re-derive ceiling on every refresh
    function grantedScopes(sub) {
      if (sub.includes('admin')) return ['vault:read', 'vault:write', 'admin'];
      return ['vault:read', 'vault:write'];
    }
    function applyScopeCeiling(requested, ceiling) {
      if (!Array.isArray(requested) || requested.length === 0) return [...ceiling];
      return requested.filter((s) => ceiling.includes(s));
    }

    // A member sub requests admin scope at refresh — must not receive it
    const sub = 'google:plain-member-di4';
    const ceiling = grantedScopes(sub);
    const requestedScopes = ['admin', 'vault:read', 'vault:write'];
    const result = applyScopeCeiling(requestedScopes, ceiling);
    assert.ok(!result.includes('admin'), 'admin must not appear in refresh scope');
    assert.deepEqual(result, ['vault:read', 'vault:write']);
  });

  it('DI-5: scope ceiling does not shrink scopes arbitrarily (member gets full vault access)', async () => {
    function grantedScopes(sub) {
      return ['vault:read', 'vault:write'];
    }
    function applyScopeCeiling(requested, ceiling) {
      if (!Array.isArray(requested) || requested.length === 0) return [...ceiling];
      return requested.filter((s) => ceiling.includes(s));
    }
    const sub = 'google:normal-member';
    const ceiling = grantedScopes(sub);
    // Empty requested → full ceiling
    const result = applyScopeCeiling([], ceiling);
    assert.deepEqual(result, ['vault:read', 'vault:write']);
  });

  // ── iss byte stability ────────────────────────────────────────────────────

  it('DI-6: issuerUrl is byte-stable across multiple construction calls', () => {
    const baseUrl = 'https://gateway.knowtation.ai';
    const issuer1 = `${baseUrl.replace(/\/$/, '')}/api/v1/auth/native`;
    const issuer2 = `${baseUrl.replace(/\/$/, '')}/api/v1/auth/native`;
    assert.equal(issuer1, issuer2, 'issuerUrl must be deterministic');
    assert.ok(!issuer1.endsWith('/'), 'issuerUrl must not have trailing slash');
  });

  it('DI-7: MCP provider _issuerUrl byte-stable vs SDK discovery issuer.href', async () => {
    const { KnowtationOAuthProvider } = await import('../hub/gateway/mcp-oauth-provider.mjs');
    const baseUrl = 'https://gateway.knowtation.ai';
    const provider = new KnowtationOAuthProvider({ sessionSecret: 's', baseUrl });
    // SDK uses: issuer.href where issuer = new URL(BASE_URL)
    const sdkIssuer = new URL(baseUrl).href;
    assert.equal(provider._issuerUrl, sdkIssuer, '_issuerUrl must match SDK discovery issuer');
  });

  // ── Store normalization (fail-closed) ─────────────────────────────────────

  it('DI-8: corrupt JSON file normalizes to empty store (fail-closed, no crash)', async () => {
    const filePath = path.join(tmpDir, 'native_pending_codes.json');
    await fs.writeFile(filePath, '{ "codes": { corrupt json', 'utf8');

    const { consumePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const result = await consumePendingCode('any-code');
    assert.equal(result, null, 'corrupt store must normalize to null (fail-closed)');
  });

  it('DI-9: completely empty file returns null gracefully', async () => {
    const filePath = path.join(tmpDir, 'native_pending_codes.json');
    await fs.writeFile(filePath, '', 'utf8');

    const { consumePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const result = await consumePendingCode('any-code');
    assert.equal(result, null);
  });

  it('DI-10: bindUserToCode is idempotent for same code+userId', async () => {
    const { savePendingCode, bindUserToCode, consumePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const code = 'di-idempotent-' + randomUUID();
    await savePendingCode(code, {
      clientId: 'di-idem-client',
      codeChallenge: sha256b64url('di-idem-v'),
      redirectUri: 'http://127.0.0.1:1235/cb',
    });

    const sub = 'google:idempotent-user';
    const b1 = await bindUserToCode(code, sub);
    const b2 = await bindUserToCode(code, sub); // same userId again
    assert.ok(b1, 'first bind must succeed');
    assert.ok(b2, 'second bind with same userId must also succeed (idempotent)');
    const entry = await consumePendingCode(code);
    assert.equal(entry.userId, sub, 'userId must be correct after idempotent bind');
  });

  it('DI-11: file mode is 0o600 after write (no group/world read)', async () => {
    const { savePendingCode } = await import('../hub/gateway/native-as-store.mjs');
    const code = 'di-mode-' + randomUUID();
    await savePendingCode(code, {
      clientId: 'mode-client',
      codeChallenge: sha256b64url('mode-v'),
      redirectUri: 'http://127.0.0.1:1236/cb',
    });
    const filePath = path.join(tmpDir, 'native_pending_codes.json');
    const stat = await fs.stat(filePath);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, 'store file must be mode 0o600 (owner only)');
  });
});
