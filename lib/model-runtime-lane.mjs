/**
 * Model-runtime lane selection, consent enforcement, and metering boundary.
 *
 * Phase 1 of the Companion App build plan (feat/companion-app).
 * Implements:
 *   - D2.2  default-lane selection logic (selectLane)
 *   - D1.2  metering boundary: which lanes bill against Knowtation packs (isManagedLane)
 *   - D1.4  consent and workspace-policy gate (enforceConsentPolicy)
 *
 * DESIGN CONSTRAINTS (read before modifying):
 *   - Pure functions only — no I/O, no process.env reads, no network.
 *   - All inputs are passed explicitly so functions are composable at every layer
 *     (browser tab, companion app, gateway, CLI) without environment coupling.
 *   - Unknown / absent capability fields default to false: fail-closed, never fail-open.
 *   - See docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md for the full seam contract.
 *
 * Hard constraint from docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md §3:
 *   The cloud gateway NEVER proxies local inference. Local/companion lanes are invoked
 *   only by something on the user's machine. selectLane reflects this — it returns 'local'
 *   only when inBrowserAvailable or companionAvailable is true (client-side evidence).
 */

/**
 * The runtime lane identifiers — must match Scooling's runtimeLaneSchema exactly (D2.4).
 * @readonly
 */
export const RUNTIME_LANES = /** @type {const} */ ([
  'local',
  'self_hosted',
  'enterprise',
  'openrouter',
  'direct_provider',
  'disabled',
]);

/**
 * @typedef {'local'|'self_hosted'|'enterprise'|'openrouter'|'direct_provider'|'disabled'} RuntimeLane
 */

/**
 * Runtime capability snapshot.
 * Describes what inference resources are available in THIS execution context.
 * All fields default to false — unknown = unavailable (fail-closed).
 *
 * @typedef {Object} LaneCapabilities
 * @property {boolean} [inBrowserAvailable]
 *   WebGPU/WebLLM is usable in the current browser context.
 *   Always false in Node.js, gateway, and companion process contexts.
 * @property {boolean} [companionAvailable]
 *   Companion loopback endpoint confirmed reachable (prior health-check passed).
 *   Never true in cloud/gateway contexts — the cloud cannot reach localhost (§3 constraint).
 * @property {boolean} [selfHostedAvailable]
 *   Self-hosted or enterprise endpoint configured and confirmed reachable.
 * @property {boolean} [enterpriseAvailable]
 *   Enterprise endpoint configured and confirmed reachable.
 * @property {boolean} [openrouterKeyAvailable]
 *   OPENROUTER_API_KEY is present. Enables the BYO-key lane (user's own provider contract).
 * @property {boolean} [managedKeyAvailable]
 *   At least one managed cloud key (DeepInfra/OpenAI/Anthropic) is available AND the
 *   operator has not locked out the managed lane.
 */

/**
 * Workspace/user lane preferences.
 * Expressed by the authenticated user or enforced by workspace policy.
 *
 * @typedef {Object} LanePreferences
 * @property {boolean} [keepOnDevice]
 *   User enabled "keep my data on my device" toggle. Biases selection toward local lanes.
 *   Does NOT hard-block managed — if no local compute is available the caller falls through
 *   to direct_provider, and enforceConsentPolicy then requires explicit per-request consent
 *   for private data (D2.2 fallback chain: in-browser → companion → managed-with-consent).
 * @property {boolean} [orgPrivacyMode]
 *   Org-level policy: managed lane is OFF. Default to self-hosted/BYO/local.
 *   When true, selectLane never returns 'direct_provider'.
 * @property {boolean} [delegatedManagedAllowed]
 *   Owner opt-in: delegates may trigger the managed lane against owner packs (D1.4).
 *   Relevant only when isDelegate=true.
 * @property {boolean} [isDelegate]
 *   Requesting actor is acting on another user's partition (delegate=true from
 *   resolveEffectiveCanisterUser). Checked against delegatedManagedAllowed in the consent gate.
 */

/**
 * @typedef {'allow'|'cloud_consent_required'|'lane_policy_denied'} ConsentDecision
 */

/** Default capabilities — all false (fail-closed). */
const DEFAULT_CAPABILITIES = {
  inBrowserAvailable: false,
  companionAvailable: false,
  selfHostedAvailable: false,
  enterpriseAvailable: false,
  openrouterKeyAvailable: false,
  managedKeyAvailable: false,
};

/** Default preferences — individual user, no special mode or delegation. */
const DEFAULT_PREFERENCES = {
  keepOnDevice: false,
  orgPrivacyMode: false,
  delegatedManagedAllowed: false,
  isDelegate: false,
};

/**
 * Select the highest-privacy capable lane for the current context.
 * Implements D2.2 default-lane selection logic from the Phase 0 Decision Record.
 *
 * Lane priority (org privacy mode OFF):
 *   1. local   — inBrowser or companion (highest privacy, free, client-side only)
 *   2. self_hosted — org or power-user self-hosted endpoint
 *   3. enterprise  — enterprise org endpoint
 *   4. openrouter  — BYO key (user pays provider; not metered against packs)
 *   5. direct_provider — managed cloud (metered; requires explicit consent for private data)
 *   6. disabled    — no lane can satisfy; caller falls back to embeddings-only / no inference
 *
 * When orgPrivacyMode=true:
 *   managed (direct_provider) is never selected. Priority ranks org-controlled infra first,
 *   then by data egress (local has zero egress; openrouter routes to a third party), so:
 *   self_hosted → enterprise → local → openrouter → disabled
 *
 * @param {LaneCapabilities} capabilities
 * @param {LanePreferences} preferences
 * @returns {RuntimeLane}
 */
