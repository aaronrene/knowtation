/**
 * Tier 1 — UNIT: lib/companion-runtime-manager.mjs
 *
 * Smallest behavioural contracts for each exported function in total isolation —
 * no network, no env, no child_process, no filesystem. Each section exercises one
 * exported function (or one logical control within it) so a failure pinpoints exactly
 * which invariant broke.
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md (module contract),
 *            docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md §4 (loopback controls),
 *            docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §1.1 (companionAvailable seam).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  RUNTIME_MANAGER_REASONS,
  ALLOWED_SOURCE_SCHEMES,
  SHA256_HEX_LENGTH,
  validateSourceUrl,
  validateIntegritySpec,
  createIntegrityAccumulator,
  verifyModelBytes,
  LIFECYCLE_STATES,
  LIFECYCLE_EVENTS,
  createLifecycleState,
  transitionLifecycle,
  canServeInference,
  createAdmissionState,
  evaluateAdmission,
  recordInFlight,
  recordCompletion,
  recordQueued,
  recordDequeued,
  createResourceLimits,
  evaluateResourceLimits,
  evaluateRuntimeRequest,
} from '../lib/companion-runtime-manager.mjs';

// ── Shared helpers ──────────────────────────────────────────────────────────

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.bin';
const VALID_DATA = Buffer.from('hello world model data');
const VALID_DIGEST = makeDigest(VALID_DATA);
const VALID_SIZE = VALID_DATA.length;

const READY_STATE = { state: LIFECYCLE_STATES.READY };

const VALID_LIMITS = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
const VALID_OBS = { ramBytes: 1e9, vramBytes: 0.5e9, cpuPercent: 10 };
const VALID_ADMISSION = createAdmissionState({ maxInFlight: 4, queueBound: 8 });

// ── §1 RUNTIME_MANAGER_REASONS ──────────────────────────────────────────────

describe('RUNTIME_MANAGER_REASONS', () => {
  it('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(RUNTIME_MANAGER_REASONS));
  });

  it('contains all expected reason keys', () => {
    const expected = [
      'OK', 'MALFORMED_SPEC', 'SOURCE_NOT_ALLOWED', 'SCHEME_NOT_ALLOWED',
      'SIZE_MISMATCH', 'DIGEST_MISMATCH', 'ACCUMULATOR_FINALIZED', 'ACCUMULATOR_ABORTED',
      'INVALID_TRANSITION', 'NOT_READY', 'UNKNOWN_EVENT', 'UNKNOWN_STATE',
      'MALFORMED_ADMISSION_STATE', 'AT_CAPACITY', 'QUEUE_FULL', 'NO_IN_FLIGHT_TO_COMPLETE',
      'MALFORMED_LIMITS', 'MALFORMED_OBSERVATION', 'RAM_OVER_LIMIT', 'VRAM_OVER_LIMIT',
      'CPU_OVER_LIMIT', 'MALFORMED_REQUEST_PARAMS',
    ];
    for (const key of expected) {
      assert.ok(Object.prototype.hasOwnProperty.call(RUNTIME_MANAGER_REASONS, key), `missing key: ${key}`);
    }
  });

  it('all values are non-empty strings', () => {
    for (const [k, v] of Object.entries(RUNTIME_MANAGER_REASONS)) {
      assert.equal(typeof v, 'string', `${k} value is not a string`);
      assert.ok(v.length > 0, `${k} value is empty`);
    }
  });
});

// ── §2 validateSourceUrl ────────────────────────────────────────────────────

describe('validateSourceUrl', () => {
  it('accepts a valid HTTPS URL in the allowlist', () => {
    const r = validateSourceUrl(VALID_URL, ALLOWED_URLS);
    assert.equal(r.ok, true);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.OK);
  });

  it('rejects non-string URL', () => {
    assert.equal(validateSourceUrl(null, ALLOWED_URLS).ok, false);
    assert.equal(validateSourceUrl(42, ALLOWED_URLS).ok, false);
  });

  it('rejects empty string URL', () => {
    assert.equal(validateSourceUrl('', ALLOWED_URLS).ok, false);
  });

  it('rejects HTTP URL (scheme not allowed)', () => {
    const r = validateSourceUrl('http://models.example.com/model.bin', ALLOWED_URLS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SCHEME_NOT_ALLOWED);
  });

  it('rejects FTP URL', () => {
    const r = validateSourceUrl('ftp://models.example.com/model.bin', ALLOWED_URLS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SCHEME_NOT_ALLOWED);
  });

  it('rejects URL not in allowlist', () => {
    const r = validateSourceUrl('https://evil.example.com/model.bin', ALLOWED_URLS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SOURCE_NOT_ALLOWED);
  });

  it('rejects empty allowlist', () => {
    const r = validateSourceUrl(VALID_URL, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SOURCE_NOT_ALLOWED);
  });

  it('rejects non-array allowlist', () => {
    const r = validateSourceUrl(VALID_URL, null);
    assert.equal(r.ok, false);
  });

  it('rejects unparseable URL', () => {
    const r = validateSourceUrl('not a url at all \\', ALLOWED_URLS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_SPEC);
  });

  it('ALLOWED_SOURCE_SCHEMES contains only https:', () => {
    assert.deepEqual([...ALLOWED_SOURCE_SCHEMES], ['https:']);
  });
});

// ── §3 validateIntegritySpec ─────────────────────────────────────────────────

describe('validateIntegritySpec', () => {
  it('accepts valid digest and size', () => {
    const r = validateIntegritySpec(VALID_DIGEST, VALID_SIZE);
    assert.equal(r.ok, true);
  });

  it('rejects non-string digest', () => {
    assert.equal(validateIntegritySpec(null, VALID_SIZE).ok, false);
  });

  it('rejects digest shorter than 64 chars', () => {
    assert.equal(validateIntegritySpec('a'.repeat(63), VALID_SIZE).ok, false);
  });

  it('rejects digest longer than 64 chars', () => {
    assert.equal(validateIntegritySpec('a'.repeat(65), VALID_SIZE).ok, false);
  });

  it('rejects uppercase hex chars in digest', () => {
    assert.equal(validateIntegritySpec('A'.repeat(64), VALID_SIZE).ok, false);
  });

  it('rejects non-hex chars in digest', () => {
    assert.equal(validateIntegritySpec('g'.repeat(64), VALID_SIZE).ok, false);
  });

  it('rejects zero expected size', () => {
    assert.equal(validateIntegritySpec(VALID_DIGEST, 0).ok, false);
  });

  it('rejects negative expected size', () => {
    assert.equal(validateIntegritySpec(VALID_DIGEST, -1).ok, false);
  });

  it('rejects non-integer expected size', () => {
    assert.equal(validateIntegritySpec(VALID_DIGEST, 1.5).ok, false);
  });

  it('SHA256_HEX_LENGTH is 64', () => {
    assert.equal(SHA256_HEX_LENGTH, 64);
  });
});

// ── §4 createIntegrityAccumulator ───────────────────────────────────────────

describe('createIntegrityAccumulator', () => {
  it('throws on malformed spec', () => {
    assert.throws(() => createIntegrityAccumulator({
      expectedDigest: 'bad', expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    }));
  });

  it('throws on bad source URL', () => {
    assert.throws(() => createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: 'http://models.example.com/model.bin', allowedSourceUrls: ALLOWED_URLS,
    }));
  });

  it('accepts valid inputs and returns object with update/finalize/getReceivedBytes/abort', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(typeof acc.update, 'function');
    assert.equal(typeof acc.finalize, 'function');
    assert.equal(typeof acc.getReceivedBytes, 'function');
    assert.equal(typeof acc.abort, 'function');
  });

  it('returns ok:true for matching data (single chunk)', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(VALID_DATA);
    const verdict = acc.finalize();
    assert.equal(verdict.ok, true, `expected ok, got: ${verdict.reason}`);
  });

  it('returns ok:true for multi-chunk updates', () => {
    const data = Buffer.from('abcdefghijklmnop');
    const digest = makeDigest(data);
    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: data.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(data.subarray(0, 8));
    acc.update(data.subarray(8));
    const verdict = acc.finalize();
    assert.equal(verdict.ok, true);
  });

  it('returns SIZE_MISMATCH when fewer bytes received', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(VALID_DATA.subarray(0, VALID_SIZE - 1)); // one byte short
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.SIZE_MISMATCH);
  });

  it('returns DIGEST_MISMATCH when data is wrong but size matches', () => {
    const corrupted = Buffer.from('x'.repeat(VALID_SIZE)); // same size, wrong content
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(corrupted);
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });

  it('returns ACCUMULATOR_FINALIZED on double finalize', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(VALID_DATA);
    acc.finalize();
    const v2 = acc.finalize();
    assert.equal(v2.ok, false);
    assert.equal(v2.reason, RUNTIME_MANAGER_REASONS.ACCUMULATOR_FINALIZED);
  });

  it('returns ACCUMULATOR_ABORTED after abort()', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.abort();
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.ACCUMULATOR_ABORTED);
  });

  it('getReceivedBytes tracks byte count', () => {
    const acc = createIntegrityAccumulator({
      expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(acc.getReceivedBytes(), 0);
    acc.update(VALID_DATA.subarray(0, 5));
    assert.equal(acc.getReceivedBytes(), 5);
    acc.update(VALID_DATA.subarray(5));
    assert.equal(acc.getReceivedBytes(), VALID_SIZE);
  });
});

// ── §5 verifyModelBytes ─────────────────────────────────────────────────────

describe('verifyModelBytes', () => {
  it('accepts matching data', () => {
    const r = verifyModelBytes({
      fileData: VALID_DATA, expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, true);
  });

  it('rejects wrong digest', () => {
    const wrong = '0'.repeat(64);
    const r = verifyModelBytes({
      fileData: VALID_DATA, expectedDigest: wrong, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });

  it('rejects size mismatch', () => {
    const r = verifyModelBytes({
      fileData: VALID_DATA, expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE + 1,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SIZE_MISMATCH);
  });

  it('rejects HTTP source URL', () => {
    const r = verifyModelBytes({
      fileData: VALID_DATA, expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: 'http://models.example.com/model.bin', allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.SCHEME_NOT_ALLOWED);
  });

  it('rejects non-Buffer fileData', () => {
    const r = verifyModelBytes({
      fileData: 'not-a-buffer', expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_SPEC);
  });
});

// ── §6 Lifecycle state machine ───────────────────────────────────────────────

describe('createLifecycleState', () => {
  it('returns stopped state initially', () => {
    const s = createLifecycleState();
    assert.equal(s.state, LIFECYCLE_STATES.STOPPED);
  });
});

describe('transitionLifecycle', () => {
  it('stopped → starting on start event', () => {
    const s = createLifecycleState();
    const r = transitionLifecycle(s, LIFECYCLE_EVENTS.START);
    assert.equal(r.ok, true);
    assert.equal(r.newState.state, LIFECYCLE_STATES.STARTING);
  });

  it('starting → ready on health_ok', () => {
    const s = { state: LIFECYCLE_STATES.STARTING };
    const r = transitionLifecycle(s, LIFECYCLE_EVENTS.HEALTH_OK);
    assert.equal(r.ok, true);
    assert.equal(r.newState.state, LIFECYCLE_STATES.READY);
  });

  it('starting → stopped on health_fail', () => {
    const s = { state: LIFECYCLE_STATES.STARTING };
    const r = transitionLifecycle(s, LIFECYCLE_EVENTS.HEALTH_FAIL);
    assert.equal(r.ok, true);
    assert.equal(r.newState.state, LIFECYCLE_STATES.STOPPED);
  });

  it('ready → draining on drain', () => {
    const s = { state: LIFECYCLE_STATES.READY };
    const r = transitionLifecycle(s, LIFECYCLE_EVENTS.DRAIN);
    assert.equal(r.ok, true);
    assert.equal(r.newState.state, LIFECYCLE_STATES.DRAINING);
  });

  it('draining → stopped on stopped', () => {
    const s = { state: LIFECYCLE_STATES.DRAINING };
    const r = transitionLifecycle(s, LIFECYCLE_EVENTS.STOPPED);
    assert.equal(r.ok, true);
    assert.equal(r.newState.state, LIFECYCLE_STATES.STOPPED);
  });

  it('rejects invalid transition (stopped + health_ok)', () => {
    const s = createLifecycleState();
    const r = transitionLifecycle(s, LIFECYCLE_EVENTS.HEALTH_OK);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.INVALID_TRANSITION);
  });

  it('rejects invalid transition (ready + health_ok)', () => {
    const r = transitionLifecycle({ state: LIFECYCLE_STATES.READY }, LIFECYCLE_EVENTS.HEALTH_OK);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.INVALID_TRANSITION);
  });

  it('rejects unknown event', () => {
    const s = createLifecycleState();
    const r = transitionLifecycle(s, 'nonexistent_event');
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.INVALID_TRANSITION);
  });

  it('rejects null event', () => {
    const s = createLifecycleState();
    const r = transitionLifecycle(s, null);
    assert.equal(r.ok, false);
  });

  it('rejects malformed state object', () => {
    const r = transitionLifecycle(null, LIFECYCLE_EVENTS.START);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.UNKNOWN_STATE);
  });

  it('does not mutate input state', () => {
    const s = createLifecycleState();
    transitionLifecycle(s, LIFECYCLE_EVENTS.START);
    assert.equal(s.state, LIFECYCLE_STATES.STOPPED); // unchanged
  });
});

describe('canServeInference', () => {
  it('returns true only for ready state', () => {
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.READY }), true);
  });

  it('returns false for stopped', () => {
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.STOPPED }), false);
  });

  it('returns false for starting', () => {
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.STARTING }), false);
  });

  it('returns false for draining', () => {
    assert.equal(canServeInference({ state: LIFECYCLE_STATES.DRAINING }), false);
  });

  it('returns false for null', () => {
    assert.equal(canServeInference(null), false);
  });

  it('returns false for empty object', () => {
    assert.equal(canServeInference({}), false);
  });

  it('returns false for unknown state string', () => {
    assert.equal(canServeInference({ state: 'unknown' }), false);
  });
});

// ── §7 Admission ─────────────────────────────────────────────────────────────

describe('createAdmissionState', () => {
  it('creates state with correct fields', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    assert.equal(s.maxInFlight, 4);
    assert.equal(s.queueBound, 8);
    assert.equal(s.inFlight, 0);
    assert.equal(s.queued, 0);
  });

  it('throws on non-integer maxInFlight', () => {
    assert.throws(() => createAdmissionState({ maxInFlight: 1.5, queueBound: 8 }));
  });

  it('throws on zero maxInFlight', () => {
    assert.throws(() => createAdmissionState({ maxInFlight: 0, queueBound: 8 }));
  });

  it('throws on negative queueBound', () => {
    assert.throws(() => createAdmissionState({ maxInFlight: 4, queueBound: -1 }));
  });
});

describe('evaluateAdmission', () => {
  it('allows when under max in-flight', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const r = evaluateAdmission(s);
    assert.equal(r.ok, true);
  });

  it('returns AT_CAPACITY when all slots full but queue has room', () => {
    let s = createAdmissionState({ maxInFlight: 2, queueBound: 4 });
    s = { ...s, inFlight: 2 };
    const r = evaluateAdmission(s);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.AT_CAPACITY);
  });

  it('returns QUEUE_FULL when both in-flight and queue are full', () => {
    let s = createAdmissionState({ maxInFlight: 2, queueBound: 4 });
    s = { ...s, inFlight: 2, queued: 4 };
    const r = evaluateAdmission(s);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.QUEUE_FULL);
  });

  it('returns MALFORMED_ADMISSION_STATE for null', () => {
    const r = evaluateAdmission(null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_ADMISSION_STATE);
  });
});

describe('recordInFlight / recordCompletion', () => {
  it('increments inFlight on recordInFlight', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const s2 = recordInFlight(s);
    assert.equal(s2.inFlight, 1);
    assert.equal(s.inFlight, 0); // original unchanged
  });

  it('decrements inFlight on recordCompletion', () => {
    let s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    s = recordInFlight(s);
    s = recordCompletion(s);
    assert.equal(s.inFlight, 0);
  });

  it('throws on recordCompletion when no in-flight', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    assert.throws(() => recordCompletion(s));
  });
});

describe('recordQueued / recordDequeued', () => {
  it('increments queued on recordQueued', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const s2 = recordQueued(s);
    assert.equal(s2.queued, 1);
    assert.equal(s.queued, 0); // original unchanged
  });

  it('decrements queued on recordDequeued', () => {
    let s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    s = recordQueued(s);
    s = recordDequeued(s);
    assert.equal(s.queued, 0);
  });

  it('throws on recordDequeued when no queued', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    assert.throws(() => recordDequeued(s));
  });
});

// ── §8 Resource limits ───────────────────────────────────────────────────────

describe('createResourceLimits', () => {
  it('creates valid limits', () => {
    const limits = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
    assert.equal(limits.maxRamBytes, 8e9);
    assert.equal(limits.maxVramBytes, 4e9);
    assert.equal(limits.maxCpuPercent, 80);
  });

  it('throws on non-finite RAM limit', () => {
    assert.throws(() => createResourceLimits({ maxRamBytes: NaN, maxVramBytes: 4e9, maxCpuPercent: 80 }));
  });

  it('throws on zero VRAM limit', () => {
    assert.throws(() => createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 0, maxCpuPercent: 80 }));
  });

  it('throws on CPU percent over 100', () => {
    assert.throws(() => createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 101 }));
  });

  it('throws on zero CPU percent', () => {
    assert.throws(() => createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 0 }));
  });
});

describe('evaluateResourceLimits', () => {
  it('allows when all metrics under limits', () => {
    const r = evaluateResourceLimits(VALID_OBS, VALID_LIMITS);
    assert.equal(r.ok, true);
  });

  it('returns RAM_OVER_LIMIT when RAM exceeded', () => {
    const obs = { ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes + 1 };
    const r = evaluateResourceLimits(obs, VALID_LIMITS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT);
  });

  it('returns VRAM_OVER_LIMIT when VRAM exceeded', () => {
    const obs = { ...VALID_OBS, vramBytes: VALID_LIMITS.maxVramBytes + 1 };
    const r = evaluateResourceLimits(obs, VALID_LIMITS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.VRAM_OVER_LIMIT);
  });

  it('returns CPU_OVER_LIMIT when CPU exceeded', () => {
    const obs = { ...VALID_OBS, cpuPercent: VALID_LIMITS.maxCpuPercent + 1 };
    const r = evaluateResourceLimits(obs, VALID_LIMITS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.CPU_OVER_LIMIT);
  });

  it('returns MALFORMED_LIMITS for null limits', () => {
    const r = evaluateResourceLimits(VALID_OBS, null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_LIMITS);
  });

  it('returns MALFORMED_OBSERVATION for null observation', () => {
    const r = evaluateResourceLimits(null, VALID_LIMITS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_OBSERVATION);
  });

  it('allows RAM exactly at limit (not over)', () => {
    const obs = { ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes };
    const r = evaluateResourceLimits(obs, VALID_LIMITS);
    assert.equal(r.ok, true);
  });
});

// ── §9 evaluateRuntimeRequest ────────────────────────────────────────────────

describe('evaluateRuntimeRequest', () => {
  it('allows when all gates pass', () => {
    const r = evaluateRuntimeRequest({
      lifecycleState: READY_STATE,
      admissionState: VALID_ADMISSION,
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.OK);
  });

  it('returns NOT_READY when lifecycle is stopped', () => {
    const r = evaluateRuntimeRequest({
      lifecycleState: createLifecycleState(),
      admissionState: VALID_ADMISSION,
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.NOT_READY);
  });

  it('returns NOT_READY when lifecycle is starting', () => {
    const r = evaluateRuntimeRequest({
      lifecycleState: { state: LIFECYCLE_STATES.STARTING },
      admissionState: VALID_ADMISSION,
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.NOT_READY);
  });

  it('returns QUEUE_FULL when admission gate is exhausted', () => {
    const fullState = { ...VALID_ADMISSION, inFlight: VALID_ADMISSION.maxInFlight, queued: VALID_ADMISSION.queueBound };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY_STATE,
      admissionState: fullState,
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.QUEUE_FULL);
  });

  it('returns RAM_OVER_LIMIT when RAM is over limit', () => {
    const obs = { ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes + 1 };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY_STATE,
      admissionState: VALID_ADMISSION,
      resourceObservation: obs,
      resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT);
  });

  it('returns MALFORMED_REQUEST_PARAMS when called with no params', () => {
    const r = evaluateRuntimeRequest();
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_REQUEST_PARAMS);
  });

  it('returns MALFORMED_REQUEST_PARAMS when any param is null', () => {
    const r = evaluateRuntimeRequest({
      lifecycleState: READY_STATE,
      admissionState: null,
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.MALFORMED_REQUEST_PARAMS);
  });

  it('lifecycle gate is checked before admission gate', () => {
    const fullAdmission = { ...VALID_ADMISSION, inFlight: VALID_ADMISSION.maxInFlight, queued: VALID_ADMISSION.queueBound };
    const r = evaluateRuntimeRequest({
      lifecycleState: { state: LIFECYCLE_STATES.STOPPED },
      admissionState: fullAdmission,
      resourceObservation: VALID_OBS,
      resourceLimits: VALID_LIMITS,
    });
    // Should be NOT_READY (lifecycle), not QUEUE_FULL (admission)
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.NOT_READY);
  });

  it('admission gate is checked before resource gate', () => {
    const fullAdmission = { ...VALID_ADMISSION, inFlight: VALID_ADMISSION.maxInFlight, queued: VALID_ADMISSION.queueBound };
    const obs = { ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes + 1 };
    const r = evaluateRuntimeRequest({
      lifecycleState: READY_STATE,
      admissionState: fullAdmission,
      resourceObservation: obs,
      resourceLimits: VALID_LIMITS,
    });
    // Should be QUEUE_FULL (admission), not RAM_OVER_LIMIT (resource)
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.QUEUE_FULL);
  });
});
