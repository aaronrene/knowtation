/**
 * Tier 4 — STRESS: model-runtime-lane high-volume and concurrent invocation
 *
 * Verifies that the pure functions remain stable, deterministic, and non-mutating
 * under high call volume and concurrent (Promise-parallel) invocations. Because
 * the functions are synchronous and pure, the stress target is the JS call stack and
 * object creation/GC pressure, not network throughput.
 *
 * Reference: docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §5 (determinism invariant)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
} from '../lib/model-runtime-lane.mjs';

const ITERATIONS = 10_000;

describe('Stress — selectLane', () => {
  it(`runs ${ITERATIONS} times with alternating capability sets without throwing`, () => {
    const capsSets = [
      { inBrowserAvailable: true },
      { companionAvailable: true },
      { managedKeyAvailable: true },
      { openrouterKeyAvailable: true },
      {},
      { selfHostedAvailable: true },
    ];
    const prefsSets = [
      {},
      { orgPrivacyMode: true },
      { keepOnDevice: true },
      { isDelegate: true, delegatedManagedAllowed: false },
    ];
    for (let i = 0; i < ITERATIONS; i++) {
      const caps = capsSets[i % capsSets.length];
      const prefs = prefsSets[i % prefsSets.length];
      const lane = selectLane(caps, prefs);
      assert.ok(
        ['local', 'self_hosted', 'enterprise', 'openrouter', 'direct_provider', 'disabled'].includes(lane),
        `unexpected lane: ${lane}`,
      );
    }
  });

  it('does not mutate the input capabilities object across many calls', () => {
    const caps = { inBrowserAvailable: true, managedKeyAvailable: true };
    const frozen = JSON.stringify(caps);
    for (let i = 0; i < ITERATIONS; i++) selectLane(caps, {});
    assert.equal(JSON.stringify(caps), frozen, 'capabilities object was mutated');
  });

  it('does not mutate the input preferences object across many calls', () => {
    const prefs = { keepOnDevice: true };
    const frozen = JSON.stringify(prefs);
    for (let i = 0; i < ITERATIONS; i++) selectLane({}, prefs);
    assert.equal(JSON.stringify(prefs), frozen, 'preferences object was mutated');
  });
});

describe('Stress — isManagedLane', () => {
  const lanes = ['local', 'self_hosted', 'enterprise', 'openrouter', 'direct_provider', 'disabled'];

  it(`returns consistent results over ${ITERATIONS} calls per lane`, () => {
    for (const lane of lanes) {
      const expected = lane === 'direct_provider';
      for (let i = 0; i < ITERATIONS; i++) {
        assert.equal(isManagedLane(lane), expected);
      }
    }
  });
});

describe('Stress — enforceConsentPolicy', () => {
  it(`handles ${ITERATIONS} interleaved policy evaluations without state leakage`, () => {
    const cases = [
      { lane: 'direct_provider', containsPrivateData: false, consentId: undefined, isDelegate: false, delegatedManagedAllowed: false, expected: 'allow' },
      { lane: 'direct_provider', containsPrivateData: true, consentId: undefined, isDelegate: false, delegatedManagedAllowed: false, expected: 'cloud_consent_required' },
      { lane: 'direct_provider', containsPrivateData: true, consentId: 'cid', isDelegate: false, delegatedManagedAllowed: false, expected: 'allow' },
      { lane: 'direct_provider', containsPrivateData: false, consentId: undefined, isDelegate: true, delegatedManagedAllowed: false, expected: 'lane_policy_denied' },
      { lane: 'local', containsPrivateData: true, consentId: undefined, isDelegate: true, delegatedManagedAllowed: false, expected: 'allow' },
    ];
    for (let i = 0; i < ITERATIONS; i++) {
      const c = cases[i % cases.length];
      assert.equal(enforceConsentPolicy(c), c.expected);
    }
  });
});

describe('Stress — concurrent Promise.all invocation', () => {
  it('100 concurrent pipeline invocations complete correctly', async () => {
    const tasks = Array.from({ length: 100 }, (_, i) => {
      const hasLocal = i % 3 === 0;
      const isManaged = !hasLocal;
      return Promise.resolve().then(() => {
        const caps = hasLocal
          ? { inBrowserAvailable: true }
          : { managedKeyAvailable: true };
        const lane = selectLane(caps, {});
        const decision = enforceConsentPolicy({
          lane,
          containsPrivateData: true,
          consentId: undefined,
          isDelegate: false,
          delegatedManagedAllowed: false,
        });
        return { lane, decision, isManaged };
      });
    });
    const results = await Promise.all(tasks);
    for (const r of results) {
      assert.ok(
        ['local', 'direct_provider'].includes(r.lane),
        `unexpected lane: ${r.lane}`,
      );
      if (r.lane === 'local') assert.equal(r.decision, 'allow');
      if (r.lane === 'direct_provider') assert.equal(r.decision, 'cloud_consent_required');
    }
  });
});
