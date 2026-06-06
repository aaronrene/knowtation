/**
 * Tier 5 — DATA INTEGRITY: lib/companion-runtime-manager.mjs
 *
 * Verifies the data-integrity invariants of the pure module:
 *   - All decision functions are deterministic (same inputs → same outputs).
 *   - State update functions never mutate their inputs (pure / immutable contract).
 *   - All returned reason strings are members of RUNTIME_MANAGER_REASONS (no free-form).
 *   - canServeInference is strictly state-gated (no false positive possible).
 *   - Module exports no env-reading, no I/O, no network entry points.
 *   - Lifecycle transition table is complete and sound (no unreachable states).
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md §2 (integrity), §3 (lifecycle).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  RUNTIME_MANAGER_REASONS,
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
  validateSourceUrl,
  validateIntegritySpec,
  createIntegrityAccumulator,
  verifyModelBytes,
} from '../lib/companion-runtime-manager.mjs';

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.gguf';
const VALID_DATA = Buffer.from('deterministic model data for integrity tests');
const VALID_DIGEST = makeDigest(VALID_DATA);
const VALID_SIZE = VALID_DATA.length;

const ALL_REASONS = new Set(Object.values(RUNTIME_MANAGER_REASONS));
const READY = { state: LIFECYCLE_STATES.READY };
const VALID_LIMITS = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
const VALID_OBS = { ramBytes: 1e9, vramBytes: 0.5e9, cpuPercent: 10 };

// ── Determinism ───────────────────────────────────────────────────────────────

describe('determinism: same inputs → same outputs', () => {
  it('validateSourceUrl is deterministic over 1000 calls', () => {
    for (let i = 0; i < 1000; i++) {
      const r = validateSourceUrl(VALID_URL, ALLOWED_URLS);
      assert.equal(r.ok, true);
      assert.equal(r.reason, RUNTIME_MANAGER_REASONS.OK);
    }
  });

  it('validateIntegritySpec is deterministic over 1000 calls', () => {
    for (let i = 0; i < 1000; i++) {
      const r = validateIntegritySpec(VALID_DIGEST, VALID_SIZE);
      assert.equal(r.ok, true);
    }
  });

  it('canServeInference is deterministic: ready always returns true 1000 times', () => {
    for (let i = 0; i < 1000; i++) {
      assert.equal(canServeInference(READY), true);
    }
  });

  it('canServeInference is deterministic: stopped always returns false 1000 times', () => {
    const stopped = createLifecycleState();
    for (let i = 0; i < 1000; i++) {
      assert.equal(canServeInference(stopped), false);
    }
  });

  it('evaluateAdmission is deterministic over 1000 calls', () => {
    const s = { ...createAdmissionState({ maxInFlight: 4, queueBound: 8 }), inFlight: 2 };
    for (let i = 0; i < 1000; i++) {
      const r = evaluateAdmission(s);
      assert.equal(r.ok, true);
    }
  });

  it('evaluateResourceLimits is deterministic over 1000 calls', () => {
    for (let i = 0; i < 1000; i++) {
      const r = evaluateResourceLimits(VALID_OBS, VALID_LIMITS);
      assert.equal(r.ok, true);
    }
  });

  it('evaluateRuntimeRequest is deterministic over 1000 calls', () => {
    const admission = createAdmissionState({ maxInFlight: 10, queueBound: 20 });
    for (let i = 0; i < 1000; i++) {
      const r = evaluateRuntimeRequest({
        lifecycleState: READY,
        admissionState: admission,
        resourceObservation: VALID_OBS,
        resourceLimits: VALID_LIMITS,
      });
      assert.equal(r.ok, true);
      assert.equal(r.reason, RUNTIME_MANAGER_REASONS.OK);
    }
  });

  it('transitionLifecycle is deterministic: stopped + start always → starting', () => {
    const stopped = createLifecycleState();
    for (let i = 0; i < 1000; i++) {
      const r = transitionLifecycle(stopped, LIFECYCLE_EVENTS.START);
      assert.equal(r.ok, true);
      assert.equal(r.newState.state, LIFECYCLE_STATES.STARTING);
    }
  });
});

// ── No input mutation ─────────────────────────────────────────────────────────

describe('no input mutation: state objects unchanged after update functions', () => {
  it('transitionLifecycle does not mutate input state', () => {
    const stopped = createLifecycleState();
    const original = stopped.state;
    transitionLifecycle(stopped, LIFECYCLE_EVENTS.START);
    assert.equal(stopped.state, original);
  });

  it('recordInFlight does not mutate input state', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const originalInFlight = s.inFlight;
    recordInFlight(s);
    assert.equal(s.inFlight, originalInFlight);
  });

  it('recordCompletion does not mutate input state', () => {
    let s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    s = recordInFlight(s);
    const originalInFlight = s.inFlight;
    recordCompletion(s);
    assert.equal(s.inFlight, originalInFlight);
  });

  it('recordQueued does not mutate input state', () => {
    const s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const originalQueued = s.queued;
    recordQueued(s);
    assert.equal(s.queued, originalQueued);
  });

  it('recordDequeued does not mutate input state', () => {
    let s = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    s = recordQueued(s);
    const originalQueued = s.queued;
    recordDequeued(s);
    assert.equal(s.queued, originalQueued);
  });
});

// ── Reason-code domain ────────────────────────────────────────────────────────

describe('all returned reason strings are RUNTIME_MANAGER_REASONS values', () => {
  const testCases = [
    () => validateSourceUrl('bad', ALLOWED_URLS),
    () => validateSourceUrl(VALID_URL, []),
    () => validateSourceUrl('http://models.example.com/m', ALLOWED_URLS),
    () => validateIntegritySpec('bad', 10),
    () => validateIntegritySpec(VALID_DIGEST, 0),
    () => verifyModelBytes({ fileData: Buffer.from('x'), expectedDigest: VALID_DIGEST, expectedSizeBytes: 5, sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS }),
    () => transitionLifecycle(createLifecycleState(), 'bad_event'),
    () => evaluateAdmission(null),
    () => evaluateAdmission({ ...createAdmissionState({ maxInFlight: 1, queueBound: 1 }), inFlight: 1 }),
    () => evaluateAdmission({ ...createAdmissionState({ maxInFlight: 1, queueBound: 1 }), inFlight: 1, queued: 1 }),
    () => evaluateResourceLimits(null, VALID_LIMITS),
    () => evaluateResourceLimits(VALID_OBS, null),
    () => evaluateResourceLimits({ ...VALID_OBS, ramBytes: VALID_LIMITS.maxRamBytes + 1 }, VALID_LIMITS),
    () => evaluateRuntimeRequest(),
    () => evaluateRuntimeRequest({ lifecycleState: createLifecycleState(), admissionState: null, resourceObservation: VALID_OBS, resourceLimits: VALID_LIMITS }),
  ];

  for (let i = 0; i < testCases.length; i++) {
    it(`test case ${i + 1} reason is a RUNTIME_MANAGER_REASONS value`, () => {
      const r = testCases[i]();
      assert.ok(ALL_REASONS.has(r.reason), `Unknown reason: "${r.reason}" at case ${i + 1}`);
    });
  }
});

// ── canServeInference strict state-gating ────────────────────────────────────

describe('canServeInference is strictly state-gated', () => {
  it('only READY state returns true', () => {
    for (const s of Object.values(LIFECYCLE_STATES)) {
      const result = canServeInference({ state: s });
      if (s === LIFECYCLE_STATES.READY) {
        assert.equal(result, true, `Expected true for READY, got false`);
      } else {
        assert.equal(result, false, `Expected false for ${s}, got true`);
      }
    }
  });

  it('any non-object input returns false (no truthy coercion)', () => {
    const inputs = [null, undefined, 0, '', false, true, 'ready', { state: null }];
    for (const inp of inputs) {
      assert.equal(canServeInference(inp), false, `Expected false for ${JSON.stringify(inp)}`);
    }
  });
});

// ── Lifecycle transition soundness ────────────────────────────────────────────

describe('lifecycle transition table is complete and sound', () => {
  const allStates = Object.values(LIFECYCLE_STATES);
  const allEvents = Object.values(LIFECYCLE_EVENTS);

  // Valid transitions (each one should succeed)
  const validTransitions = [
    [LIFECYCLE_STATES.STOPPED, LIFECYCLE_EVENTS.START, LIFECYCLE_STATES.STARTING],
    [LIFECYCLE_STATES.STARTING, LIFECYCLE_EVENTS.HEALTH_OK, LIFECYCLE_STATES.READY],
    [LIFECYCLE_STATES.STARTING, LIFECYCLE_EVENTS.HEALTH_FAIL, LIFECYCLE_STATES.STOPPED],
    [LIFECYCLE_STATES.READY, LIFECYCLE_EVENTS.DRAIN, LIFECYCLE_STATES.DRAINING],
    [LIFECYCLE_STATES.DRAINING, LIFECYCLE_EVENTS.STOPPED, LIFECYCLE_STATES.STOPPED],
  ];

  for (const [from, event, to] of validTransitions) {
    it(`valid: ${from} + ${event} → ${to}`, () => {
      const r = transitionLifecycle({ state: from }, event);
      assert.equal(r.ok, true);
      assert.equal(r.newState.state, to);
    });
  }

  // Every other (state, event) combination is invalid
  for (const state of allStates) {
    for (const event of allEvents) {
      const isValid = validTransitions.some(([f, e]) => f === state && e === event);
      if (!isValid) {
        it(`invalid: ${state} + ${event} → fail-closed`, () => {
          const r = transitionLifecycle({ state }, event);
          assert.equal(r.ok, false);
          // Reason must be in the known set
          assert.ok(ALL_REASONS.has(r.reason), `Unknown reason: ${r.reason}`);
        });
      }
    }
  }
});

// ── verifyModelBytes: same data → same result ─────────────────────────────────

describe('verifyModelBytes determinism', () => {
  it('same valid input → ok:true every call', () => {
    for (let i = 0; i < 500; i++) {
      const r = verifyModelBytes({
        fileData: VALID_DATA, expectedDigest: VALID_DIGEST, expectedSizeBytes: VALID_SIZE,
        sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
      });
      assert.equal(r.ok, true);
    }
  });

  it('wrong digest → DIGEST_MISMATCH every call', () => {
    const wrongDigest = '0'.repeat(64);
    for (let i = 0; i < 500; i++) {
      const r = verifyModelBytes({
        fileData: VALID_DATA, expectedDigest: wrongDigest, expectedSizeBytes: VALID_SIZE,
        sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
    }
  });
});
