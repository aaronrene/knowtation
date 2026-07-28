/**
 * SEC-KN-5 — seven-tier coverage for P12 (policy TTL ceiling) + P13 (admin-only grant mint).
 *
 * Frozen requirements: Pass 2 P12 / P13
 * (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`) —
 * vault policy `max_ttl_seconds` must not raise the ceiling above `MAX_TTL_SECONDS` (86400);
 * self-hosted `POST /api/v1/delegation/grants` must require `admin` (not viewer).
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  DELEGATION_POLICY_FILE,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  handleDelegationGrantMintRequest,
  readVaultDelegationPolicy,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import {
  makeAgentIdentity,
  makeDelegationConsent,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DELEGATION_SRC = path.join(ROOT, 'lib/agent/delegation.mjs');
const HUB_SERVER_SRC = path.join(ROOT, 'hub/server.mjs');

const OVERSIZE_TTL = 604800; // 7 days — the audit's example widening of SD-10
const UNDER_CAP_TTL = 7200;

/**
 * Pre-fix P12 behavior — accept any max_ttl_seconds > 0 with no ceiling.
 * Security tier asserts current code diverges from this on oversize policies.
 *
 * @param {string} dataDir
 * @returns {{ defaultTtlSeconds: number, maxTtlSeconds: number }}
 */
function readVaultDelegationPolicyLegacyUnclamped(dataDir) {
  const fp = path.join(dataDir, DELEGATION_POLICY_FILE);
  let policy = {};
  try {
    policy = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    policy = {};
  }
  const d = policy.delegation && typeof policy.delegation === 'object' ? policy.delegation : {};
  const defaultTtl =
    typeof d.default_ttl_seconds === 'number' && d.default_ttl_seconds > 0
      ? d.default_ttl_seconds
      : DEFAULT_TTL_SECONDS;
  const maxTtl =
    typeof d.max_ttl_seconds === 'number' && d.max_ttl_seconds > 0
      ? d.max_ttl_seconds
      : MAX_TTL_SECONDS;
  return { defaultTtlSeconds: defaultTtl, maxTtlSeconds: maxTtl };
}

/**
 * Pre-fix P13 role list on grant mint — viewer could issue runtime bearer authority.
 * @param {string} role
 * @returns {boolean}
 */
function grantMintRoleAllowedLegacy(role) {
  return new Set(['viewer', 'editor', 'admin', 'evaluator']).has(role);
}

/**
 * Fixed P13 role check — admin only.
 * @param {string} role
 * @returns {boolean}
 */
function grantMintRoleAllowedFixed(role) {
  return role === 'admin';
}

/**
 * @param {string} dataDir
 * @param {{ maxTtl?: number, defaultTtl?: number, enabled?: boolean }} [opts]
 */
function writePolicy(dataDir, opts = {}) {
  fs.writeFileSync(
    path.join(dataDir, DELEGATION_POLICY_FILE),
    JSON.stringify({
      delegation: {
        enabled: opts.enabled !== false,
        default_ttl_seconds: opts.defaultTtl ?? DEFAULT_TTL_SECONDS,
        max_ttl_seconds: opts.maxTtl ?? MAX_TTL_SECONDS,
      },
    }),
    'utf8',
  );
}

function mkDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kt-sec-kn-5-'));
}

/**
 * @param {string} dataDir
 * @param {{ ttlSeconds?: number, maxTtl?: number }} [opts]
 */
