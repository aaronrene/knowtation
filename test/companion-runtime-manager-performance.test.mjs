/**
 * Tier 6 — PERFORMANCE: lib/companion-runtime-manager.mjs
 *
 * Latency bounds for all decision functions. The runtime manager sits on the hot path
 * for every inference request. Decisions must complete in sub-millisecond time to avoid
 * adding measurable overhead to inference throughput.
 *
 * Bounds (conservative; well within what node:crypto + pure-JS can deliver):
 *   - Per-decision calls (evaluateRuntimeRequest, evaluateAdmission, etc.): mean < 0.1ms
 *   - 10k evaluateRuntimeRequest calls: total < 500ms
 *   - 10k lifecycle transitions: total < 200ms
 *   - Integrity accumulator: 100KB with 1-byte chunks: total < 500ms
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md §4 (backpressure).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  LIFECYCLE_STATES,
  LIFECYCLE_EVENTS,
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
  createIntegrityAccumulator,
  verifyModelBytes,
  validateSourceUrl,
} from '../lib/companion-runtime-manager.mjs';

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.gguf';
const READY = { state: LIFECYCLE_STATES.READY };
const VALID_LIMITS = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
const VALID_OBS = { ramBytes: 1e9, vramBytes: 0.5e9, cpuPercent: 10 };
const VALID_ADMISSION = createAdmissionState({ maxInFlight: 100, queueBound: 200 });

// ── evaluateRuntimeRequest ────────────────────────────────────────────────────

describe('performance: evaluateRuntimeRequest', () => {
  it('10k calls complete in < 500ms', () => {
    const N = 10_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      evaluateRuntimeRequest({
        lifecycleState: READY,
        admissionState: VALID_ADMISSION,
        resourceObservation: VALID_OBS,
        resourceLimits: VALID_LIMITS,
      });
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 500, `10k evaluateRuntimeRequest took ${elapsed.toFixed(1)}ms, expected < 500ms`);
  });

  it('mean per-call < 0.05ms (50μs)', () => {
    const N = 10_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      evaluateRuntimeRequest({
        lifecycleState: READY,
        admissionState: VALID_ADMISSION,
        resourceObservation: VALID_OBS,
        resourceLimits: VALID_LIMITS,
      });
    }
    const mean = (performance.now() - start) / N;
    assert.ok(mean < 0.05, `mean per-call ${mean.toFixed(4)}ms, expected < 0.05ms`);
  });
});

// ── evaluateAdmission ─────────────────────────────────────────────────────────

describe('performance: evaluateAdmission', () => {
  it('50k calls complete in < 500ms', () => {
    const N = 50_000;
    const s = { ...VALID_ADMISSION, inFlight: 1 };
    const start = performance.now();
    for (let i = 0; i < N; i++) evaluateAdmission(s);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 500, `50k evaluateAdmission took ${elapsed.toFixed(1)}ms, expected < 500ms`);
  });
});

// ── evaluateResourceLimits ────────────────────────────────────────────────────

describe('performance: evaluateResourceLimits', () => {
  it('50k calls complete in < 300ms', () => {
    const N = 50_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) evaluateResourceLimits(VALID_OBS, VALID_LIMITS);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 300, `50k evaluateResourceLimits took ${elapsed.toFixed(1)}ms, expected < 300ms`);
  });
});

// ── Lifecycle transitions ────────────────────────────────────────────────────

describe('performance: lifecycle transitions', () => {
  it('10k full round-trips (stopped→starting→ready→drain→stopped) < 200ms', () => {
    const N = 10_000;
    let lifecycle = createLifecycleState();
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_OK).newState;
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.DRAIN).newState;
      lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.STOPPED).newState;
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 200, `10k lifecycle round-trips took ${elapsed.toFixed(1)}ms, expected < 200ms`);
  });

  it('canServeInference: 100k calls < 100ms', () => {
    const N = 100_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) canServeInference(READY);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `100k canServeInference took ${elapsed.toFixed(1)}ms, expected < 100ms`);
  });
});

// ── Integrity accumulator ────────────────────────────────────────────────────

describe('performance: integrity accumulator', () => {
  it('100KB model data in 1-byte chunks completes in < 500ms', () => {
    const data = crypto.randomBytes(100_000);
    const digest = makeDigest(data);

    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: data.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });

    const start = performance.now();
    for (let i = 0; i < data.length; i++) {
      acc.update(data.subarray(i, i + 1));
    }
    acc.finalize();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 500, `100KB 1-byte-chunk accumulation took ${elapsed.toFixed(1)}ms, expected < 500ms`);
  });

  it('1MB model data in 4KB chunks completes in < 200ms', () => {
    const CHUNK = 4096;
    const data = crypto.randomBytes(1024 * 1024);
    const digest = makeDigest(data);

    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: data.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });

    const start = performance.now();
    for (let i = 0; i < data.length; i += CHUNK) {
      acc.update(data.subarray(i, i + CHUNK));
    }
    acc.finalize();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 200, `1MB 4KB-chunk accumulation took ${elapsed.toFixed(1)}ms, expected < 200ms`);
  });
});

// ── verifyModelBytes ─────────────────────────────────────────────────────────

describe('performance: verifyModelBytes', () => {
  it('1000 calls on a 1KB buffer complete in < 300ms', () => {
    const data = crypto.randomBytes(1024);
    const digest = makeDigest(data);
    const N = 1000;

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      verifyModelBytes({
        fileData: data, expectedDigest: digest, expectedSizeBytes: data.length,
        sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
      });
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 300, `1000 verifyModelBytes took ${elapsed.toFixed(1)}ms, expected < 300ms`);
  });
});

// ── validateSourceUrl (hot path for spec validation) ────────────────────────

describe('performance: validateSourceUrl', () => {
  it('100k calls complete in < 500ms', () => {
    const N = 100_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) validateSourceUrl(VALID_URL, ALLOWED_URLS);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 500, `100k validateSourceUrl took ${elapsed.toFixed(1)}ms, expected < 500ms`);
  });
});

// ── Admission record cycling ──────────────────────────────────────────────────

describe('performance: recordInFlight/recordCompletion cycling', () => {
  it('10k recordInFlight + recordCompletion pairs < 100ms', () => {
    const N = 10_000;
    let s = createAdmissionState({ maxInFlight: N + 1, queueBound: N + 1 });
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      s = recordInFlight(s);
      s = recordCompletion(s);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `10k in-flight cycles took ${elapsed.toFixed(1)}ms, expected < 100ms`);
    assert.equal(s.inFlight, 0); // net zero
  });
});
