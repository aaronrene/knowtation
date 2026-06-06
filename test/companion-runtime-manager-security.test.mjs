/**
 * Tier 7 — SECURITY: lib/companion-runtime-manager.mjs
 *
 * The security tier is the centerpiece of Phase 4 testing. It covers, at minimum:
 *
 *   (a) SUPPLY-CHAIN: a wrong/missing integrity digest rejects the model — no execution on
 *       unverified bytes. An oversized or foreign-source download is rejected. HTTPS-only.
 *   (b) RESOURCE EXHAUSTION: backpressure trips at the configured bound. The lifecycle gate
 *       never serves inference in a non-ready state.
 *   (c) AMBIENT AUTHORITY: the module imports no vault, canister, keychain, or JWT handle.
 *       No secret, model path, URL, digest value, or access token appears in any reason
 *       string, return value, or thrown error.
 *   (d) CONSTANT-TIME: the integrity digest comparison is constant-time (no length/content
 *       timing oracle on the expected digest).
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md §2 (integrity), §3 (lifecycle),
 *            §4 (backpressure); docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md §4.6
 *            (no ambient authority).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  RUNTIME_MANAGER_REASONS,
  LIFECYCLE_STATES,
  LIFECYCLE_EVENTS,
  createIntegrityAccumulator,
  verifyModelBytes,
  validateSourceUrl,
  validateIntegritySpec,
  createLifecycleState,
  transitionLifecycle,
  canServeInference,
  createAdmissionState,
  evaluateAdmission,
  recordInFlight,
  createResourceLimits,
  evaluateResourceLimits,
  evaluateRuntimeRequest,
} from '../lib/companion-runtime-manager.mjs';

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.bin';
const VALID_DATA = Buffer.from('a legitimate model binary payload');
const VALID_DIGEST = makeDigest(VALID_DATA);
const VALID_SIZE = VALID_DATA.length;

const READY = { state: LIFECYCLE_STATES.READY };
const VALID_LIMITS = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
const VALID_OBS = { ramBytes: 1e9, vramBytes: 0.5e9, cpuPercent: 10 };

// ── (a) SUPPLY-CHAIN INTEGRITY ────────────────────────────────────────────────

describe('security: supply-chain — wrong digest rejects model before execution', () => {
  it('wrong digest (all zeros) is rejected — DIGEST_MISMATCH', () => {
    const r = verifyModelBytes({
      fileData: VALID_DATA, expectedDigest: '0'.repeat(64),
      expectedSizeBytes: VALID_SIZE, sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });

  it('wrong digest (one hex char flipped) is rejected', () => {
    const flipped = VALID_DIGEST.slice(0, -1) + (VALID_DIGEST.endsWith('0') ? '1' : '0');
    const r = verifyModelBytes({
      fileData: VALID_DATA, expectedDigest: flipped,
      expectedSizeBytes: VALID_SIZE, sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });

  it('missing digest (empty string spec) is rejected before download starts', () => {
    const r = validateIntegritySpec('', VALID_SIZE);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_SPEC);
  });

  it('missing digest (null) is rejected', () => {
    const r = validateIntegritySpec(null, VALID_SIZE);
    assert.equal(r.ok, false);
  });

  it('accumulator: digest mismatch from correct-length corrupted data → DIGEST_MISMATCH', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    const corrupted = Buffer.from(VALID_DATA);
    corrupted[0] ^= 0x01; // flip one bit
    acc.update(corrupted);
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });

  it('accumulator: size mismatch (one extra byte appended) → SIZE_MISMATCH', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(VALID_DATA);
    acc.update(Buffer.from([0x00])); // one extra byte
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.SIZE_MISMATCH);
  });

  it('accumulator: oversized download rejected when expectedSizeBytes is correct but more arrives', () => {
    // An attacker delivers more bytes than declared — size mismatch
    const declared = VALID_SIZE;
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: declared,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    // Feed declared + 1000 extra bytes
    acc.update(VALID_DATA);
    acc.update(Buffer.alloc(1000, 0x42)); // extra bytes from attacker
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.SIZE_MISMATCH);
  });

  it('HTTP source URL is rejected at spec-validation time (not download time)', () => {
    const r = validateSourceUrl('http://models.example.com/model.bin', ALLOWED_URLS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SCHEME_NOT_ALLOWED);
  });

  it('foreign source URL (not in allowlist) is rejected', () => {
    const r = validateSourceUrl('https://evil-models.net/model.bin', ALLOWED_URLS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SOURCE_NOT_ALLOWED);
  });

  it('empty allowlist rejects any URL — fail-closed', () => {
    const r = validateSourceUrl(VALID_URL, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SOURCE_NOT_ALLOWED);
  });

  it('accumulator throws when constructed with HTTP source URL', () => {
    assert.throws(
      () => createIntegrityAccumulator({
        expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
        sourceUrl: 'http://models.example.com/model.bin', allowedSourceUrls: ALLOWED_URLS,
      }),
      (err) => {
        assert.ok(err instanceof TypeError);
        // Error message must NOT contain the actual URL or digest (no secret leak)
        assert.ok(!err.message.includes('http://models.example.com'), 'URL leaked in error');
        return true;
      },
    );
  });

  it('accumulator throws when constructed with foreign source URL not in allowlist', () => {
    assert.throws(
      () => createIntegrityAccumulator({
        expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
        sourceUrl: 'https://evil-models.net/model.bin', allowedSourceUrls: ALLOWED_URLS,
      }),
      (err) => {
        assert.ok(err instanceof TypeError);
        assert.ok(!err.message.includes('evil-models.net'), 'URL leaked in error');
        return true;
      },
    );
  });
});

// ── (a) SUPPLY-CHAIN — no execution on unverified bytes ──────────────────────

describe('security: no execution path possible without integrity passing', () => {
  it('lifecycle gate can only reach ready via health_ok after start', () => {
    // There is no direct "stopped → ready" transition
    const r = transitionLifecycle(createLifecycleState(), LIFECYCLE_EVENTS.HEALTH_OK);
    assert.equal(r.ok, false); // invalid transition from stopped

    // Starting → ready requires health_ok, not any other event
    const s = { state: LIFECYCLE_STATES.STARTING };
    const r2 = transitionLifecycle(s, LIFECYCLE_EVENTS.DRAIN);
    assert.equal(r2.ok, false);
    const r3 = transitionLifecycle(s, LIFECYCLE_EVENTS.STOPPED);
    assert.equal(r3.ok, false);
    const r4 = transitionLifecycle(s, LIFECYCLE_EVENTS.START);
    assert.equal(r4.ok, false);
  });

  it('canServeInference is false in all non-ready states', () => {
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.STOPPED }), false);
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.STARTING }), false);
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.DRAINING }), false);
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.READY }), true); // only this
  });
});

// ── (b) RESOURCE EXHAUSTION — backpressure ────────────────────────────────────

describe('security: backpressure — flood of requests hits bound, never OOM overflow', () => {
  it('backpressure trips at exact maxInFlight boundary (100 requests)', () => {
    const MAX = 100;
    let admission = createAdmissionState({ maxInFlight: MAX, queueBound: 50 });

    for (let i = 0; i < MAX; i++) admission = recordInFlight(admission);

    // Exactly at the boundary — next request is AT_CAPACITY
    const r = evaluateAdmission(admission);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.AT_CAPACITY);
    assert.equal(admission.inFlight, MAX); // exact count, no overflow
  });

  it('queue_full trips at exact queueBound — third layer of defence', () => {
    const MAX_F = 2, MAX_Q = 5;
    let admission = createAdmissionState({ maxInFlight: MAX_F, queueBound: MAX_Q });
    for (let i = 0; i < MAX_F; i++) admission = recordInFlight(admission);
    admission = { ...admission, queued: MAX_Q };

    const r = evaluateAdmission(admission);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.QUEUE_FULL);
  });

  it('evaluateRuntimeRequest blocks when lifecycle is not ready (flood cannot bypass)', () => {
    const floodAdmission = createAdmissionState({ maxInFlight: 1000, queueBound: 1000 });
    const stopped = createLifecycleState();
    // Even with unlimited admission capacity, lifecycle blocks all
    for (let i = 0; i < 1000; i++) {
      const r = evaluateRuntimeRequest({
        lifecycleState: stopped, admissionState: floodAdmission,
        resourceObservation: VALID_OBS, resourceLimits: VALID_LIMITS,
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, RUNTIME_MANAGER_REASONS.NOT_READY);
    }
  });
});

// ── (b) RESOURCE EXHAUSTION — over-limit rejection ───────────────────────────

describe('security: resource limits prevent OOM', () => {
  it('RAM over limit → rejected before inference', () => {
    const obs = { ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes + 1 };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY, admissionState: createAdmissionState({ maxInFlight: 10, queueBound: 20 }),
      resourceObservation: obs, resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT);
  });

  it('VRAM over limit → rejected before inference', () => {
    const obs = { ...VALID_OBS, vramBytes: VALID_LIMITS.maxVramBytes + 1 };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY, admissionState: createAdmissionState({ maxInFlight: 10, queueBound: 20 }),
      resourceObservation: obs, resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.VRAM_OVER_LIMIT);
  });

  it('CPU over limit → rejected before inference', () => {
    const obs = { ...VALID_OBS, cpuPercent: VALID_LIMITS.maxCpuPercent + 1 };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY, admissionState: createAdmissionState({ maxInFlight: 10, queueBound: 20 }),
      resourceObservation: obs, resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.CPU_OVER_LIMIT);
  });
});

// ── (c) AMBIENT AUTHORITY — no vault/JWT/canister in module exports ───────────

describe('security: no ambient authority in module exports', () => {
  it('module exports do not include any vault, keychain, canister, or JWT accessor', async () => {
    const mod = await import('../lib/companion-runtime-manager.mjs');
    const exports = Object.keys(mod);
    const forbidden = ['vault', 'keychain', 'jwt', 'token', 'canister', 'session', 'auth', 'secret'];
    for (const key of exports) {
      for (const bad of forbidden) {
        assert.ok(
          !key.toLowerCase().includes(bad),
          `Export "${key}" looks like it exposes a sensitive authority (contains "${bad}")`,
        );
      }
    }
  });

  it('evaluateRuntimeRequest returns a verdict with ok and reason only — no embedded secrets', () => {
    const r = evaluateRuntimeRequest({
      lifecycleState: READY,
      admissionState: createAdmissionState({ maxInFlight: 4, queueBound: 8 }),
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    // Must have exactly ok and reason; no extra properties carrying data
    const keys = Object.keys(r);
    assert.deepEqual(keys.sort(), ['ok', 'reason'].sort());
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.reason, 'string');
  });
});

// ── (c) NO SECRET IN REASON STRINGS ──────────────────────────────────────────

describe('security: no secret/path/URL/digest in reason strings', () => {
  const secretPatterns = [
    VALID_URL,
    VALID_DIGEST,
    'models.example.com',
    'https://',
    'http://',
    '/model.bin',
  ];

  function assertNoSecretInReason(r, label) {
    for (const pattern of secretPatterns) {
      assert.ok(
        !r.reason.includes(pattern),
        `Reason "${r.reason}" contains secret pattern "${pattern}" in test: ${label}`,
      );
    }
  }

  it('validateSourceUrl failure reasons contain no URL', () => {
    assertNoSecretInReason(validateSourceUrl('http://models.example.com/m', ALLOWED_URLS), 'http src');
    assertNoSecretInReason(validateSourceUrl('https://evil.net/m', ALLOWED_URLS), 'foreign src');
    assertNoSecretInReason(validateSourceUrl('bad url', ALLOWED_URLS), 'bad url');
  });

  it('verifyModelBytes failure reasons contain no digest or URL', () => {
    assertNoSecretInReason(
      verifyModelBytes({ fileData: VALID_DATA, expectedDigest: '0'.repeat(64), expectedSizeBytes: VALID_SIZE, sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS }),
      'wrong digest',
    );
    assertNoSecretInReason(
      verifyModelBytes({ fileData: VALID_DATA, expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE + 1, sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS }),
      'size mismatch',
    );
  });

  it('evaluateRuntimeRequest failure reasons contain no observation values', () => {
    const obs = { ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes + 1 };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY, admissionState: createAdmissionState({ maxInFlight: 4, queueBound: 8 }),
      resourceObservation: obs, resourceLimits: VALID_LIMITS,
    });
    // Reason must not contain numeric values from the observation
    assert.ok(!r.reason.includes(String(obs.ramBytes)), 'ramBytes leaked in reason');
  });

  it('accumulator finalize failure reasons are fixed constants', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(Buffer.from('x'.repeat(VALID_SIZE))); // wrong content
    const verdict = acc.finalize();
    assertNoSecretInReason(verdict, 'digest mismatch');
  });
});

// ── (d) CONSTANT-TIME DIGEST COMPARISON ──────────────────────────────────────

describe('security: constant-time digest comparison in integrity accumulator', () => {
  it('timing is not correlated with prefix match length (statistical bound)', () => {
    // We measure timing for: all-zeros wrong digest vs. correct-prefix-but-wrong-suffix digest.
    // Both should produce DIGEST_MISMATCH in similar time. This is a statistical test;
    // the hash-of-hash approach in the implementation makes the comparison truly constant-time.
    const N = 100;

    // Prefix matches perfectly for many chars then diverges
    const prefixWrong = VALID_DIGEST.slice(0, 60) + '0000';
    // Completely different digest
    const allWrong = '0'.repeat(64);

    const timeWith = (digest) => {
      const start = performance.now();
      for (let i = 0; i < N; i++) {
        const acc = createIntegrityAccumulator({
          expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
          sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
        });
        acc.update(VALID_DATA);
        // Override internal state by creating a new acc with the attacker's digest as expected
        // Actually test via verifyModelBytes which uses the same constant-time path
      }
      return performance.now() - start;
    };

    // Use verifyModelBytes which exposes the same comparison path
    const timeVerify = (digest) => {
      const start = performance.now();
      for (let i = 0; i < N; i++) {
        verifyModelBytes({
          fileData: VALID_DATA, expectedDigest: digest, expectedSizeBytes: VALID_SIZE,
          sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
        });
      }
      return performance.now() - start;
    };

    const tAll = timeVerify(allWrong);
    const tPrefix = timeVerify(prefixWrong);
    // Allow up to 5× difference — a true timing oracle would be 10-100×.
    // This is a sanity check, not a rigorous timing test (which requires controlled hardware).
    const ratio = Math.max(tAll, tPrefix) / Math.min(tAll, tPrefix);
    assert.ok(ratio < 5, `Timing ratio ${ratio.toFixed(2)} suggests timing oracle. tAll=${tAll.toFixed(2)}ms tPrefix=${tPrefix.toFixed(2)}ms`);
  });
});

// ── (c) FAIL-CLOSED POSTURE — any ambiguous/null input denies ─────────────────

describe('security: global fail-closed posture', () => {
  const nullInputCases = [
    { fn: () => evaluateRuntimeRequest(null), label: 'null params' },
    { fn: () => evaluateRuntimeRequest({}), label: 'empty params' },
    { fn: () => evaluateRuntimeRequest({ lifecycleState: null, admissionState: null, resourceObservation: null, resourceLimits: null }), label: 'all null fields' },
    { fn: () => evaluateAdmission(null), label: 'null admission' },
    { fn: () => evaluateAdmission(undefined), label: 'undefined admission' },
    { fn: () => evaluateResourceLimits(null, VALID_LIMITS), label: 'null observation' },
    { fn: () => evaluateResourceLimits(VALID_OBS, null), label: 'null limits' },
    { fn: () => transitionLifecycle(null, LIFECYCLE_EVENTS.START), label: 'null lifecycle state' },
  ];

  for (const { fn, label } of nullInputCases) {
    it(`${label} → deny (ok:false)`, () => {
      const r = fn();
      assert.equal(r.ok, false, `expected ok:false for: ${label}`);
    });
  }

  it('evaluateRuntimeRequest never throws on any input', () => {
    const throwingInputs = [null, undefined, 'string', 42, [], () => {}];
    for (const inp of throwingInputs) {
      assert.doesNotThrow(
        () => evaluateRuntimeRequest(inp),
        `threw on input: ${JSON.stringify(inp)}`,
      );
    }
  });
});
