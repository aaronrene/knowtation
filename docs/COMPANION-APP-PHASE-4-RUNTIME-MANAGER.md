# Companion App — Phase 4: Bundled Runtime Manager (Decision Core)

**Status:** accepted design + implementation (pure decision core; **no runtime spawned, no download performed, no socket bound**).
**Branch:** `feat/companion-app` (Muse-canonical; not a docs-only PR to `main`).
**Phase table ref:** Gate §12, Phase 4 — ⚡ Sonnet/auto. "Well-specified engineering once the seams exist."
**Security exception:** the model-download INTEGRITY path (supply-chain verification) was treated with extra rigour per the session brief — see §1 (adversarial/threat note).
**Depends on:** Phase 0 Decision Record (gate §13, D1–D3 accepted), Phase 1 (`lib/model-runtime-lane.mjs`), Phase 2 (`lib/companion-loopback-guard.mjs`), Phase 3 (`lib/companion-oauth-pkce.mjs`, `lib/companion-token-custody.mjs`).
**Upstream:** [`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md) §7 (packaging/distribution), §4.6 (no ambient authority), §10 (7-tier test obligations); [`COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md`](COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md) §2 (companion = bridge + bundled runtime), §3 (client-side constraint).

---

## Simple summary

The companion app (Phase 5+) will bundle a local AI model (like Ollama or llama.cpp) that runs entirely on your machine. Before that bundled runtime ever starts, this phase builds the **rules engine** that controls its entire life:

- **Download safety:** before any model file is executed, we verify its SHA-256 fingerprint and exact size against a known-good record. A tampered or corrupted model is silently rejected — the runtime never starts on unverified bytes.
- **Lifecycle gate:** the runtime goes through clearly defined states (stopped → starting → ready → draining → stopped). The only state that allows inference is `ready`. Every other state is a hard block.
- **Backpressure:** if too many AI requests pile up at once, the rules engine starts saying "queue this" (capacity full) or "reject this" (queue full too). Nothing overflows.
- **Resource ceiling:** if the runtime starts eating too much RAM, VRAM, or CPU, new requests are refused until the pressure drops.

Critically, Phase 4 builds these rules as **pure, I/O-free functions** — no real runtime is spawned, no file is downloaded, no socket is opened. Phase 5 (a separately approved bind gate) will wire the real Ollama/llama.cpp spawn, the real TLS download, and the real OS resource probe into this decision core via injected adapters.

## Technical summary

Phase 4 delivers **`lib/companion-runtime-manager.mjs`** — a pure, I/O-free decision core for the bundled runtime manager — and a **7-tier test suite** (219 cases, all green).

The module enforces gate §4 item 6 ("no ambient authority") structurally: it imports no vault, canister, keychain, or auth module. Its sole output interface is decision verdicts. The injected adapter interface (`RuntimeAdapterFns`) is typed to model-lifecycle operations only; no data path exists through this seam.

This scope is deliberate and gate-compliant. The gate's ["DOES NOT approve (no code)"](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md) list forbids *"shipping any companion binary, tray helper, installer, auto-updater, or bundled runtime"* and *"opening any new local HTTP listener."* Phase 4 ships none of these. The actual spawn, download, and bind are Phase 5's responsibility and require an explicit gate.

---

## 1. Adversarial / threat note

### (a) SUPPLY-CHAIN — tampered/poisoned model file

**Threat.** A network-layer attacker (MITM, compromised CDN mirror, DNS hijack on the download host) can substitute a malicious model binary. Even with TLS, a compromised upstream server can serve a malicious file with a valid cert. A poisoned model binary runs arbitrary computation inside the companion process, with access to the same OS session as the real model.

**Controls (built into Phase 4):**
- The model spec carries `expectedDigest` (SHA-256 hex, lowercase, 64 chars exactly) AND `expectedSizeBytes`. Both must match before any execution path is permitted.
- Source URL is checked against an explicit `allowedSourceUrls` allowlist AND must be `https:` scheme. **HTTP is structurally banned**: a model spec specifying an HTTP source is rejected at spec-validation time, not at download time.
- The integrity accumulator (`createIntegrityAccumulator`) feeds every downloaded byte to a SHA-256 hash and accumulates `receivedBytes`. `finalize()` uses **constant-time comparison** for the digest (double-SHA-256 via `crypto.timingSafeEqual` to avoid length/content timing oracles) and an exact numeric equality check for size.
- **Fail-closed on every ambiguous spec field**: missing digest, empty allowlist, zero expected size, unrecognised scheme → reject before any download starts.
- The reason strings returned by integrity verdicts are fixed constants — no model path, URL, or digest value ever appears in a reason string.

### (b) RESOURCE EXHAUSTION — inference flood → OOM

**Threat.** A caller (or a runaway application loop) can enqueue unbounded inference requests, exhausting device RAM/VRAM and killing the user's system.

**Controls (built into Phase 4):**
- `maxInFlight` cap: `evaluateAdmission` returns a hard `at_capacity` denial when `inFlight >= maxInFlight`.
- `queueBound` cap: queued (pending) requests are bounded. A `queue_full` rejection is returned when `queued >= queueBound`. The queue cannot grow without bound.
- Resource-limit policy: `evaluateResourceLimits` rejects when any ceiling is exceeded. Phase 5's injected resource probe supplies the real observation; Phase 4's pure evaluator enforces the ceiling.
- `evaluateRuntimeRequest` is the single admission gate: it checks lifecycle, admission, and resource limits in order. **All three gates must pass** before a request proceeds.

### (c) AMBIENT AUTHORITY — runtime must never reach vault/canister/JWT

**Threat.** The companion runtime, if misconfigured or compromised, could pivot from inference to data exfiltration through a shared authority handle.

**Controls (structural):**
- The module exports only decision and lifecycle functions. It has no imports of any vault, canister, keychain, or auth module.
- The injected adapter interface (`RuntimeAdapterFns`) carries only: `spawn`, `download`, `healthCheck`, `statResources`. No vault accessor, no JWT emitter, no session reader.
- Even if Phase 5's real adapter is compromised, it cannot reach data through this seam because the seam is typed to model-lifecycle operations only.
- No model path, binary path, or download URL appears in any reason string or verdict output.

---

## 2. Module contract — `lib/companion-runtime-manager.mjs`

### 2.1 Design constraints (security invariants)

- **PURE.** No I/O, no `process.env` reads, no `child_process`, no network, no filesystem, no logging, no clock reads. Every input is passed explicitly.
- **FAIL-CLOSED.** Any missing, malformed, ambiguous, or unrecognised input → DENY. No fail-open branch exists.
- **NO AMBIENT AUTHORITY.** No vault, canister, keychain, or auth import. The injected adapter interface is the only I/O boundary.
- **NO SECRET IN OUTPUT.** All reason codes are fixed `RUNTIME_MANAGER_REASONS` constants. No model path, download URL, SHA-256 digest, or access token appears in any reason, return value, or thrown error.
- **SUPPLY-CHAIN INTEGRITY.** A model file MUST pass SHA-256 + size verification via the integrity accumulator BEFORE the lifecycle can transition to `ready` and before `canServeInference` returns `true`.

### 2.2 `RUNTIME_MANAGER_REASONS`

A frozen object of fixed string reason codes. Every returned `{ ok, reason }` verdict uses a value from this object. The codes are:

```
Integrity: ok | malformed_spec | source_not_allowed | scheme_not_allowed |
           size_mismatch | digest_mismatch | accumulator_finalized | accumulator_aborted

Lifecycle: invalid_transition | not_ready | unknown_event | unknown_state

Admission: malformed_admission_state | at_capacity | queue_full | no_in_flight_to_complete

Resources: malformed_limits | malformed_observation | ram_over_limit | vram_over_limit | cpu_over_limit

Top-level: malformed_request_params
```

### 2.3 Supply-chain integrity — `createIntegrityAccumulator` (streaming)

**Signature:**
```js
createIntegrityAccumulator({ expectedDigest, expectedSizeBytes, sourceUrl, allowedSourceUrls })
  → { update(chunk: Uint8Array), finalize(): IntegrityVerdict, getReceivedBytes(): number, abort() }
```

Creates a streaming SHA-256 accumulator. `update(chunk)` feeds each received chunk. `finalize()` verifies the total size (exact byte count) and the SHA-256 digest using constant-time comparison. The accumulator is single-use: after `finalize()` or `abort()`, further calls return a fixed reason.

**Throws** (fail at creation time) if the spec or source URL fails validation.

**PHASE 5 OBLIGATION:** `finalize().ok` MUST be `true` before Phase 5 calls `transitionLifecycle(state, 'start')`. If `finalize().ok` is `false`, the downloaded file must be deleted and execution refused.

### 2.4 Supply-chain integrity — `verifyModelBytes` (in-memory)

**Signature:**
```js
verifyModelBytes({ fileData, expectedDigest, expectedSizeBytes, sourceUrl, allowedSourceUrls })
  → IntegrityVerdict
```

Verifies an already-downloaded model held entirely in memory. Suitable for small models and testing. For large models, Phase 5 should use `createIntegrityAccumulator` with streaming.

### 2.5 Source validation

- `validateSourceUrl(url, allowedUrls)` → `{ ok, reason }` — validates scheme (`https:` only) and allowlist membership. Fail-closed.
- `validateIntegritySpec(expectedDigest, expectedSizeBytes)` → `{ ok, reason }` — validates the 64-char lowercase hex digest and positive integer size.
- `ALLOWED_SOURCE_SCHEMES` = `new Set(['https:'])` — HTTP is banned structurally.

### 2.6 Lifecycle state machine

**States:** `stopped | starting | ready | draining`

**Valid transitions:**
```
stopped   + start       → starting
starting  + health_ok   → ready
starting  + health_fail → stopped
ready     + drain       → draining
draining  + stopped     → stopped
```

Every other `(state, event)` pair is **invalid** → `{ ok: false, reason: 'invalid_transition' }`.

**Key functions:**
- `createLifecycleState()` → initial `{ state: 'stopped' }`.
- `transitionLifecycle(currentState, event)` → `{ ok, newState, reason? }`. Pure; input not mutated.
- `canServeInference(state)` → `boolean`. Returns `true` **ONLY** for `state.state === 'ready'`. Branchless, no coercion.

**Security invariant:** The only path to `ready` is `stopped → starting → ready` via a successful `health_ok` after a `start`. There is no direct `stopped → ready` transition. Phase 5's health-check loop drives this.

### 2.7 Backpressure / concurrency admission

**Types:**
```
AdmissionState: { maxInFlight, queueBound, inFlight, queued }
```

**Key functions:**
- `createAdmissionState({ maxInFlight, queueBound })` — fails-closed on non-positive integer params.
- `evaluateAdmission(state)` → `{ ok: true }` (slot free) | `{ ok: false, reason: 'at_capacity' }` (full, can queue) | `{ ok: false, reason: 'queue_full' }` (both full, reject).
- `recordInFlight(state)` → new state (increments `inFlight`). Pure; input not mutated.
- `recordCompletion(state)` → new state (decrements `inFlight`). Throws if `inFlight <= 0`.
- `recordQueued(state)` / `recordDequeued(state)` → new state (queue counter management).

**Backpressure contract:** `evaluateRuntimeRequest` does NOT side-effect the admission state. The caller calls `evaluateAdmission`, and only if `ok === true`, advances to `recordInFlight` before dispatching.

### 2.8 Resource-limit policy

**Types:**
```
ResourceLimits:      { maxRamBytes, maxVramBytes, maxCpuPercent }
ResourceObservation: { ramBytes, vramBytes, cpuPercent }
```

**Key functions:**
- `createResourceLimits({ maxRamBytes, maxVramBytes, maxCpuPercent })` — all must be positive finite numbers; `maxCpuPercent` must be in `(0, 100]`. Throws on violation.
- `evaluateResourceLimits(observation, limits)` → `{ ok, reason }`. Checks RAM first, then VRAM, then CPU. Fail-closed on malformed inputs. The numeric observation values never appear in the returned reason string.

### 2.9 Top-level admission gate — `evaluateRuntimeRequest`

**Signature:**
```js
evaluateRuntimeRequest({ lifecycleState, admissionState, resourceObservation, resourceLimits })
  → { ok: boolean, reason: string }
```

**Evaluation order (must not be reordered):**
1. **Lifecycle gate** — `canServeInference(lifecycleState)` → if false, `NOT_READY`.
2. **Admission gate** — `evaluateAdmission(admissionState)` → if not ok, propagate reason.
3. **Resource-limit gate** — `evaluateResourceLimits(resourceObservation, resourceLimits)` → if not ok, propagate reason.

**Security:** Never throws on any input (try/catch converts any unexpected error to `MALFORMED_REQUEST_PARAMS`). The returned verdict has exactly two fields: `ok` and `reason`. No secret, path, or numeric value from inputs appears in the output.

### 2.10 Injected adapter interface (`RuntimeAdapterFns`)

Documented as JSDoc typedef in the module; no implementation is provided in Phase 4:

```js
@typedef RuntimeAdapterFns {
  spawn(opts: SpawnOpts): Promise<SpawnHandle>
  download(url: string, onChunk: (chunk: Uint8Array) => void): Promise<void>
  healthCheck(handle: SpawnHandle): Promise<boolean>
  statResources(): Promise<ResourceObservation>
}
```

**Security:** the adapter interface carries **no vault accessor, no JWT emitter, no session reader**. Phase 5 must honour this boundary when implementing the real adapter.

---

## 3. Lifecycle/integrity interaction — the single path to `ready`

```
Phase 5 orchestration (pseudocode; all pure calls):

1. spec = registry.lookup(modelId)
   validateSourceUrl(spec.url, config.allowedSourceUrls)    // fail-closed
   validateIntegritySpec(spec.digest, spec.sizeBytes)       // fail-closed

2. acc = createIntegrityAccumulator({ ...spec })
   await adapter.download(spec.url, chunk => acc.update(chunk))
   verdict = acc.finalize()
   if (!verdict.ok) → delete downloaded file; STOP. lifecycle stays 'stopped'.

3. lifecycle = transitionLifecycle(lifecycle, 'start')      // stopped → starting
   handle = await adapter.spawn({ binaryPath, modelPath, port, maxRamBytes })

4. healthy = await adapter.healthCheck(handle)              // with retry loop
   lifecycle = transitionLifecycle(lifecycle,
     healthy ? 'health_ok' : 'health_fail')

5. if (lifecycle.state !== 'ready') → STOP.                // never serves

6. // Per-request gate:
   decision = evaluateRuntimeRequest({ lifecycleState: lifecycle, admissionState, ... })
   if (!decision.ok) → return busy/capacity-exceeded to caller
   admissionState = recordInFlight(admissionState)
   // ... dispatch to runtime ...
   admissionState = recordCompletion(admissionState)

7. // Shutdown:
   lifecycle = transitionLifecycle(lifecycle, 'drain')      // ready → draining
   await handle.kill()
   lifecycle = transitionLifecycle(lifecycle, 'stopped')    // draining → stopped

8. // Phase 1 seam: companionAvailable = canServeInference(lifecycle)
   //   Set to true ONLY when lifecycle.state === 'ready' (step 4 onward).
   //   Set back to false when drain/stop are triggered (step 7).
```

**Phase 1 seam:** `companionAvailable` in `LaneCapabilities` (`lib/model-runtime-lane.mjs`) is set to `true` by Phase 5 **only** when `canServeInference(lifecycle)` returns `true`. This is the seam the Phase 1 design specified: Phase 5 is the authority that sets this field after a runtime health-check passes.

---

## 4. Backpressure and resource enforcement rules

### Backpressure

| State | `evaluateAdmission` result | Phase 5 action |
|---|---|---|
| `inFlight < maxInFlight` | `ok: true` | Dispatch immediately; call `recordInFlight`. |
| `inFlight >= maxInFlight` AND `queued < queueBound` | `at_capacity` | Enqueue; call `recordQueued`. When a slot opens (`recordCompletion`), dequeue, `recordDequeued`, `recordInFlight`, dispatch. |
| `inFlight >= maxInFlight` AND `queued >= queueBound` | `queue_full` | Reject with 503 (runtime busy). Do not enqueue. |

The admission state is **immutable in this module**. Phase 5 maintains the mutable reference and advances it by replacing it with the return value of `recordInFlight`/`recordCompletion`/`recordQueued`/`recordDequeued`.

### Resource limits

Phase 5 calls `adapter.statResources()` before each `evaluateRuntimeRequest` call to get the current `ResourceObservation`. Recommended: cache the observation for at most 500ms to avoid stat syscall overhead on every inference request.

If `evaluateResourceLimits` returns `RAM_OVER_LIMIT` or `VRAM_OVER_LIMIT`, Phase 5 may trigger a graceful drain (`LIFECYCLE_EVENTS.DRAIN`) and restart with a lower `maxRamBytes` CLI flag.

---

## 5. What Phase 5 must do to bind the runtime safely

The pure decision core (Phase 4) is the bouncer. Phase 5 (companion shell) installs the door. Binding the runtime process is the single most security-critical action and **requires an explicit Phase 5 gate**. When Phase 5 binds, it MUST:

### 5.1 Model download and integrity (supply-chain gate)

1. **Validate the model spec** before starting the download: `validateSourceUrl` + `validateIntegritySpec`. Reject immediately on any failure.
2. **Create the accumulator** before the download begins. Feed every received byte to `acc.update(chunk)` via the `onChunk` callback.
3. **`acc.finalize()` MUST return `ok: true`** before the model file is executed or the lifecycle is started. On `ok: false`: delete the downloaded file, log only the fixed `reason` code, and refuse to call `transitionLifecycle(state, 'start')`.
4. **Use streaming download** via the injected `adapter.download` to avoid loading multi-GB model files into memory entirely. The accumulator is designed for streaming (1 byte at a time is correct).

### 5.2 Runtime spawn

5. **Spawn only after integrity passes.** Call `adapter.spawn({ binaryPath, modelPath, port, maxRamBytes })` using the **verified** model path.
6. **Bind to `127.0.0.1` only** (per Phase 2 §4.5). Pass the loopback bind flag to Ollama/llama.cpp's CLI.
7. **Allocate a non-predictable ephemeral port** (same principle as Phase 2 loopback guard port).
8. **Wire the Phase 2 loopback guard** around the spawned runtime's port — the guard from `lib/companion-loopback-guard.mjs` sits in front of the runtime. The runtime is what admitted requests reach (Phase 2 §6).

### 5.3 Health-check loop

9. **Run the health-check retry loop** after spawn. For Ollama: `GET /api/tags`; for llama.cpp: `GET /health` or `GET /v1/models`.
10. **Call `transitionLifecycle(lifecycle, 'health_ok')` on first success.** After this, `canServeInference(lifecycle)` returns `true` — Phase 5 may then set `companionAvailable = true` in the `LaneCapabilities` it supplies to `selectLane` (Phase 1 seam).
11. **On repeated failure, call `transitionLifecycle(lifecycle, 'health_fail')`.** This returns the lifecycle to `stopped`. The runtime process should be killed. Phase 5 may retry from the `start` event with exponential backoff.

### 5.4 Per-request gate

12. **Before every inference request:** call `adapter.statResources()` to get the current `ResourceObservation`, then call `evaluateRuntimeRequest(...)`. On `ok: false`, return the appropriate error to the caller; do not forward to the runtime.
13. **Advance admission state** by calling `recordInFlight(admissionState)` before dispatching, and `recordCompletion(admissionState)` when the response completes.

### 5.5 Wire shape the runtime must speak

The bundled runtime must speak the **OpenAI-compatible HTTP wire format** on `http://127.0.0.1:<port>`:
- `POST /v1/chat/completions` with `{ model, messages, max_tokens }` body — used by `callOpenAiCompat` in `lib/daemon-llm.mjs`.
- `GET /v1/models` or `GET /api/tags` (Ollama) for the health-check round-trip.

This is the same wire shape already used by `lib/daemon-llm.mjs` and `lib/llm-complete.mjs` (Ollama provider). Phase 5 can reuse those call paths with `base_url = 'http://127.0.0.1:<port>'`.

### 5.6 Minimal logging (§4.8 gate control)

14. **Log only verdict `reason` codes** from `evaluateRuntimeRequest` and `transitionLifecycle`. Never log: model path, binary path, download URL, SHA-256 digest, per-session token, JWT, or inference request body.
15. **The Phase 2 loopback guard** handles auth logging for the endpoint — Phase 5's runtime listener delegates to it.

### 5.7 No ambient authority

16. The runtime adapter interface (`RuntimeAdapterFns`) must be implemented with **no reference to vault, canister, JWT, or keychain handles**. The adapter is scoped to: spawn a process, download a file, probe health, probe resources. Any authority expansion requires a new gate.

---

## 6. Test obligations satisfied (gate §10, 7 tiers)

All under `test/companion-runtime-manager-*.test.mjs` (219 cases, all green):

| Tier | File | Focus |
|---|---|---|
| **Unit** | `…-unit.test.mjs` | Each exported function in isolation; all lifecycle transitions (valid + invalid); integrity spec/source validation; admission bounds; resource limit evaluations; `evaluateRuntimeRequest` gate ordering. |
| **Integration** | `…-integration.test.mjs` | Combined flows: integrity → lifecycle cold-start; health-fail path; drain sequence; admission cycling; resource + admission combined; streaming accumulator vs. in-memory parity. |
| **End-to-end** | `…-e2e.test.mjs` | Realistic full session with stub adapters: download → verify → start → serve → drain. Failure branches: integrity failure, health-check failure, resource exhaustion, draining rejects new inference. |
| **Stress** | `…-stress.test.mjs` | 10k lifecycle round-trips; backpressure trips at exact `maxInFlight` (100) and `queueBound`; 50k admission evaluations; 100KB integrity accumulator with 1000 chunks; 1-byte corruption detection; 20k resource limit evaluations; 10k `evaluateRuntimeRequest` calls. |
| **Data-integrity** | `…-data-integrity.test.mjs` | Determinism (1000 calls per function); no input mutation; all reasons in `RUNTIME_MANAGER_REASONS`; `canServeInference` strictly state-gated; lifecycle transition table completeness + soundness (all valid + all invalid combinations). |
| **Performance** | `…-performance.test.mjs` | 10k `evaluateRuntimeRequest` < 500ms; mean < 0.05ms; 50k `evaluateAdmission` < 500ms; 10k lifecycle round-trips < 200ms; 100KB 1-byte-chunk accumulation < 500ms; 1MB 4KB-chunk accumulation < 200ms. |
| **Security** | `…-security.test.mjs` | **Centerpiece:** wrong/missing digest rejects before execution; accumulator rejects corrupted data (1-bit flip); oversized download rejected; HTTP source banned at spec-validation time; foreign-source URL rejected; empty allowlist fail-closed; lifecycle gate blocks all non-ready states; backpressure trips at exact bound (100 in-flight); 1000-request flood blocked when not ready; RAM/VRAM/CPU over-limit rejected; no ambient authority in exports; evaluateRuntimeRequest verdict has only `{ ok, reason }` (no embedded data); no secret/URL/digest in any reason string; constant-time comparison (5× timing ratio bound); global fail-closed posture (null/undefined on all inputs). |

---

## 7. Deferred (explicitly not Phase 4)

- **Real `child_process.spawn`** of Ollama/llama.cpp — Phase 5 (bind gate).
- **Real TLS download** over HTTPS — Phase 5 (the injected `adapter.download`).
- **OS resource probe** (`adapter.statResources()` — real `process.memoryUsage()`, `/proc/meminfo`, or `nvidia-smi`) — Phase 5.
- **OS-keychain read** of the per-session loopback token (needed to compare with Phase 2 guard's `expectedToken`) — Phase 5.
- **Phase 1 seam activation:** setting `companionAvailable = true` in the live `LaneCapabilities` object — Phase 5 (it calls `canServeInference(lifecycle)` after `health_ok`).
- **Binary bundling, code signing, notarization, auto-update** — Phase 7 (distribution gate).
- **Multi-device fallback** (phone has no companion → embeddings-only) — Phase 8.
- **Scooling `ModelRuntimeAdapter` wiring** — Phase 10.

---

## 8. Remaining blockers to Phase 5

With Phase 4 complete, the decision core is fully built and tested. The remaining blockers to Phase 5 (companion app shell — the first phase that opens any socket or spawns any process) are:

| Blocker | Description |
|---|---|
| **G1 — Server-side OAuth gate** | The companion's `client_id` must be registered with the hosted Knowtation OAuth provider. Phase 3's pure PKCE core is ready; the server-side registration is the remaining external dependency. Without a registered `client_id`, the Phase 5 companion cannot complete the PKCE flow against the real authorization server. |
| **G2 — Phase 5 bind-gate design** | An explicit Phase 5 gate document must specify: (a) the socket bind contract (loopback, ephemeral port — per Phase 2 §6), (b) the OAuth loopback redirect listener bind, (c) the real OS-keychain adapter (Keychain/DPAPI/libsecret), (d) the real `child_process.spawn` adapter for Ollama/llama.cpp, (e) the real download adapter over TLS, (f) the real resource probe adapter. Phase 5 is where all deferred I/O from Phases 2, 3, and 4 converges into a single companion process. |

**Recommended order:**

1. **G1 first (OAuth gate)** — it is a server-side configuration decision that does not require any code, and it unblocks the real auth round-trip for the Phase 5 companion.
2. **G2 second (Phase 5 bind-gate design)** — design the Phase 5 shell with a thinking model (it converges Phase 2's socket bind, Phase 3's redirect listener, and Phase 4's spawn/download), then implement with Sonnet/auto once the seam contract is fixed.

Both G1 and G2 must be resolved before any companion binary is shipped (gate §12 Phase 5).
