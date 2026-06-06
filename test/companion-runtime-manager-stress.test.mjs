/**
 * Tier 4 — STRESS: lib/companion-runtime-manager.mjs
 *
 * High-volume, adversarial-volume, and boundary-condition tests. Verifies that the pure
 * functions remain correct and do not corrupt state under heavy concurrent-use simulation,
 * floods of requests at the backpressure bound, and pathological inputs.
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md §4 (backpressure), §5 (Phase 5 obligations).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  RUNTIME_MANAGER_REASONS,
  LIFECYCLE_STATES,
  LIFECYCLE_EVENTS,
  createIntegrityAccumulator,
  createLifecycleState,
  transitionLifecycle,
  canServeInference,
  createAdmissionState,
  evaluateAdmission,
  recordInFlight,
  recordCompletion,
  createResourceLimits,
  evaluateResourceLimits,
  evaluateRuntimeRequest,
} from '../lib/companion-runtime-manager.mjs';

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.gguf';
const READY_STATE = { state: LIFECYCLE_STATES.READY };
const VALID_LIMITS = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
const VALID_OBS = { ramBytes: 1e9, vramBytes: 0.5e9, cpuPercent: 10 };

// ── Stress: lifecycle transitions ────────────────────────────────────────────

describe('stress: 10k lifecycle round-trips', () => {
  it('produces correct terminal state after 10000 stopped→starting→ready→drain→stopped cycles', () => {
    let lifecycle = createLifecycleState();
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_OK).newState;
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.DRAIN).newState;
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.STOPPED).newState;
    }

    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
    assert.equal(canServeInference(lifecycle), false);
  });
});

// ── Stress: admission at backpressure bound ───────────────────────────────────

describe('stress: backpressure trips at exact bound', () => {
  it('MAX_IN_FLIGHT=100 — 100 admissions succeed, 101st is AT_CAPACITY', () => {
    const MAX = 100;
    let admission = createAdmissionState({ maxInFlight: MAX, queueBound: 50 });
    const limits = VALID_LIMITS;
    const obs = VALID_OBS;

    for (let i = 0; i < MAX; i++) {
      const d = evaluateRuntimeRequest({
        lifecycleState: READY_STATE, admissionState: admission,
        resourceObservation: obs, resourceLimits: limits,
      });
      assert.equal(d.ok, true, `request ${i + 1} should be admitted`);
      admission = recordInFlight(admission);
    }

    // 101st hits AT_CAPACITY
    const over = evaluateRuntimeRequest({
      lifecycleState: READY_STATE, admissionState: admission,
      resourceObservation: obs, resourceLimits: limits,
    });
    assert.equal(over.ok, false);
    assert.equal(over.reason, RUNTIME_MANAGER_REASONS.AT_CAPACITY);
    assert.equal(admission.inFlight, MAX); // exact bound
  });

  it('QUEUE_FULL trips at exact queueBound', () => {
    const MAX_FLIGHT = 2;
    const QUEUE = 10;
    let admission = createAdmissionState({ maxInFlight: MAX_FLIGHT, queueBound: QUEUE });

    // Fill in-flight
    for (let i = 0; i < MAX_FLIGHT; i++) admission = recordInFlight(admission);
    // Fill queue
    for (let i = 0; i < QUEUE; i++) admission = { ...admission, queued: admission.queued + 1 };

    const r = evaluateAdmission(admission);
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.QUEUE_FULL);
    assert.equal(admission.inFlight, MAX_FLIGHT);
    assert.equal(admission.queued, QUEUE);
  });
});

// ── Stress: 50k admission evaluations ────────────────────────────────────────

describe('stress: 50k admission evaluations — no state corruption', () => {
  it('evaluateAdmission gives consistent ok:true when under limit for 50000 calls', () => {
    const admission = createAdmissionState({ maxInFlight: 10, queueBound: 20 });
    const underLimit = { ...admission, inFlight: 5 };

    for (let i = 0; i < 50_000; i++) {
      const r = evaluateAdmission(underLimit);
      assert.equal(r.ok, true, `failed at iteration ${i}`);
    }
    // Original unchanged (pure)
    assert.equal(underLimit.inFlight, 5);
  });
});

// ── Stress: integrity accumulator — 1000 chunks ─────────────────────────────

describe('stress: integrity accumulator with 1000 chunks', () => {
  it('correctly verifies 100 KB model data split into 1000 chunks of 100 bytes each', () => {
    const CHUNK_SIZE = 100;
    const NUM_CHUNKS = 1000;
    const data = crypto.randomBytes(CHUNK_SIZE * NUM_CHUNKS);
    const digest = makeDigest(data);

    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: data.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });

    for (let i = 0; i < NUM_CHUNKS; i++) {
      acc.update(data.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }

    assert.equal(acc.getReceivedBytes(), data.length);
    const verdict = acc.finalize();
    assert.equal(verdict.ok, true, `integrity failed: ${verdict.reason}`);
  });

  it('detects 1-byte corruption in 100KB data', () => {
    const data = crypto.randomBytes(100_000);
    const digest = makeDigest(data);

    // Corrupt 1 byte
    const corrupted = Buffer.from(data);
    corrupted[50_000] ^= 0xff;

    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: corrupted.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    acc.update(corrupted);
    const verdict = acc.finalize();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });
});

// ── Stress: evaluateResourceLimits under varied inputs ───────────────────────

describe('stress: resource limit evaluation 20k calls', () => {
  it('consistently returns correct verdicts for boundary values', () => {
    const limits = VALID_LIMITS;

    // Exactly at limit → ok
    const atLimit = { ramBytes: limits.maxRamBytes, vramBytes: limits.maxVramBytes, cpuPercent: limits.maxCpuPercent };
    for (let i = 0; i < 20_000; i++) {
      const r = evaluateResourceLimits(atLimit, limits);
      assert.equal(r.ok, true, `failed at iteration ${i}`);
    }

    // One byte over RAM → always fail
    const overRam = { ...atLimit, ramBytes: limits.maxRamBytes + 1 };
    for (let i = 0; i < 20_000; i++) {
      const r = evaluateResourceLimits(overRam, limits);
      assert.equal(r.ok, false, `should fail at iteration ${i}`);
      assert.equal(r.reason, RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT);
    }
  });
});

// ── Stress: evaluateRuntimeRequest — 10k combined gate evaluations ────────────

describe('stress: evaluateRuntimeRequest 10k calls', () => {
  it('all green — consistent ok:true', () => {
    const admission = createAdmissionState({ maxInFlight: 100, queueBound: 200 });

    for (let i = 0; i < 10_000; i++) {
      const r = evaluateRuntimeRequest({
        lifecycleState: READY_STATE,
        admissionState: admission,
        resourceObservation: VALID_OBS,
        resourceLimits: VALID_LIMITS,
      });
      assert.equal(r.ok, true, `failed at iteration ${i}`);
    }
  });

  it('all red — NOT_READY when not ready for 10k calls', () => {
    const stopped = createLifecycleState();
    const admission = createAdmissionState({ maxInFlight: 100, queueBound: 200 });

    for (let i = 0; i < 10_000; i++) {
      const r = evaluateRuntimeRequest({
        lifecycleState: stopped,
        admissionState: admission,
        resourceObservation: VALID_OBS,
        resourceLimits: VALID_LIMITS,
      });
      assert.equal(r.ok, false, `should fail at ${i}`);
      assert.equal(r.reason, RUNTIME_MANAGER_REASONS.NOT_READY);
    }
  });
});
