/**
 * Tier 1 — UNIT: lib/model-runtime-lane.mjs
 *
 * Tests the smallest behavioural contracts of selectLane, isManagedLane, and
 * enforceConsentPolicy in total isolation — pure functions, no network, no env.
 *
 * Reference: docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md §1.3–1.5
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLane,
  isManagedLane,
  enforceConsentPolicy,
  RUNTIME_LANES,
} from '../lib/model-runtime-lane.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

/** No capabilities — nothing available. */
const NO_CAPS = {};
/** All capabilities available. */
const ALL_CAPS = {
  inBrowserAvailable: true,
  companionAvailable: true,
  selfHostedAvailable: true,
  enterpriseAvailable: true,
  openrouterKeyAvailable: true,
  managedKeyAvailable: true,
};
/** Only managed cloud available. */
const MANAGED_ONLY = { managedKeyAvailable: true };
/** Only in-browser available. */
const INBROWSER_ONLY = { inBrowserAvailable: true };
/** Only companion available. */
const COMPANION_ONLY = { companionAvailable: true };
/** Only self-hosted available. */
const SELF_HOSTED_ONLY = { selfHostedAvailable: true };
/** Only enterprise available. */
const ENTERPRISE_ONLY = { enterpriseAvailable: true };
/** Only openrouter available. */
const OR_ONLY = { openrouterKeyAvailable: true };

const NO_PREFS = {};
const KEEP_ON_DEVICE = { keepOnDevice: true };
const ORG_PRIVACY = { orgPrivacyMode: true };

// ── RUNTIME_LANES export ─────────────────────────────────────────────────────

describe('RUNTIME_LANES', () => {
  it('exports all six lane identifiers', () => {
    const expected = ['local', 'self_hosted', 'enterprise', 'openrouter', 'direct_provider', 'disabled'];
    assert.deepEqual([...RUNTIME_LANES].sort(), expected.sort());
  });
});

// ── selectLane — individual user path ────────────────────────────────────────

describe('selectLane — individual user (no org privacy mode)', () => {
  it('returns disabled when no capability is available', () => {
    assert.equal(selectLane(NO_CAPS, NO_PREFS), 'disabled');
  });

  it('prefers local (in-browser) over all other lanes when inBrowserAvailable', () => {
    assert.equal(selectLane(ALL_CAPS, NO_PREFS), 'local');
  });

  it('returns local when only inBrowserAvailable=true', () => {
    assert.equal(selectLane(INBROWSER_ONLY, NO_PREFS), 'local');
  });

  it('returns local when only companionAvailable=true', () => {
    assert.equal(selectLane(COMPANION_ONLY, NO_PREFS), 'local');
  });

  it('returns local when both inBrowserAvailable and companionAvailable are true', () => {
    assert.equal(selectLane({ inBrowserAvailable: true, companionAvailable: true }, NO_PREFS), 'local');
  });

  it('returns self_hosted over enterprise when both available and no local', () => {
    assert.equal(
      selectLane({ selfHostedAvailable: true, enterpriseAvailable: true, managedKeyAvailable: true }, NO_PREFS),
      'self_hosted',
    );
  });

  it('returns enterprise when only enterprise available (no local/self-hosted)', () => {
    assert.equal(selectLane(ENTERPRISE_ONLY, NO_PREFS), 'enterprise');
  });

  it('returns openrouter over managed when both available and no local', () => {
    assert.equal(
      selectLane({ openrouterKeyAvailable: true, managedKeyAvailable: true }, NO_PREFS),
      'openrouter',
    );
  });

  it('returns openrouter when only openrouterKeyAvailable', () => {
    assert.equal(selectLane(OR_ONLY, NO_PREFS), 'openrouter');
  });

  it('returns direct_provider when only managedKeyAvailable', () => {
    assert.equal(selectLane(MANAGED_ONLY, NO_PREFS), 'direct_provider');
  });

  it('local beats managed even when keepOnDevice=false', () => {
    assert.equal(selectLane({ inBrowserAvailable: true, managedKeyAvailable: true }, NO_PREFS), 'local');
  });
});

