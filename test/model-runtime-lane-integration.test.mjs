/**
 * Tier 2 — INTEGRATION: model-runtime-lane pipeline
 *
 * Tests that selectLane and enforceConsentPolicy compose correctly into the
 * full "pick lane → check policy" pipeline that a concrete adapter will execute.
 * Tests realistic end-to-end scenarios (individual user, org, delegate, fallback chains)
 * without any network I/O.
 *
 * Reference: docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §1, §3
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
} from '../lib/model-runtime-lane.mjs';

/**
 * Simulates the pipeline a concrete KnowtationModelRuntimeAdapter will run:
 *   1. selectLane → determines the runtime lane
 *   2. isManagedLane → determines billing responsibility
 *   3. enforceConsentPolicy → determines whether to proceed
 *
 * @param {{ capabilities: object, preferences: object, containsPrivateData: boolean, consentId?: string }} params
 * @returns {{ lane: string, metered: boolean, decision: string }}
 */
function runPipeline({ capabilities, preferences, containsPrivateData, consentId }) {
  const lane = selectLane(capabilities, preferences);
  const metered = isManagedLane(lane);
  const decision = enforceConsentPolicy({
    lane,
    containsPrivateData,
    consentId,
    isDelegate: preferences.isDelegate ?? false,
    delegatedManagedAllowed: preferences.delegatedManagedAllowed ?? false,
  });
  return { lane, metered, decision };
}

describe('Integration — individual user with on-device compute', () => {
  it('in-browser: allow, not metered', () => {
    const result = runPipeline({
      capabilities: { inBrowserAvailable: true, managedKeyAvailable: true },
      preferences: {},
      containsPrivateData: true,
    });
    assert.equal(result.lane, 'local');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });

  it('companion: allow, not metered, even with private data and no consent', () => {
    const result = runPipeline({
      capabilities: { companionAvailable: true, managedKeyAvailable: true },
      preferences: {},
      containsPrivateData: true,
    });
    assert.equal(result.lane, 'local');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});

describe('Integration — individual user, no on-device compute, non-private data', () => {
  it('falls to managed: allow, metered', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: {},
      containsPrivateData: false,
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.metered, true);
    assert.equal(result.decision, 'allow');
  });
});

describe('Integration — individual user, managed lane, private data without consent', () => {
  it('consent required: metered but policy blocks', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: {},
      containsPrivateData: true,
      consentId: undefined,
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.metered, true);
    assert.equal(result.decision, 'cloud_consent_required');
  });

  it('allow after consent provided', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: {},
      containsPrivateData: true,
      consentId: 'cid-abc',
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.metered, true);
    assert.equal(result.decision, 'allow');
  });
});

describe('Integration — org privacy mode', () => {
  it('self-hosted: allow, not metered, private data no consent needed', () => {
    const result = runPipeline({
      capabilities: { selfHostedAvailable: true, managedKeyAvailable: true },
      preferences: { orgPrivacyMode: true },
      containsPrivateData: true,
    });
    assert.equal(result.lane, 'self_hosted');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });

  it('disabled when org privacy mode and nothing available', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: { orgPrivacyMode: true },
      containsPrivateData: false,
    });
    assert.equal(result.lane, 'disabled');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});

describe('Integration — BYO key (openrouter)', () => {
  it('openrouter: allow, not metered, even with private data', () => {
    const result = runPipeline({
      capabilities: { openrouterKeyAvailable: true, managedKeyAvailable: true },
      preferences: {},
      containsPrivateData: true,
    });
    assert.equal(result.lane, 'openrouter');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});

describe('Integration — delegate scenarios (D1.4)', () => {
  it('delegate without owner opt-in: lane_policy_denied even with consentId', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: { isDelegate: true, delegatedManagedAllowed: false },
      containsPrivateData: false,
      consentId: 'cid-999',
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.metered, true);
    assert.equal(result.decision, 'lane_policy_denied');
  });

  it('delegate with owner opt-in, non-private: allow', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: { isDelegate: true, delegatedManagedAllowed: true },
      containsPrivateData: false,
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'allow');
  });

  it('delegate with owner opt-in, private data, no consent: cloud_consent_required', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: { isDelegate: true, delegatedManagedAllowed: true },
      containsPrivateData: true,
      consentId: undefined,
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'cloud_consent_required');
  });

  it('delegate routing to local: policy does not apply, always allow', () => {
    const result = runPipeline({
      capabilities: { companionAvailable: true },
      preferences: { isDelegate: true, delegatedManagedAllowed: false },
      containsPrivateData: true,
    });
    assert.equal(result.lane, 'local');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});

describe('Integration — D2.2 fallback chain (keepOnDevice + no local compute)', () => {
  it('managed lane selected but consent required for private data', () => {
    // Scenario: user toggled "keep on device" but has no WebGPU/companion.
    // D2.2: fall through to managed-with-explicit-consent.
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: { keepOnDevice: true },
      containsPrivateData: true,
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'cloud_consent_required');
  });

  it('managed lane + keepOnDevice + non-private: no consent barrier', () => {
    const result = runPipeline({
      capabilities: { managedKeyAvailable: true },
      preferences: { keepOnDevice: true },
      containsPrivateData: false,
    });
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'allow');
  });
});
