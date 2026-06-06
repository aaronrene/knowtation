/**
 * Tier 3 — END-TO-END: model-runtime-lane full scenario paths
 *
 * Simulates complete real-world scenarios that span the full module contract —
 * from raw capability/preference inputs through lane selection → policy gate →
 * metering classification to a terminal routing decision. These scenarios
 * correspond to the product's stated user journeys from the architecture brief.
 *
 * Reference: docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md §4
 *            docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §1–3
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
} from '../lib/model-runtime-lane.mjs';

/**
 * Represents the complete routing result a caller receives.
 * @param {object} caps
 * @param {object} prefs
 * @param {{ containsPrivateData: boolean, consentId?: string }} req
 */
function route(caps, prefs, req) {
  const lane = selectLane(caps, prefs);
  return {
    lane,
    metered: isManagedLane(lane),
    decision: enforceConsentPolicy({
      lane,
      containsPrivateData: req.containsPrivateData,
      consentId: req.consentId,
      isDelegate: prefs.isDelegate ?? false,
      delegatedManagedAllowed: prefs.delegatedManagedAllowed ?? false,
    }),
  };
}

describe('E2E — Scenario 1: Power user, laptop with companion, private notes', () => {
  it('routes to companion (local), not metered, allowed without consent', () => {
    const result = route(
      { companionAvailable: true, managedKeyAvailable: true },
      { keepOnDevice: true },
      { containsPrivateData: true },
    );
    assert.equal(result.lane, 'local');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});

describe('E2E — Scenario 2: Student on school Chromebook (no companion, no WebGPU)', () => {
  it('managed lane, non-private data (schoolwork), no consent needed', () => {
    const result = route(
      { managedKeyAvailable: true },
      {},
      { containsPrivateData: false },
    );
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.metered, true);
    assert.equal(result.decision, 'allow');
  });

  it('managed lane, private personal note, consent prompt required', () => {
    const result = route(
      { managedKeyAvailable: true },
      {},
      { containsPrivateData: true },
    );
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'cloud_consent_required');
  });

  it('managed lane, private note, student provides consent: allowed', () => {
    const result = route(
      { managedKeyAvailable: true },
      {},
      { containsPrivateData: true, consentId: 'student-consent-001' },
    );
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'allow');
  });
});

describe('E2E — Scenario 3: Research org (privacy mode, own server)', () => {
  it('self-hosted lane: not metered, private data freely allowed', () => {
    const result = route(
      { selfHostedAvailable: true, managedKeyAvailable: true },
      { orgPrivacyMode: true },
      { containsPrivateData: true },
    );
    assert.equal(result.lane, 'self_hosted');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });

  it('org privacy mode: managed never selected even when all other capabilities absent', () => {
    const result = route(
      { managedKeyAvailable: true },
      { orgPrivacyMode: true },
      { containsPrivateData: false },
    );
    assert.notEqual(result.lane, 'direct_provider');
    assert.equal(result.lane, 'disabled');
  });
});

describe('E2E — Scenario 4: Developer with OpenRouter BYO key', () => {
  it('openrouter lane: not metered, private data allowed (user owns contract)', () => {
    const result = route(
      { openrouterKeyAvailable: true, managedKeyAvailable: true },
      {},
      { containsPrivateData: true },
    );
    assert.equal(result.lane, 'openrouter');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});

describe('E2E — Scenario 5: Teacher (member) enriching student workspace notes (delegation)', () => {
  it('owner has not opted in: lane_policy_denied — teacher cannot spend owner packs', () => {
    const result = route(
      { managedKeyAvailable: true },
      { isDelegate: true, delegatedManagedAllowed: false },
      { containsPrivateData: false, consentId: 'teacher-consent' },
    );
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.decision, 'lane_policy_denied');
  });

  it('owner opted in, teacher acts on non-private note: allowed and metered to owner', () => {
    const result = route(
      { managedKeyAvailable: true },
      { isDelegate: true, delegatedManagedAllowed: true },
      { containsPrivateData: false },
    );
    assert.equal(result.lane, 'direct_provider');
    assert.equal(result.metered, true); // billed to owner workspace
    assert.equal(result.decision, 'allow');
  });

  it('teacher companion read-only completion (no write-back) is allowed locally', () => {
    // Not an enrichment write to the owner's partition — the teacher already has read scope.
    const result = route(
      { companionAvailable: true },
      { isDelegate: true, delegatedManagedAllowed: false },
      { containsPrivateData: true },
    );
    assert.equal(result.lane, 'local');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });

  it('teacher companion ENRICHING owner notes (write-back) is denied until owner opts in (D1.3(2))', () => {
    const lane = selectLane({ companionAvailable: true }, { isDelegate: true });
    const decision = enforceConsentPolicy({
      lane,
      containsPrivateData: true,
      consentId: undefined,
      isDelegate: true,
      delegatedManagedAllowed: false,
      enrichesDelegatedPartition: true,
      delegatedEnrichmentAllowed: false,
    });
    assert.equal(lane, 'local');
    assert.equal(decision, 'lane_policy_denied');
  });

  it('teacher companion enriching owner notes is allowed once owner enables delegated enrichment', () => {
    const lane = selectLane({ companionAvailable: true }, { isDelegate: true });
    const decision = enforceConsentPolicy({
      lane,
      containsPrivateData: true,
      consentId: undefined,
      isDelegate: true,
      delegatedManagedAllowed: false,
      enrichesDelegatedPartition: true,
      delegatedEnrichmentAllowed: true,
    });
    assert.equal(decision, 'allow');
  });
});

describe('E2E — Scenario 6: User on phone (no companion, no WebGPU), all paths', () => {
  it('embeddings-only fallback when nothing is available', () => {
    const result = route({}, {}, { containsPrivateData: false });
    assert.equal(result.lane, 'disabled');
    assert.equal(result.metered, false);
    assert.equal(result.decision, 'allow');
  });
});