// ── selectLane — orgPrivacyMode ───────────────────────────────────────────────

describe('selectLane — orgPrivacyMode=true', () => {
  it('never returns direct_provider in org privacy mode', () => {
    const lane = selectLane({ managedKeyAvailable: true }, ORG_PRIVACY);
    assert.notEqual(lane, 'direct_provider');
    assert.equal(lane, 'disabled');
  });

  it('returns self_hosted first when available', () => {
    assert.equal(selectLane(ALL_CAPS, ORG_PRIVACY), 'self_hosted');
  });

  it('falls to enterprise when no self-hosted', () => {
    assert.equal(
      selectLane({ enterpriseAvailable: true, openrouterKeyAvailable: true, managedKeyAvailable: true }, ORG_PRIVACY),
      'enterprise',
    );
  });

  it('prefers local (zero egress) over openrouter (third-party egress) in privacy mode', () => {
    assert.equal(
      selectLane({ openrouterKeyAvailable: true, inBrowserAvailable: true, managedKeyAvailable: true }, ORG_PRIVACY),
      'local',
    );
  });

  it('falls to openrouter when no org endpoints and no local compute', () => {
    assert.equal(
      selectLane({ openrouterKeyAvailable: true, managedKeyAvailable: true }, ORG_PRIVACY),
      'openrouter',
    );
  });

  it('falls to local (in-browser) when no org endpoints and no openrouter key', () => {
    assert.equal(
      selectLane({ inBrowserAvailable: true, managedKeyAvailable: true }, ORG_PRIVACY),
      'local',
    );
  });

  it('falls to local (companion) when no org endpoints, companion available', () => {
    assert.equal(
      selectLane({ companionAvailable: true, managedKeyAvailable: true }, ORG_PRIVACY),
      'local',
    );
  });

  it('returns disabled when truly nothing is available', () => {
    assert.equal(selectLane(NO_CAPS, ORG_PRIVACY), 'disabled');
  });
});

// ── selectLane — keepOnDevice ─────────────────────────────────────────────────

describe('selectLane — keepOnDevice', () => {
  it('returns local immediately when inBrowserAvailable', () => {
    assert.equal(selectLane(INBROWSER_ONLY, KEEP_ON_DEVICE), 'local');
  });

  it('returns local when companion available and keepOnDevice=true', () => {
    assert.equal(selectLane(COMPANION_ONLY, KEEP_ON_DEVICE), 'local');
  });

  it('falls through to direct_provider when keepOnDevice=true but no local compute', () => {
    // D2.2 fallback chain: in-browser → companion → managed-with-explicit-consent.
    // enforceConsentPolicy then gates the managed lane for private data.
    assert.equal(selectLane(MANAGED_ONLY, KEEP_ON_DEVICE), 'direct_provider');
  });
});

// ── isManagedLane ─────────────────────────────────────────────────────────────

describe('isManagedLane', () => {
  it('returns true only for direct_provider', () => {
    assert.equal(isManagedLane('direct_provider'), true);
  });

  it('returns false for local', () => assert.equal(isManagedLane('local'), false));
  it('returns false for self_hosted', () => assert.equal(isManagedLane('self_hosted'), false));
  it('returns false for enterprise', () => assert.equal(isManagedLane('enterprise'), false));
  it('returns false for openrouter', () => assert.equal(isManagedLane('openrouter'), false));
  it('returns false for disabled', () => assert.equal(isManagedLane('disabled'), false));
  it('returns false for unknown string', () => assert.equal(isManagedLane('unknown'), false));
});

// ── enforceConsentPolicy ──────────────────────────────────────────────────────

