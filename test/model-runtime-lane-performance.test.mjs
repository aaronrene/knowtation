/**
 * Tier 6 — PERFORMANCE: model-runtime-lane timing bounds
 *
 * Verifies that the pure selection and policy functions complete within
 * acceptable wall-clock bounds for high-frequency call sites (adapter hot path).
 *
 * Because the functions are pure/synchronous, the bounds are deliberately generous
 * to avoid flakiness on loaded CI runners while still catching pathological regressions
 * (e.g. inadvertent I/O or O(n²) internal logic).
 *
 * Reference: docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §1 (no I/O constraint)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
} from '../lib/model-runtime-lane.mjs';

const RUNS = 10_000;
/** Maximum allowed milliseconds per batch of RUNS calls (very generous). */
const MAX_MS_BATCH = 200;
/** Maximum allowed average microseconds per single call. */
const MAX_US_PER_CALL = 10;

describe('Performance — selectLane', () => {
  it(`${RUNS} calls complete in < ${MAX_MS_BATCH}ms`, () => {
    const caps = { inBrowserAvailable: true, managedKeyAvailable: true };
    const prefs = {};
    const start = performance.now();
    for (let i = 0; i < RUNS; i++) selectLane(caps, prefs);
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < MAX_MS_BATCH,
      `selectLane: ${RUNS} calls took ${elapsed.toFixed(1)}ms — exceeded ${MAX_MS_BATCH}ms`,
    );
  });

  it(`average per-call time is below ${MAX_US_PER_CALL}µs`, () => {
    const caps = { managedKeyAvailable: true };
    const prefs = { orgPrivacyMode: false };
    const start = performance.now();
    for (let i = 0; i < RUNS; i++) selectLane(caps, prefs);
    const avgUs = ((performance.now() - start) / RUNS) * 1000;
    assert.ok(
      avgUs < MAX_US_PER_CALL,
      `selectLane avg ${avgUs.toFixed(2)}µs/call — exceeded ${MAX_US_PER_CALL}µs`,
    );
  });
});

describe('Performance — isManagedLane', () => {
  it(`${RUNS} calls to isManagedLane complete in < ${MAX_MS_BATCH}ms`, () => {
    const start = performance.now();
    for (let i = 0; i < RUNS; i++) isManagedLane(i % 2 === 0 ? 'direct_provider' : 'local');
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < MAX_MS_BATCH,
      `isManagedLane: ${RUNS} calls took ${elapsed.toFixed(1)}ms`,
    );
  });
});

describe('Performance — enforceConsentPolicy', () => {
  it(`${RUNS} calls to enforceConsentPolicy complete in < ${MAX_MS_BATCH}ms`, () => {
    const params = {
      lane: 'direct_provider',
      containsPrivateData: true,
      consentId: undefined,
      isDelegate: false,
      delegatedManagedAllowed: false,
    };
    const start = performance.now();
    for (let i = 0; i < RUNS; i++) enforceConsentPolicy(params);
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < MAX_MS_BATCH,
      `enforceConsentPolicy: ${RUNS} calls took ${elapsed.toFixed(1)}ms`,
    );
  });
});

describe('Performance — full pipeline (selectLane → isManagedLane → enforceConsentPolicy)', () => {
  it(`${RUNS} full pipeline invocations complete in < ${MAX_MS_BATCH * 2}ms`, () => {
    const caps = { managedKeyAvailable: true };
    const prefs = {};
    const start = performance.now();
    for (let i = 0; i < RUNS; i++) {
      const lane = selectLane(caps, prefs);
      isManagedLane(lane);
      enforceConsentPolicy({
        lane,
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: false,
        delegatedManagedAllowed: false,
      });
    }
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < MAX_MS_BATCH * 2,
      `full pipeline: ${RUNS} calls took ${elapsed.toFixed(1)}ms`,
    );
  });
});
