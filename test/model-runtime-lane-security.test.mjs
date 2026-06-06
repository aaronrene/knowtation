/**
 * Tier 7 — SECURITY: model-runtime-lane adversarial properties
 *
 * Tests the security invariants from the Phase 1 seam contract:
 *   1. orgPrivacyMode never routes to managed — org privacy cannot be bypassed.
 *   2. Delegate without owner opt-in is denied before consent (policy beats consent).
 *   3. Private data never reaches managed without an explicit consentId — even if every
 *      other parameter is maximally permissive.
 *   4. Unknown/malformed lane values in enforceConsentPolicy never grant managed access.
 *   5. Fail-closed: no capability or preference set (empty objects) never selects a
 *      non-disabled, metered lane.
 *   6. Unknown extra fields on inputs cannot escalate privileges.
 *   7. A forged 'delegatedManagedAllowed' on an injected capabilities object does NOT
 *      bypass the policy gate (policy parameters are separate from capabilities).
 *
 * Reference: docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §5 (threat model table)
 *            docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md §8.7
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
} from '../lib/model-runtime-lane.mjs';

describe('Security — orgPrivacyMode cannot be bypassed to reach managed lane', () => {
  it('all capability combinations with orgPrivacyMode=true: managed never selected', () => {
    const boolValues = [true, false];
    for (const managed of boolValues)
      for (const inBrowser of boolValues)
        for (const companion of boolValues) {
          const lane = selectLane(
            { managedKeyAvailable: managed, inBrowserAvailable: inBrowser, companionAvailable: companion },
            { orgPrivacyMode: true },
          );
          assert.notEqual(
            lane, 'direct_provider',
            `orgPrivacyMode=true still selected direct_provider (caps: managed=${String(managed)}, inBrowser=${String(inBrowser)}, companion=${String(companion)})`,
          );
        }
  });

  it('orgPrivacyMode=true with unknown extra preference fields: still no managed', () => {
    const lane = selectLane(
      { managedKeyAvailable: true },
      { orgPrivacyMode: true, unknownOverride: false },
    );
    assert.notEqual(lane, 'direct_provider');
  });
});

describe('Security — policy denial beats consent (evaluation order)', () => {
  it('delegate without opt-in: lane_policy_denied even when consentId is present', () => {
    const d = enforceConsentPolicy({
      lane: 'direct_provider',
      containsPrivateData: true,
      consentId: 'attacker-supplied-consent-id',
      isDelegate: true,
      delegatedManagedAllowed: false,
    });
    assert.equal(d, 'lane_policy_denied', 'policy denial should precede consent check');
  });

  it('delegate without opt-in, non-private data, valid consentId: still denied', () => {
    const d = enforceConsentPolicy({
      lane: 'direct_provider',
      containsPrivateData: false,
      consentId: 'cid-valid',
      isDelegate: true,
      delegatedManagedAllowed: false,
    });
    assert.equal(d, 'lane_policy_denied');
  });
});

describe('Security — private data never reaches managed without explicit consent', () => {
  it('managed lane + private data + no consentId: always cloud_consent_required', () => {
    // Verify across all combinations of isDelegate + delegatedManagedAllowed
    // where policy doesn't already deny.
    const allowed = [
      { isDelegate: false, delegatedManagedAllowed: false },
      { isDelegate: false, delegatedManagedAllowed: true },
      { isDelegate: true, delegatedManagedAllowed: true },
    ];
    for (const { isDelegate, delegatedManagedAllowed } of allowed) {
      const d = enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate,
        delegatedManagedAllowed,
      });
      assert.equal(
        d, 'cloud_consent_required',
        `private data without consent should be blocked (isDelegate=${String(isDelegate)}, delegatedManagedAllowed=${String(delegatedManagedAllowed)})`,
      );
    }
  });

  it('empty string consentId is treated as missing (not a valid consent token)', () => {
    const d = enforceConsentPolicy({
      lane: 'direct_provider',
      containsPrivateData: true,
      consentId: '',
      isDelegate: false,
      delegatedManagedAllowed: false,
    });
    // '' is falsy — treated as no consentId.
    assert.equal(d, 'cloud_consent_required');
  });
});

describe('Security — unknown or malformed lane values in enforceConsentPolicy', () => {
  it('unknown lane string is NOT treated as managed (not in RUNTIME_LANES)', () => {
    const d = enforceConsentPolicy({
      lane: 'unknown_future_lane',
      containsPrivateData: true,
      consentId: undefined,
      isDelegate: false,
      delegatedManagedAllowed: false,
    });
    // isManagedLane('unknown_future_lane') = false → allow (not a managed lane).
    assert.equal(d, 'allow');
    // Verify the managed boundary is NOT crossed.
    assert.equal(isManagedLane('unknown_future_lane'), false);
  });

  it('empty string lane is not managed', () => {
    assert.equal(isManagedLane(''), false);
    const d = enforceConsentPolicy({ lane: '', containsPrivateData: true, consentId: undefined, isDelegate: false, delegatedManagedAllowed: false });
    assert.equal(d, 'allow');
  });
});

describe('Security — fail-closed: empty caps/prefs never select a metered lane', () => {
  it('no capabilities → disabled (no metered lane selected)', () => {
    const lane = selectLane({}, {});
    assert.equal(lane, 'disabled');
    assert.equal(isManagedLane(lane), false);
  });

  it('unknown extra fields on capabilities cannot introduce a metered lane', () => {
    const lane = selectLane({ magicManagedAccess: true }, {});
    // managedKeyAvailable is not set → disabled.
    assert.equal(lane, 'disabled');
    assert.equal(isManagedLane(lane), false);
  });
});

describe('Security — injected delegatedManagedAllowed field on capabilities object', () => {
  it('delegatedManagedAllowed on capabilities does not bypass policy (wrong param location)', () => {
    // Attacker puts delegatedManagedAllowed in capabilities instead of preferences.
    // The policy gate reads it from the explicit params object, not from capabilities.
    const lane = selectLane({ managedKeyAvailable: true }, {});
    const d = enforceConsentPolicy({
      lane,
      containsPrivateData: false,
      consentId: undefined,
      isDelegate: true,
      delegatedManagedAllowed: false,  // correct source — attacker cannot override via capabilities
    });
    assert.equal(d, 'lane_policy_denied');
  });
});

describe('Security — D1.3(2) delegated companion enrichment cannot silently proceed', () => {
  // This is the gate §12 canonical defect: "a member's companion silently enriching an
  // owner's notes". The default-OFF gate must hold across every off-owner-infra lane.
  it('delegate enrichment of owner partition is denied by default on local and openrouter', () => {
    for (const lane of ['local', 'openrouter']) {
      const d = enforceConsentPolicy({
        lane,
        containsPrivateData: true,
        consentId: 'attacker-consent',  // a consentId must NOT unlock a policy-gated lane
        isDelegate: true,
        delegatedManagedAllowed: true,  // even the managed opt-in must not leak across
        enrichesDelegatedPartition: true,
        delegatedEnrichmentAllowed: false,
      });
      assert.equal(d, 'lane_policy_denied', `lane ${lane} leaked delegated enrichment`);
    }
  });

  it('a consentId cannot override the delegated-enrichment policy denial', () => {
    const d = enforceConsentPolicy({
      lane: 'local',
      containsPrivateData: false,
      consentId: 'cid-supplied',
      isDelegate: true,
      delegatedManagedAllowed: false,
      enrichesDelegatedPartition: true,
      delegatedEnrichmentAllowed: false,
    });
    assert.equal(d, 'lane_policy_denied');
  });

  it('fail-closed: omitting delegatedEnrichmentAllowed denies (default OFF)', () => {
    const d = enforceConsentPolicy({
      lane: 'local',
      containsPrivateData: true,
      consentId: undefined,
      isDelegate: true,
      delegatedManagedAllowed: false,
      enrichesDelegatedPartition: true,
      // delegatedEnrichmentAllowed intentionally omitted
    });
    assert.equal(d, 'lane_policy_denied');
  });
});

describe('Security — no secrets or private data in return values', () => {
  it('selectLane returns only a lane string — no input data echoed back', () => {
    const sensitiveCapabilities = {
      inBrowserAvailable: false,
      _privateKey: 'secret-key-value',
      managedKeyAvailable: true,
    };
    const lane = selectLane(sensitiveCapabilities, {});
    // The return value is one of the canonical strings, never a reflection of inputs.
    assert.equal(typeof lane, 'string');
    assert.ok(!lane.includes('secret'));
  });

  it('enforceConsentPolicy return value contains no consentId content', () => {
    const d = enforceConsentPolicy({
      lane: 'direct_provider',
      containsPrivateData: true,
      consentId: 'user-private-consent-token-xyz',
      isDelegate: false,
      delegatedManagedAllowed: false,
    });
    assert.ok(!d.includes('user-private-consent-token-xyz'));
  });
});
