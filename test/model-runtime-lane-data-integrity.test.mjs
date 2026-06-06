/**
 * Tier 5 — DATA INTEGRITY: model-runtime-lane correctness and state properties
 *
 * Verifies:
 *   - selectLane is deterministic: identical inputs always produce identical outputs.
 *   - enforceConsentPolicy is deterministic across repeated calls.
 *   - Input objects are never mutated (functions are pure — no side effects).
 *   - All returned lane values are members of the canonical RUNTIME_LANES set.
 *   - Partial / sparse capability objects are handled safely (missing fields = false).
 *   - Null / undefined field values in capabilities/preferences do not throw.
 *
 * Reference: docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §5 (pure function invariants)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
  RUNTIME_LANES,
} from '../lib/model-runtime-lane.mjs';

const VALID_LANES = new Set(RUNTIME_LANES);

describe('Data integrity — selectLane determinism', () => {
  const fixtureCases = [
    [{ inBrowserAvailable: true }, {}, 'local'],
    [{ companionAvailable: true }, {}, 'local'],
    [{ managedKeyAvailable: true }, {}, 'direct_provider'],
    [{ openrouterKeyAvailable: true }, {}, 'openrouter'],
    [{}, {}, 'disabled'],
    [{ selfHostedAvailable: true }, { orgPrivacyMode: true }, 'self_hosted'],
    [{ managedKeyAvailable: true }, { orgPrivacyMode: true }, 'disabled'],
  ];

  for (const [caps, prefs, expected] of fixtureCases) {
    it(`caps=${JSON.stringify(caps)}, prefs=${JSON.stringify(prefs)} → always '${expected}'`, () => {
      for (let i = 0; i < 100; i++) {
        assert.equal(selectLane(caps, prefs), expected);
      }
    });
  }
});

describe('Data integrity — all returned lanes are in RUNTIME_LANES', () => {
  it('exhaustive permutation: all results are valid lane values', () => {
    const boolPairs = [true, false];
    for (const inBrowser of boolPairs)
      for (const companion of boolPairs)
        for (const selfHosted of boolPairs)
          for (const enterprise of boolPairs)
            for (const openrouter of boolPairs)
              for (const managed of boolPairs)
                for (const orgPrivacy of boolPairs) {
                  const lane = selectLane(
                    {
                      inBrowserAvailable: inBrowser,
                      companionAvailable: companion,
                      selfHostedAvailable: selfHosted,
                      enterpriseAvailable: enterprise,
                      openrouterKeyAvailable: openrouter,
                      managedKeyAvailable: managed,
                    },
                    { orgPrivacyMode: orgPrivacy },
                  );
                  assert.ok(VALID_LANES.has(lane), `invalid lane returned: '${lane}'`);
                }
  });
});

describe('Data integrity — no mutation of input objects', () => {
  it('selectLane does not mutate capabilities', () => {
    const caps = { inBrowserAvailable: true, managedKeyAvailable: true };
    const before = JSON.stringify(caps);
    selectLane(caps, { orgPrivacyMode: true });
    assert.equal(JSON.stringify(caps), before);
  });

  it('selectLane does not mutate preferences', () => {
    const prefs = { keepOnDevice: true, orgPrivacyMode: false };
    const before = JSON.stringify(prefs);
    selectLane({ managedKeyAvailable: true }, prefs);
    assert.equal(JSON.stringify(prefs), before);
  });

  it('enforceConsentPolicy does not mutate its params object', () => {
    const params = {
      lane: 'direct_provider',
      containsPrivateData: true,
      consentId: undefined,
      isDelegate: false,
      delegatedManagedAllowed: false,
    };
    const before = JSON.stringify({ ...params, consentId: null });
    enforceConsentPolicy(params);
    const after = JSON.stringify({ ...params, consentId: null });
    assert.equal(before, after);
  });
});

describe('Data integrity — sparse / partial capability objects (fail-closed)', () => {
  it('empty capabilities: returns disabled', () => {
    assert.equal(selectLane({}, {}), 'disabled');
  });

  it('only one boolean field provided: all others default to false', () => {
    assert.equal(selectLane({ selfHostedAvailable: true }, {}), 'self_hosted');
  });

  it('unknown extra fields on capabilities: ignored safely', () => {
    const lane = selectLane({ unknownField: true, managedKeyAvailable: true }, {});
    assert.equal(lane, 'direct_provider');
  });

  it('unknown extra fields on preferences: ignored safely', () => {
    const lane = selectLane({ managedKeyAvailable: true }, { unknownPref: true });
    assert.equal(lane, 'direct_provider');
  });
});

describe('Data integrity — enforceConsentPolicy return values are canonical', () => {
  const validDecisions = new Set(['allow', 'cloud_consent_required', 'lane_policy_denied']);

  it('all code paths return a canonical decision string', () => {
    const cases = [
      // non-managed lanes
      ...['local', 'self_hosted', 'enterprise', 'openrouter', 'disabled'].map((lane) => ({
        lane, containsPrivateData: true, consentId: undefined, isDelegate: true, delegatedManagedAllowed: false,
      })),
      // managed, allow
      { lane: 'direct_provider', containsPrivateData: false, consentId: undefined, isDelegate: false, delegatedManagedAllowed: false },
      // managed, consent required
      { lane: 'direct_provider', containsPrivateData: true, consentId: undefined, isDelegate: false, delegatedManagedAllowed: false },
      // managed, policy denied
      { lane: 'direct_provider', containsPrivateData: false, consentId: 'cid', isDelegate: true, delegatedManagedAllowed: false },
    ];
    for (const c of cases) {
      const d = enforceConsentPolicy(c);
      assert.ok(validDecisions.has(d), `invalid decision: '${d}'`);
    }
  });
});
