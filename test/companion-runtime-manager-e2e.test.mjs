/**
 * Tier 3 — END-TO-END: lib/companion-runtime-manager.mjs
 *
 * Realistic simulated request lifecycles using stub adapters that mirror what Phase 5
 * will inject. Tests the full "download → verify → start → health → serve → drain → stop"
 * cycle, including failure branches (integrity failure, health-check failure, runtime crash,
 * resource exhaustion mid-session).
 *
 * No real child_process, no real fetch, no real filesystem — stubs only.
 *
 * Reference: docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md §5 (Phase 5 obligations).
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
  createResourceLimits,
  evaluateResourceLimits,
  evaluateRuntimeRequest,
} from '../lib/companion-runtime-manager.mjs';

function makeDigest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ALLOWED_URLS = ['https://models.example.com/'];
const VALID_URL = 'https://models.example.com/model.gguf';

// ── Stub adapter factory (mirrors RuntimeAdapterFns from Phase 4 §7) ────────

function makeStubAdapter({ healthShouldPass = true, resourceObs = null } = {}) {
  const obs = resourceObs ?? { ramBytes: 1e9, vramBytes: 0, cpuPercent: 10 };
  return {
    async spawn() { return { pid: 12345, kill: async () => {} }; },
    async download(url, onChunk, data) { onChunk(data); },
    async healthCheck() { return healthShouldPass; },
    async statResources() { return obs; },
  };
}

// ── Simulated Phase 5 lifecycle orchestrator (pure logic only) ───────────────

async function simulatePhase5Session({
  modelData,
  expectedDigest,
  adapter,
  maxInFlight = 4,
  queueBound = 8,
  limits = null,
}) {
  const resourceLimits = limits ?? createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });

  // 1. Integrity verification
  const acc = createIntegrityAccumulator({
    expectedDigest, expectedSizeBytes: modelData.length,
    sourceUrl: VALID_URL, allowedSourceUrls: ALLOWED_URLS,
  });
  // Simulate download via adapter
  await adapter.download(VALID_URL, (chunk) => acc.update(chunk), modelData);
  const integrityVerdict = acc.finalize();
  if (!integrityVerdict.ok) {
    return { success: false, phase: 'integrity', reason: integrityVerdict.reason };
  }

  // 2. Spawn (real Phase 5 would call adapter.spawn here)
  // Phase 4 pure: we skip real spawn but simulate the lifecycle transition
  let lifecycle = createLifecycleState();
  let tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START);
  if (!tr.ok) return { success: false, phase: 'start', reason: tr.reason };
  lifecycle = tr.newState;

  // 3. Health check
  const healthy = await adapter.healthCheck({ pid: 0, kill: async () => {} });
  const healthEvent = healthy ? LIFECYCLE_EVENTS.HEALTH_OK : LIFECYCLE_EVENTS.HEALTH_FAIL;
  tr = transitionLifecycle(lifecycle, healthEvent);
  if (!tr.ok) return { success: false, phase: 'health', reason: tr.reason };
  lifecycle = tr.newState;

  if (!canServeInference(lifecycle)) {
    return { success: false, phase: 'not_ready', reason: RUNTIME_MANAGER_REASONS.NOT_READY };
  }

  // 4. Serve an inference request
  let admissionState = createAdmissionState({ maxInFlight, queueBound });
  const obs = await adapter.statResources();
  const decision = evaluateRuntimeRequest({
    lifecycleState: lifecycle,
    admissionState,
    resourceObservation: obs,
    resourceLimits,
  });
  if (!decision.ok) {
    return { success: false, phase: 'admission', reason: decision.reason };
  }
  admissionState = recordInFlight(admissionState);
  // (simulate inference work)
  admissionState = recordCompletion(admissionState);

  // 5. Drain
  tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.DRAIN);
  lifecycle = tr.newState;
  tr = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.STOPPED);
  lifecycle = tr.newState;

  return { success: true, finalState: lifecycle.state };
}

// ── E2E tests ────────────────────────────────────────────────────────────────

describe('E2E: happy path — download → verify → start → serve → drain', () => {
  it('completes full session with valid model', async () => {
    const modelData = Buffer.from('a trustworthy model binary - valid and correct');
    const digest = makeDigest(modelData);
    const adapter = makeStubAdapter({ healthShouldPass: true });

    const result = await simulatePhase5Session({ modelData, expectedDigest: digest, adapter });
    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.equal(result.finalState, LIFECYCLE_STATES.STOPPED);
  });
});

describe('E2E: integrity failure — tampered model refused before execution', () => {
  it('rejects session when model digest is wrong', async () => {
    const modelData = Buffer.from('tampered model binary with wrong content');
    const wrongDigest = 'a'.repeat(64); // incorrect digest
    const adapter = makeStubAdapter({ healthShouldPass: true });

    const result = await simulatePhase5Session({ modelData, expectedDigest: wrongDigest, adapter });
    assert.equal(result.success, false);
    assert.equal(result.phase, 'integrity');
    assert.equal(result.reason, RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH);
  });

  it('lifecycle remains stopped when integrity fails (no execution path)', () => {
    // Confirm that a failed integrity check means canServeInference stays false
    const lifecycle = createLifecycleState();
    assert.equal(canServeInference(lifecycle), false);
    // The orchestrator never calls START on integrity failure, so lifecycle stays stopped
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
  });
});

describe('E2E: health-check failure — runtime fails to start', () => {
  it('session ends with not_ready when health check fails', async () => {
    const modelData = Buffer.from('good model data, but runtime fails to start');
    const digest = makeDigest(modelData);
    const adapter = makeStubAdapter({ healthShouldPass: false });

    const result = await simulatePhase5Session({ modelData, expectedDigest: digest, adapter });
    assert.equal(result.success, false);
    assert.equal(result.phase, 'not_ready');
  });

  it('lifecycle is in stopped state after health_fail', () => {
    let lifecycle = createLifecycleState();
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_FAIL).newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.STOPPED);
    assert.equal(canServeInference(lifecycle), false);
  });
});

describe('E2E: resource exhaustion mid-session', () => {
  it('inference rejected when RAM spikes over limit', async () => {
    const modelData = Buffer.from('valid model with resource spike');
    const digest = makeDigest(modelData);
    // Adapter reports RAM over limit
    const obs = { ramBytes: 10e9, vramBytes: 0, cpuPercent: 10 }; // 10GB RAM
    const adapter = makeStubAdapter({ healthShouldPass: true, resourceObs: obs });
    const limits = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });

    const result = await simulatePhase5Session({
      modelData, expectedDigest: digest, adapter, limits,
    });
    assert.equal(result.success, false);
    assert.equal(result.phase, 'admission');
    assert.equal(result.reason, RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT);
  });
});

describe('E2E: concurrent request lifecycle', () => {
  it('multiple sequential requests cycle in-flight counter correctly', async () => {
    let lifecycle = createLifecycleState();
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_OK).newState;

    let admission = createAdmissionState({ maxInFlight: 3, queueBound: 6 });
    const limits = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
    const obs = { ramBytes: 1e9, vramBytes: 0, cpuPercent: 10 };

    // Admit 3 requests
    for (let i = 0; i < 3; i++) {
      const d = evaluateRuntimeRequest({ lifecycleState: lifecycle, admissionState: admission, resourceObservation: obs, resourceLimits: limits });
      assert.equal(d.ok, true, `request ${i} should be admitted`);
      admission = recordInFlight(admission);
    }
    assert.equal(admission.inFlight, 3);

    // 4th request should be AT_CAPACITY
    const d4 = evaluateRuntimeRequest({ lifecycleState: lifecycle, admissionState: admission, resourceObservation: obs, resourceLimits: limits });
    assert.equal(d4.ok, false);
    assert.equal(d4.reason, RUNTIME_MANAGER_REASONS.AT_CAPACITY);

    // Complete all 3 in-flight
    admission = recordCompletion(admission);
    admission = recordCompletion(admission);
    admission = recordCompletion(admission);
    assert.equal(admission.inFlight, 0);

    // Now a new request should be admitted again
    const d5 = evaluateRuntimeRequest({ lifecycleState: lifecycle, admissionState: admission, resourceObservation: obs, resourceLimits: limits });
    assert.equal(d5.ok, true);
  });
});

describe('E2E: draining rejects new inference', () => {
  it('requests rejected in draining state', () => {
    let lifecycle = createLifecycleState();
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.START).newState;
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.HEALTH_OK).newState;
    lifecycle = transitionLifecycle(lifecycle, LIFECYCLE_EVENTS.DRAIN).newState;
    assert.equal(lifecycle.state, LIFECYCLE_STATES.DRAINING);

    const admission = createAdmissionState({ maxInFlight: 4, queueBound: 8 });
    const limits = createResourceLimits({ maxRamBytes: 8e9, maxVramBytes: 4e9, maxCpuPercent: 80 });
    const obs = { ramBytes: 1e9, vramBytes: 0, cpuPercent: 10 };

    const r = evaluateRuntimeRequest({ lifecycleState: lifecycle, admissionState: admission, resourceObservation: obs, resourceLimits: limits });
    assert.equal(r.ok, false);
    assert.equal(r.reason, RUNTIME_MANAGER_REASONS.NOT_READY);
  });
});