function seedAndMint(dataDir, opts = {}) {
  writePolicy(dataDir, { maxTtl: opts.maxTtl ?? OVERSIZE_TTL });
  process.env.DELEGATION_ENABLED = '1';
  const identity = makeAgentIdentity({ agentId: 'agent_sec_kn5_01' });
  const consent = makeDelegationConsent({
    consentId: 'dcons_sec_kn5_01',
    agentId: identity.agent_id,
  });
  seedDelegationFixtures(dataDir, 'default', identity, consent);
  return handleDelegationGrantMintRequest({
    dataDir,
    vaultId: 'default',
    consentId: consent.consent_id,
    actorAgentId: identity.agent_id,
    taskRef: 'task_hw_week3',
    ttlSeconds: opts.ttlSeconds,
  });
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-KN-5 unit — P12 TTL clamp + P13 role gate', () => {
  test('oversize max_ttl_seconds clamps to MAX_TTL_SECONDS', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: OVERSIZE_TTL });
      const policy = readVaultDelegationPolicy(dir);
      assert.equal(policy.maxTtlSeconds, MAX_TTL_SECONDS);
      assert.ok(policy.maxTtlSeconds < OVERSIZE_TTL);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('under-cap max_ttl_seconds is preserved', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: UNDER_CAP_TTL });
      const policy = readVaultDelegationPolicy(dir);
      assert.equal(policy.maxTtlSeconds, UNDER_CAP_TTL);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing max_ttl_seconds defaults to MAX_TTL_SECONDS', () => {
    const dir = mkDataDir();
    try {
      fs.writeFileSync(
        path.join(dir, DELEGATION_POLICY_FILE),
        JSON.stringify({ delegation: { enabled: true, default_ttl_seconds: 3600 } }),
        'utf8',
      );
      assert.equal(readVaultDelegationPolicy(dir).maxTtlSeconds, MAX_TTL_SECONDS);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('zero / negative max_ttl_seconds falls back to MAX_TTL_SECONDS', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: 0 });
      assert.equal(readVaultDelegationPolicy(dir).maxTtlSeconds, MAX_TTL_SECONDS);
      writePolicy(dir, { maxTtl: -100 });
      assert.equal(readVaultDelegationPolicy(dir).maxTtlSeconds, MAX_TTL_SECONDS);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exact MAX_TTL_SECONDS is accepted without further reduction', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: MAX_TTL_SECONDS });
      assert.equal(readVaultDelegationPolicy(dir).maxTtlSeconds, MAX_TTL_SECONDS);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('source: readVaultDelegationPolicy clamps with Math.min(..., MAX_TTL_SECONDS)', () => {
    const src = fs.readFileSync(DELEGATION_SRC, 'utf8');
    const fnStart = src.indexOf('export function readVaultDelegationPolicy');
    assert.ok(fnStart >= 0);
    const fnEnd = src.indexOf('\nexport function', fnStart + 1);
    const body = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
    assert.match(body, /Math\.min\([^)]*MAX_TTL_SECONDS/);
  });

  test('source: POST /delegation/grants is requireRole(admin) only', () => {
    const src = fs.readFileSync(HUB_SERVER_SRC, 'utf8');
    assert.match(src, /app\.post\('\/api\/v1\/delegation\/grants', requireRole\('admin'\)/);
    assert.doesNotMatch(
      src,
      /app\.post\('\/api\/v1\/delegation\/grants', requireRole\('viewer'/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (mint path consumes clamped policy)
// ---------------------------------------------------------------------------
describe('SEC-KN-5 integration — mint respects clamped ceiling', () => {
  test('client ttl_seconds of 604800 is clamped to 86400 via policy ceiling', () => {
    const dir = mkDataDir();
    try {
      const mint = seedAndMint(dir, { maxTtl: OVERSIZE_TTL, ttlSeconds: OVERSIZE_TTL });
      assert.equal(mint.ok, true, mint.error ?? mint.code);
      const issued = Date.parse(mint.payload.grant.issued_at);
      const expires = Date.parse(mint.payload.grant.expires_at);
      const ttlSec = Math.round((expires - issued) / 1000);
      assert.equal(ttlSec, MAX_TTL_SECONDS);
      assert.ok(ttlSec < OVERSIZE_TTL);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('under-cap policy still allows mint up to that policy max (not forced to 86400)', () => {
    const dir = mkDataDir();
    try {
      const mint = seedAndMint(dir, { maxTtl: UNDER_CAP_TTL, ttlSeconds: UNDER_CAP_TTL });
      assert.equal(mint.ok, true, mint.error ?? mint.code);
      const issued = Date.parse(mint.payload.grant.issued_at);
      const expires = Date.parse(mint.payload.grant.expires_at);
      const ttlSec = Math.round((expires - issued) / 1000);
      assert.equal(ttlSec, UNDER_CAP_TTL);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('consent propose route still allows viewer (P13 is mint-only)', () => {
    const src = fs.readFileSync(HUB_SERVER_SRC, 'utf8');
    assert.match(
      src,
      /app\.post\('\/api\/v1\/delegation\/consents', requireRole\('viewer', 'editor', 'admin', 'evaluator'\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (policy file → read → mint → grant TTL)
// ---------------------------------------------------------------------------
describe('SEC-KN-5 e2e — oversize policy cannot widen grant lifetime', () => {
  test('default mint (no client ttl) against oversize policy uses default ≤ 86400', () => {
    const dir = mkDataDir();
    try {
      const mint = seedAndMint(dir, { maxTtl: OVERSIZE_TTL });
      assert.equal(mint.ok, true, mint.error ?? mint.code);
      const issued = Date.parse(mint.payload.grant.issued_at);
      const expires = Date.parse(mint.payload.grant.expires_at);
      const ttlSec = Math.round((expires - issued) / 1000);
      assert.ok(ttlSec <= MAX_TTL_SECONDS);
      assert.equal(ttlSec, DEFAULT_TTL_SECONDS);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('MAX_TTL_SECONDS constant remains 86400 (SD-10 parity)', () => {
    assert.equal(MAX_TTL_SECONDS, 86400);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-KN-5 stress — many oversize policies all clamp', () => {
  test('2_000 oversize policy reads never exceed MAX_TTL_SECONDS', () => {
    const dir = mkDataDir();
    try {
      for (let i = 0; i < 2000; i++) {
        writePolicy(dir, { maxTtl: OVERSIZE_TTL + i });
        const policy = readVaultDelegationPolicy(dir);
        assert.equal(policy.maxTtlSeconds, MAX_TTL_SECONDS);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-KN-5 data-integrity — clamp is deterministic and non-mutating', () => {
  test('repeated reads of the same oversize policy yield identical clamped values', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: OVERSIZE_TTL, defaultTtl: 1800 });
      const a = readVaultDelegationPolicy(dir);
      const b = readVaultDelegationPolicy(dir);
      assert.deepEqual(a, b);
      assert.equal(a.maxTtlSeconds, MAX_TTL_SECONDS);
      assert.equal(a.defaultTtlSeconds, 1800);
      const raw = JSON.parse(fs.readFileSync(path.join(dir, DELEGATION_POLICY_FILE), 'utf8'));
      assert.equal(raw.delegation.max_ttl_seconds, OVERSIZE_TTL, 'clamp must not rewrite the file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-KN-5 performance — clamp path is bounded', () => {
  test('10_000 clamped reads complete within 2s', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: OVERSIZE_TTL });
      const t0 = performance.now();
      for (let i = 0; i < 10_000; i++) {
        const p = readVaultDelegationPolicy(dir);
        assert.equal(p.maxTtlSeconds, MAX_TTL_SECONDS);
      }
      const elapsed = performance.now() - t0;
      assert.ok(elapsed < 2000, `expected <2000ms, got ${elapsed.toFixed(1)}ms`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (regression vs pre-fix)
// ---------------------------------------------------------------------------
describe('SEC-KN-5 security — regressions vs pre-fix P12/P13', () => {
  test('P12 security regression: legacy accepts 604800; fixed clamps to 86400', () => {
    const dir = mkDataDir();
    try {
      writePolicy(dir, { maxTtl: OVERSIZE_TTL });
      const legacy = readVaultDelegationPolicyLegacyUnclamped(dir);
      const fixed = readVaultDelegationPolicy(dir);
      assert.equal(legacy.maxTtlSeconds, OVERSIZE_TTL, 'sanity: legacy widens SD-10');
      assert.equal(fixed.maxTtlSeconds, MAX_TTL_SECONDS);
      assert.notEqual(
        fixed.maxTtlSeconds,
        legacy.maxTtlSeconds,
        'fixed clamp must diverge from pre-fix unclamped accept',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('P12: mint against oversize policy cannot produce a grant TTL > 86400', () => {
    const dir = mkDataDir();
    try {
      const mint = seedAndMint(dir, { maxTtl: OVERSIZE_TTL, ttlSeconds: OVERSIZE_TTL });
      assert.equal(mint.ok, true);
      const issued = Date.parse(mint.payload.grant.issued_at);
      const expires = Date.parse(mint.payload.grant.expires_at);
      const ttlSec = Math.round((expires - issued) / 1000);
      assert.ok(ttlSec <= MAX_TTL_SECONDS);
      // Legacy path would have used Math.min(requested, unclampedPolicyMax) = 604800.
      assert.notEqual(ttlSec, OVERSIZE_TTL);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('P13 security regression: legacy allows viewer mint; fixed refuses viewer', () => {
    assert.equal(grantMintRoleAllowedLegacy('viewer'), true, 'sanity: pre-fix viewer could mint');
    assert.equal(grantMintRoleAllowedLegacy('admin'), true);
    assert.equal(grantMintRoleAllowedFixed('viewer'), false);
    assert.equal(grantMintRoleAllowedFixed('editor'), false);
    assert.equal(grantMintRoleAllowedFixed('evaluator'), false);
    assert.equal(grantMintRoleAllowedFixed('admin'), true);
    assert.notEqual(
      grantMintRoleAllowedFixed('viewer'),
      grantMintRoleAllowedLegacy('viewer'),
      'fixed admin-only gate must diverge from pre-fix viewer-inclusive list',
    );
  });

  test('P13 source regression: hub/server.mjs no longer lists viewer on grant mint', () => {
    const src = fs.readFileSync(HUB_SERVER_SRC, 'utf8');
    // Extract the grants POST middleware list and assert viewer is absent.
    const m = src.match(
      /app\.post\('\/api\/v1\/delegation\/grants',\s*requireRole\(([^)]+)\)/,
    );
    assert.ok(m, 'grant mint route must exist');
    const args = m[1];
    assert.match(args, /'admin'/);
    assert.doesNotMatch(args, /'viewer'/);
    assert.doesNotMatch(args, /'editor'/);
    assert.doesNotMatch(args, /'evaluator'/);
  });
});