describe('enforceConsentPolicy — non-managed lanes always allow', () => {
  const nonManaged = ['local', 'self_hosted', 'enterprise', 'openrouter', 'disabled'];
  for (const lane of nonManaged) {
    it(`allows ${lane} regardless of private data / delegate status`, () => {
      assert.equal(
        enforceConsentPolicy({
          lane,
          containsPrivateData: true,
          consentId: undefined,
          isDelegate: true,
          delegatedManagedAllowed: false,
        }),
        'allow',
      );
    });
  }
});

describe('enforceConsentPolicy — managed lane (direct_provider)', () => {
  it('allows when data is not private and no delegation issue', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: false,
        consentId: undefined,
        isDelegate: false,
        delegatedManagedAllowed: false,
      }),
      'allow',
    );
  });

  it('allows when private data + consentId + not a delegate', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: true,
        consentId: 'cid-123',
        isDelegate: false,
        delegatedManagedAllowed: false,
      }),
      'allow',
    );
  });

  it('returns cloud_consent_required when private data without consentId', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: false,
        delegatedManagedAllowed: false,
      }),
      'cloud_consent_required',
    );
  });

  it('returns lane_policy_denied when delegate without owner opt-in (beats consent check)', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: true,
        consentId: 'cid-999',  // consentId present, but policy still denies
        isDelegate: true,
        delegatedManagedAllowed: false,
      }),
      'lane_policy_denied',
    );
  });

  it('policy denial is NOT fixable by providing a consentId (order check)', () => {
    // Even with a valid consentId, a delegate without owner opt-in is denied.
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: false,
        consentId: 'cid-abc',
        isDelegate: true,
        delegatedManagedAllowed: false,
      }),
      'lane_policy_denied',
    );
  });

  it('allows delegate when owner has opted in (delegatedManagedAllowed=true)', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: false,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: true,
      }),
      'allow',
    );
  });

  it('requires consent for delegate + private data + owner opt-in', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: true,
      }),
      'cloud_consent_required',
    );
  });

  it('allows delegate + private data + owner opt-in + consentId provided', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'direct_provider',
        containsPrivateData: true,
        consentId: 'cid-xyz',
        isDelegate: true,
        delegatedManagedAllowed: true,
      }),
      'allow',
    );
  });
});

describe('enforceConsentPolicy — D1.3(2) delegated companion enrichment gate', () => {
  it('denies delegate local-companion enrichment of owner partition by default (default OFF)', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'local',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true,
        // delegatedEnrichmentAllowed omitted → defaults to false (fail-closed)
      }),
      'lane_policy_denied',
    );
  });

  it('allows delegate local enrichment once owner opts in (delegatedEnrichmentAllowed=true)', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'local',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true,
        delegatedEnrichmentAllowed: true,
      }),
      'allow',
    );
  });

  it('denies delegate openrouter (BYO) enrichment of owner partition by default', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'openrouter',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true,
        delegatedEnrichmentAllowed: false,
      }),
      'lane_policy_denied',
    );
  });

  it('does NOT gate a delegate local completion that is not an enrichment write-back', () => {
    // enrichesDelegatedPartition defaults to false → a read-only/ephemeral completion is allowed
    // (the delegate already has read scope per D1.3(1)); no artifact is written.
    assert.equal(
      enforceConsentPolicy({
        lane: 'local',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: false,
      }),
      'allow',
    );
  });

  it('does NOT gate a NON-delegate (owner) enriching their own partition locally', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'local',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: false,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: false,
        delegatedEnrichmentAllowed: false,
      }),
      'allow',
    );
  });

  it('does NOT apply the enrichment gate to org lanes (self_hosted) — org policy governs', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'self_hosted',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true,
        delegatedEnrichmentAllowed: false,
      }),
      'allow',
    );
  });

  it('does NOT apply the enrichment gate to enterprise lanes — org policy governs', () => {
    assert.equal(
      enforceConsentPolicy({
        lane: 'enterprise',
        containsPrivateData: true,
        consentId: undefined,
        isDelegate: true,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true,
        delegatedEnrichmentAllowed: false,
      }),
      'allow',
    );
  });
});
