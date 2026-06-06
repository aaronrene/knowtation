# Companion App — Phase 1 Adapter Seam Contract

**Status:** accepted design + implementation.
**Branch:** `feat/companion-app` (Muse-canonical; not a docs-only PR to `main`).
**Phase table ref:** Gate §12, Phase 1 — 🔀 Hybrid (seam contract: thinking model tier; implementation: Sonnet/auto).
**Depends on:** Phase 0 Decision Record (gate §13, D1–D3 accepted).
**Upstream:** [`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md) §8 (Scooling consumption contract), §12 Phase 1.

---

## What Phase 1 produces

- **`lib/model-runtime-lane.mjs`** — three pure exported functions implementing D2.2 lane selection, D1.2 metering boundary, and D1.4 consent/policy gate. No I/O, no env reads, no network calls — fully composable at any layer (gateway, bridge, companion, CLI).
- **7-tier test suite** (`test/model-runtime-lane-*.test.mjs`, 35+ cases) covering all lane combinations, policy denial, consent enforcement, and security properties.
- **Scooling `ModelResponse` type update** (cross-repo, `scooling/src/adapters/types.ts`): adds `"lane_policy_denied"` as a third `reason` code and updates `createMockModelRuntimeAdapter()` to handle it.

## What Phase 1 does NOT produce

- Any companion binary, loopback endpoint, or bundled runtime (Phase 2+).
- A concrete `KnowtationModelRuntimeAdapter` class wired to real providers — that is Phase 10. Phase 1 provides the pure decision functions the Phase 10 class will call.
- ZK tier, provider routing through `completeChat`/`daemonLlm`, or new Hub REST endpoints.

---

## 1. Module contract — `lib/model-runtime-lane.mjs`

### 1.1 `LaneCapabilities` type

Describes inference resources available in the **current execution context**. All fields default to `false` — unknown = unavailable (fail-closed).

| Field | Type | Meaning |
| --- | --- | --- |
| `inBrowserAvailable` | `boolean` | WebGPU/WebLLM is usable in the current browser context. Always `false` in Node.js, gateway, and companion processes. |
| `companionAvailable` | `boolean` | Companion loopback endpoint confirmed reachable (prior health-check). Never `true` in cloud contexts. |
| `selfHostedAvailable` | `boolean` | Self-hosted endpoint configured and reachable. |
| `enterpriseAvailable` | `boolean` | Enterprise endpoint configured and reachable. |
| `openrouterKeyAvailable` | `boolean` | `OPENROUTER_API_KEY` is present. Enables the BYO-key lane. |
| `managedKeyAvailable` | `boolean` | At least one managed cloud key (DeepInfra/OpenAI/Anthropic) present AND operator has not locked out the managed lane. |

### 1.2 `LanePreferences` type

Workspace/user preferences. Expressed by the authenticated user or enforced by workspace policy.

| Field | Type | Meaning |
| --- | --- | --- |
| `keepOnDevice` | `boolean` | User enabled "keep my data on my device" toggle. Biases selection toward local lanes; does not hard-block managed (see fallback chain below). |
| `orgPrivacyMode` | `boolean` | Org policy: managed lane is **OFF**; default to private infra (self-hosted/BYO/local). |
| `delegatedManagedAllowed` | `boolean` | Owner opt-in: delegates may trigger the managed lane against owner packs (D1.4). Only relevant when `isDelegate = true`. |
| `isDelegate` | `boolean` | Requesting actor is acting on another user's partition (`delegate = true` in `resolveEffectiveCanisterUser`). |

### 1.3 `selectLane(capabilities, preferences)` — D2.2 default-lane logic

**Signature:** `(LaneCapabilities, LanePreferences) → RuntimeLane`

**Algorithm:**

```
if orgPrivacyMode:
  prefer: self_hosted → enterprise → openrouter → local → disabled

else (individual user or org without privacy mode):
  if inBrowserAvailable or companionAvailable → local        (highest privacy, free)
  if selfHostedAvailable                      → self_hosted
  if enterpriseAvailable                      → enterprise
  if openrouterKeyAvailable                   → openrouter   (BYO key, not metered)
  if managedKeyAvailable                      → direct_provider  (managed cloud, metered)
  → disabled                                                  (embeddings-only fallback)
```

In `orgPrivacyMode` the order ranks org-controlled infrastructure first, then by data egress
(local has zero egress; openrouter routes to a third party), and never selects `direct_provider`:

```
self_hosted → enterprise → local → openrouter → disabled
```

**Key properties (invariants under test):**
- `local` is always preferred over any cloud lane when on-device compute is available.
- `orgPrivacyMode=true` never selects `direct_provider`.
- `keepOnDevice=true` without local compute falls through to `direct_provider` — the consent gate (§1.4 below) then requires explicit per-request consent for private data.
- Returns a value from `['local','self_hosted','enterprise','openrouter','direct_provider','disabled']` (the Scooling `runtimeLaneSchema` set, D2.4).
- Pure: same inputs → same output, no side effects.

### 1.4 `isManagedLane(lane)` — D1.2 metering boundary

**Signature:** `(string) → boolean`

Returns `true` **only** for `'direct_provider'` — the one lane that emits a metered billing event against Knowtation packs (D1.2: billing principal = workspace owner of the target partition).

All other lanes (`local`, `self_hosted`, `enterprise`, `openrouter`) are **never metered**:
- `local` (in-browser/companion): zero provider cost (user's compute, brief §6 principle 1).
- `self_hosted`/`enterprise`: org pays their own infra.
- `openrouter`: user pays their provider contract directly; packs not involved (brief §4).

### 1.5 `enforceConsentPolicy(params)` — D1.4 + D1.3(2) consent/policy gate

**Signature:** `({ lane, containsPrivateData, consentId?, isDelegate, delegatedManagedAllowed, enrichesDelegatedPartition?, delegatedEnrichmentAllowed? }) → 'allow' | 'cloud_consent_required' | 'lane_policy_denied'`

`enrichesDelegatedPartition` and `delegatedEnrichmentAllowed` both default to `false` (fail-closed).

**Evaluation order (workspace policy before per-request consent):**

1. **Managed-lane delegate policy (D1.4) — precedes consent:**
   `lane is managed AND isDelegate AND NOT delegatedManagedAllowed` → `'lane_policy_denied'`
   Rationale: the owner has not opted in to delegate-triggered managed-lane spend (default-OFF).

2. **Delegated-enrichment policy (D1.3(2)) — the gate §12 canonical defect:**
   `isDelegate AND enrichesDelegatedPartition AND lane ∈ {local, openrouter} AND NOT delegatedEnrichmentAllowed` → `'lane_policy_denied'`
   Rationale: *"may a member's companion enrich an owner's notes?"* — only with the owner's
   explicit opt-in (default OFF). `local` runs on the **delegate's** device; `openrouter` routes
   to the **delegate's** BYO third-party — both move the owner's note text off the owner's own
   infrastructure. **FAIL-CLOSED:** denied until the owner opts in. This closes the silent-allow
   hole where a delegate's companion could enrich an owner's notes with no owner consent.

3. **Consent required (per-request, fixable by providing a consentId):**
   `lane is managed AND containsPrivateData AND NOT consentId` → `'cloud_consent_required'`
   Rationale: private data must not reach a managed (cloud) lane without explicit consent (D2.3 / D1.4).

4. **Allow:** all other cases.

**Notes:**
- A non-enrichment completion (`enrichesDelegatedPartition=false`) on a non-managed lane returns
  `'allow'` — the delegate already has read scope (D1.3(1)) and no artifact is written back.
- Org lanes (`self_hosted`, `enterprise`) are **not** gated for delegated enrichment here — the org
  controls the endpoint and governs that path by org policy.
- The caller records `consentId` provenance alongside any managed-lane invocation, and
  `generated_by`/`source` provenance for any delegated enrichment write (gate §6, brief §8.4).

> **Scope note (openrouter extension — RATIFIED 2026-06-05):** Phase 0 D1.3 named the *companion*
> (`local`) explicitly. This module also fail-closes the structurally identical
> `openrouter`-delegate-enrichment case (the delegate's BYO key sending the owner's note text to a
> third party). The owner ratified this extension; see the gate doc §13 D1.3 clarification.

---

## 2. Scooling interface additions (cross-repo)

### 2.1 `ModelResponse` (Scooling `src/adapters/types.ts`)

The `reason` discriminant on `{ ok: false }` gains a third value:

```ts
// Before:
| { ok: false; reason: "cloud_consent_required" | "runtime_disabled" }

// After:
| { ok: false; reason: "cloud_consent_required" | "runtime_disabled" | "lane_policy_denied" }
```

**`lane_policy_denied`:** the requested lane is blocked by workspace policy (D1.4: delegate tried to use managed lane without owner opt-in). The caller should surface this as a permission message, not a consent prompt.

### 2.2 `createMockModelRuntimeAdapter()` update

The mock is updated to return `{ ok: false, reason: 'lane_policy_denied' }` when `lane === 'direct_provider'` AND the auth context marks the actor as a delegate (represented by a convention in tests — see implementation for details).

---

## 3. Metering-boundary and lane-mapping summary (D1.2 × D2.4)

| `runtimeLaneSchema` value | Brief §4 concept | Metered? | Billing principal | Invoked by |
| --- | --- | --- | --- | --- |
| `local` | In-browser (WebGPU) + Companion | No | — | Client-side only (D2.3 hard constraint) |
| `self_hosted` | Self-hosted endpoint | No | Org | Org's own infra |
| `enterprise` | Enterprise endpoint | No | Org contract | Org's own infra |
| `openrouter` | BYO key (OpenRouter / direct provider) | No | User (own contract) | Provider |
| `direct_provider` | Managed cloud (cheap/premium) | **Yes** | **Workspace owner** (D1.2) | Cloud gateway |
| `disabled` | No lane / embeddings-only fallback | No | — | — |

---

## 4. What Phase 2+ builds on this

- **Phase 2 (loopback security core):** the companion's loopback endpoint sets `companionAvailable = true` in `LaneCapabilities` only after the per-session bearer token + Host/Origin checks pass. `selectLane` then routes to `local`.
- **Phase 3 (OAuth):** the companion's JWT (stored in OS keychain) is attached to all gateway/canister requests. The lane selection itself is independent of auth.
- **Phase 10 (Scooling wiring):** the concrete `KnowtationModelRuntimeAdapter` class calls `selectLane → enforceConsentPolicy → route to provider` and emits an `ObservabilityEvent` with `estimatedCostCents > 0` only when `isManagedLane(lane)` is true.

---

## 5. Threat model and security properties (invariants under test)

| Property | Test tier | Mechanism |
| --- | --- | --- |
| `orgPrivacyMode` never routes to managed | Security / Unit | `selectLane` invariant |
| Delegate cannot use managed without owner opt-in | Security / Unit | `enforceConsentPolicy` `lane_policy_denied` |
| **Delegate companion/BYO cannot enrich owner notes without owner opt-in (D1.3(2))** | **Security / Unit / E2E** | **`enforceConsentPolicy` `lane_policy_denied`, fail-closed** |
| Private data cannot reach managed without consentId | Security / Unit | `enforceConsentPolicy` `cloud_consent_required` |
| Policy denial is not fixable by supplying a consentId | Security | Order of checks in `enforceConsentPolicy` |
| Unknown capability fields default to false (fail-closed) | Security / Unit | `Object.assign` with false defaults |
| Pure functions have no side effects (no env, no I/O) | Data integrity | No `process.env` reads inside functions |
| selectLane is deterministic | Data integrity | Same inputs → same output across 10 000 calls |

---

## 6. Deferred

- The `keepOnDevice` flag when no local compute exists does NOT cause `selectLane` to return `disabled` — it falls through to `direct_provider` and the consent gate applies. A higher-level UX layer (not in this module) is responsible for detecting this mismatch and showing "no on-device compute available; cloud requires consent" messaging. That UX wiring is Phase 5+ (companion shell).
- Abuse/quota enforcement on the managed lane (gate §11) — deferred, not part of this module.
- Consent record persistence / retention (gate §11) — deferred.