export function selectLane(capabilities, preferences) {
  const caps = { ...DEFAULT_CAPABILITIES, ...capabilities };
  const prefs = { ...DEFAULT_PREFERENCES, ...preferences };

  if (prefs.orgPrivacyMode) {
    if (caps.selfHostedAvailable) return 'self_hosted';
    if (caps.enterpriseAvailable) return 'enterprise';
    // Privacy mode ranks zero-egress local above third-party openrouter egress.
    if (caps.inBrowserAvailable || caps.companionAvailable) return 'local';
    if (caps.openrouterKeyAvailable) return 'openrouter';
    return 'disabled';
  }

  if (caps.inBrowserAvailable || caps.companionAvailable) return 'local';

  if (caps.selfHostedAvailable) return 'self_hosted';
  if (caps.enterpriseAvailable) return 'enterprise';
  if (caps.openrouterKeyAvailable) return 'openrouter';
  if (caps.managedKeyAvailable) return 'direct_provider';

  return 'disabled';
}

/**
 * Returns true when the given lane emits a metered billing event against Knowtation packs.
 *
 * D1.2: billing principal is the workspace owner of the target partition.
 * Only 'direct_provider' (managed cloud) is metered — local, self_hosted, enterprise,
 * and openrouter lanes are never metered (brief §6 principle 1):
 *   - local: zero provider cost (user's own compute)
 *   - self_hosted / enterprise: org pays its own infrastructure
 *   - openrouter: user pays their provider contract directly; Knowtation packs uninvolved
 *
 * @param {string} lane
 * @returns {boolean}
 */
export function isManagedLane(lane) {
  return lane === 'direct_provider';
}

/**
 * Lanes that route an owner's note text OFF the owner's own controlled infrastructure
 * when invoked by a delegate enriching the owner's partition:
 *   - 'local'      — runs on the DELEGATE's device (companion / in-browser), not the owner's.
 *   - 'openrouter' — routes to the DELEGATE's own third-party provider contract.
 * Both are gated by the owner's "allow delegated enrichment" opt-in (D1.3(2)).
 * Org lanes ('self_hosted'/'enterprise') are governed by org policy, not this individual
 * opt-in. The managed lane ('direct_provider') is governed by D1.4 (delegatedManagedAllowed).
 * @type {ReadonlySet<string>}
 */
const DELEGATED_ENRICHMENT_GATED_LANES = new Set(['local', 'openrouter']);

/**
 * Consent and workspace-policy gate for model calls.
 *
 * Evaluation order — workspace policy (cannot be overridden by a consentId) before
 * per-request consent:
 *
 *   1. MANAGED-LANE DELEGATE POLICY (D1.4): lane is managed AND isDelegate AND
 *      NOT delegatedManagedAllowed → 'lane_policy_denied'.
 *      Reason: the owner has not opted in to delegate-triggered managed-lane spend.
 *      Surface as a permission/policy message, not a consent prompt.
 *
 *   2. DELEGATED-ENRICHMENT POLICY (D1.3(2)): the call writes a derived artifact to a
 *      partition the actor does NOT own (enrichesDelegatedPartition) via a lane that runs
 *      off the owner's own infrastructure (local companion or the delegate's BYO openrouter)
 *      AND the owner has NOT enabled delegatedEnrichmentAllowed → 'lane_policy_denied'.
 *      Reason: "may a member's companion enrich an owner's notes?" — only with the owner's
 *      opt-in (default OFF). This closes the gate §12 canonical defect (a member's companion
 *      silently enriching an owner's notes). FAIL-CLOSED: default-OFF until the owner opts in.
 *
 *   3. CONSENT REQUIRED (per-request; fixable by providing a consentId): lane is managed
 *      AND containsPrivateData AND NOT consentId → 'cloud_consent_required'.
 *      Reason: private learner data must not reach a managed (cloud) provider without
 *      explicit per-action consent (D2.3 / D1.4 / brief §6).
 *
 *   4. ALLOW: all other cases.
 *
 * Notes:
 *   - A non-enrichment completion (enrichesDelegatedPartition=false) on a non-managed lane
 *     always allows — the delegate already has read scope (D1.3(1)); no artifact is written.
 *   - Org lanes (self_hosted / enterprise) are never gated here for delegated enrichment;
 *     the org controls the endpoint and governs that path by org policy.
 *
 * @param {{
 *   lane: string,
 *   containsPrivateData: boolean,
 *   consentId?: string,
 *   isDelegate: boolean,
 *   delegatedManagedAllowed: boolean,
 *   enrichesDelegatedPartition?: boolean,
 *   delegatedEnrichmentAllowed?: boolean,
 * }} params
 * @returns {ConsentDecision}
 */
export function enforceConsentPolicy({
  lane,
  containsPrivateData,
  consentId,
  isDelegate,
  delegatedManagedAllowed,
  enrichesDelegatedPartition = false,
  delegatedEnrichmentAllowed = false,
}) {
  // 1. Managed-lane delegate spend policy (D1.4) — precedes consent.
  if (isManagedLane(lane)) {
    if (isDelegate && !delegatedManagedAllowed) return 'lane_policy_denied';
    if (containsPrivateData && !consentId) return 'cloud_consent_required';
    return 'allow';
  }

  // 2. Delegated-enrichment policy (D1.3(2)) for non-managed, off-owner-infra lanes.
  if (
    isDelegate &&
    enrichesDelegatedPartition &&
    DELEGATED_ENRICHMENT_GATED_LANES.has(lane) &&
    !delegatedEnrichmentAllowed
  ) {
    return 'lane_policy_denied';
  }

  return 'allow';
}
