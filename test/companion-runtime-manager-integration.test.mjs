/**
 * Tier 2 — INTEGRATION: lib/companion-runtime-manager.mjs
 *
 * Combined flows through multiple functions — integrity → lifecycle → admission → resource.
 * Tests the interactions between sub-systems, ensuring the composition of pure functions
 * produces the correct combined behaviour across realistic call sequences.
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md §3 (lifecycle), §4 (backpressure).
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

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.gguf';

// ── Integration: integrity → lifecycle cold-start sequence ──────────────────

describe('integrity verification → lifecycle cold-start success', () => {
  it('full happy path: verify → start → health_ok → ready → serve', () => {
    // Phase 5 will call this sequence. We simulate it purely.
    const modelData = Buffer.from('simulated model binary data for integration test');
    const digest = makeDigest(modelData);

    // 1. Verify model integrity (simulated Phase 5 streaming download)
    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: modelData.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    // Simulate chunked download
    const chunkSize = 8;
    for (let i = 0; i < modelData.length; i += chunkSize) {
      acc.update(modelData.subarray(i, i + chunkSize));
    }
    const integrityVerdict = acc.finalize();
    assert.equal(integrityVerdict.ok, true, 'integrity must pass before lifecycle proceeds');

    // 2. Only after integrity passes, transition lifecycle
    let lifecycle = createLifecycleState();
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);

    let tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START);
    assert.equal(tr.ok, true);
    lifecycle = tr.newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTING);

    // Simulate health-check pass (Phase 5 health probe succeeds)
    tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_OK);
    assert.equal(tr.ok, true);
    lifecycle = tr.newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.READY);

    // 3. Now admission and resource checks
    const admission = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const limits = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
    const obs = { ramBytes: 1e9, vramBytes: 0.5e9, cpuPercent: 10 };

    const decision = evaluateRuntimeRequest({
      lifecycleState: lifecycle, admissionState: admission,
      resourceObservation: obs, resourceLimits: limits,
    });
    assert.equal(decision.ok, true);
  });
});

describe('integrity failure → lifecycle stays stopped', () => {
  it('wrong digest prevents lifecycle start (Phase 5 must not call start on fail)', () => {
    const modelData = Buffer.from('good model data');
    const wrongDigest = '0'.repeat(64);

    const r = verifyModelBytes({
      fileData: modelData, expectedDigest: wrongDigest,
      expectedSizeBytes: modelData.length, sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);

    // Phase 5 MUST NOT call transitionLifecycle(START) when integrity fails.
    // The lifecycle stays in stopped — no way to reach ready without integrity passing.
    const lifecycle = createLifecycleState();
    assert.equal(canServeInference(lifecycle), false);
  });
});

// ── Integration: cold-start failure path ────────────────────────────────────

describe('cold-start failure: starting → stopped on health_fail', () => {
  it('health_fail returns lifecycle to stopped, inference still denied', () => {
    let lifecycle = createLifecycleState();

    let tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START);
    lifecycle = tr.newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STARTING);
    assert.equal(canServeInference(lifecycle), false); // cannot serve while starting

    tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_FAIL);
    lifecycle = tr.newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
    assert.equal(canServeInference(lifecycle), false);
  });

  it('can restart after health_fail (stopped → starting again)', () => {
    let lifecycle = createLifecycleState();
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_FAIL).newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);

    // Can start again
    const tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START);
    assert.equal(tr.ok, true);
    assert.equal(tr.newState.state, LIFECYCLE_STATES.STARTING);
  });
});

// ── Integration: graceful drain sequence ────────────────────────────────────

describe('graceful drain: ready → draining → stopped', () => {
  it('inference denied in draining state', () => {
    let lifecycle = createLifecycleState();
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_OK).newState;
    assert.equal(canServeInference(lifecycle), true);

    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.DRAIN).newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.DRAINING);
    assert.equal(canServeInference(lifecycle), false); // no new requests during drain

    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.STOPPED).newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
    assert.equal(canServeInference(lifecycle), false);
  });
});

// ── Integration: admission state cycling ────────────────────────────────────

describe('admission cycling with recordInFlight/recordCompletion', () => {
  it('inFlight returns to 0 after all completions', () => {
    let s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });

    s = recordInFlight(s);
    s = recordInFlight(s);
    s = recordInFlight(s);
    assert.equal(s.inFlight, 3);

    s = recordCompletion(s);
    s = recordCompletion(s);
    s = recordCompletion(s);
    assert.equal(s.inFlight, 0);
  });

  it('admission allows again after completion brings inFlight below max', () => {
    let s = createAdmissionState({ maxInFlight: 2, queueBound: 4 });

    s = recordInFlight(s);
    s = recordInFlight(s);
    assert.equal(evaluateAdmission(s).reason, RUNTIME_MANAGER_REASONS.AT_CAPACITY);

    s = recordCompletion(s);
    assert.equal(evaluateAdmission(s).ok, true);
  });

  it('queue tracking does not affect inFlight', () => {
    let s = createAdmissionState({ maxInFlight: 2, queueBound: 4 });
    s = recordInFlight(s);
    s = recordQueued(s);
    s = recordQueued(s);
    assert.equal(s.inFlight, 1);
    assert.equal(s.queued, 2);
    s = recordDequeued(s);
    assert.equal(s.queued, 1);
    assert.equal(s.inFlight, 1); // unchanged
  });
});

// ── Integration: resource + admission combined ───────────────────────────────

describe('resource limits integrated with admission decision', () => {
  it('resource over-limit while in-flight slots free → resource gate fails', () => {
    const lifecycle = { state: LIFECYCLE_STATES.READY };
    const admission = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const limits = createResourceLimits({ maxRamBytes: 4e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
    const obs = { ramBytes: 5e9, vramBytes: 0, cpuPercent: 20 }; // RAM over

    const r = evaluateRuntimeRequest({
      lifecycleState: lifecycle, admissionState: admission,
      resourceObservation: obs, resourceLimits: limits,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT);
  });

  it('resource within limits + admission within limits + ready → ok', () => {
    const lifecycle = { state: LIFECYCLE_STATES.READY };
    const admission = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const limits = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
    const obs = { ramBytes: 1e9, vramBytes: 0, cpuPercent: 20 };

    const r = evaluateRuntimeRequest({
      lifecycleState: lifecycle, admissionState: admission,
      resourceObservation: obs, resourceLimits: limits,
    });
    assert.equal(r.ok, true);
  });
});

// ── Integration: streaming integrity accumulator ─────────────────────────────

describe('streaming integrity accumulator with many small chunks', () => {
  it('matches single-shot verifyModelBytes for identical data', () => {
    const data = Buffer.alloc(1024, 0xab); // 1 KB of known bytes
    const digest = makeDigest(data);

    // Streaming path (accumulator)
    const acc = createIntegrityAccumulator({
      expectedDigest: digest, expectedSizeBytes: data.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });
    for (let i = 0; i < data.length; i++) {
      acc.update(data.subarray(i, i + 1)); // 1 byte at a time
    }
    const streamingVerdict = acc.finalize();

    // In-memory path
    const memoryVerdict = verifyModelBytes({
      fileData: data, expectedDigest: digest, expectedSizeBytes: data.length,
      sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
    });

    assert.equal(streamingVerdict.ok, true);
    assert.equal(memoryVerdict.ok, true);
  });
});
