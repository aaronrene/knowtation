/**
 * Companion App — Runtime Manager DECISION CORE.
 *
 * Phase 4 of the Companion App build plan (feat/companion-app).
 * See docs/COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md for the accepted design, the adversarial
 * threat model, and the Phase 5 obligations to spawn the real runtime and perform the real
 * verified download behind the shared bind gate.
 *
 * WHAT THIS MODULE IS
 *   The companion app (Phase 5+) bundles a local AI inference runtime (Ollama / llama.cpp).
 *   This module is the DECISION CORE for managing that runtime's lifecycle:
 *     - Supply-chain integrity: verify a downloaded model file before it is ever executed.
 *     - Lifecycle state machine: stopped → starting → ready → draining → stopped.
 *     - Backpressure / concurrency admission: queue bound, max-in-flight.
 *     - Resource-limit policy: RAM/VRAM/CPU ceilings; reject when over.
 *
 * DESIGN CONSTRAINTS (read before modifying — these are security invariants):
 *   - PURE. No I/O, no process.env reads, no child_process, no network, no filesystem,
 *     no logging, no clock reads. Every input is passed explicitly. The actual spawn of
 *     Ollama/llama.cpp, the real model download over TLS, and OS resource probing are
 *     deferred to Phase 5 via the INJECTED adapter interface (RuntimeAdapterFns).
 *   - FAIL-CLOSED. Any missing, malformed, ambiguous, or unrecognised input → DENY.
 *     There is no fail-open branch anywhere in this module.
 *   - NO AMBIENT AUTHORITY. The module imports no vault, canister, keychain, or auth module.
 *     The injected adapter interface is typed to model-lifecycle operations only.
 *   - NO SECRET IN OUTPUT. Reason codes are fixed constants. No model path, download URL,
 *     binary path, SHA-256 digest value, or access token ever appears in a reason string,
 *     a return value, or a thrown error.
 *   - SUPPLY-CHAIN INTEGRITY. A model file MUST pass SHA-256 digest + size verification
 *     via the integrity accumulator BEFORE canServeInference returns true for the first time.
 *     Phase 5 is responsible for calling finalize() and gating execution on { ok: true }.
 *
 * Hard constraint from docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md §4 item 6:
 *   "No ambient authority. The endpoint exposes only model inference; it never exposes vault
 *   read/write, the canister client, or the stored JWT."
 *
 * Gate §12 Phase 4 obligations (remaining for Phase 5):
 *   - Spawn Ollama/llama.cpp (real child_process) after integrity is verified.
 *   - Perform the real model download over TLS using the injected download adapter.
 *   - Call the OS resource probe (injected stat adapter) to supply ResourceObservation.
 *   - Run the health-check loop and call transitionLifecycle with health_ok/health_fail.
 *   - Set companionAvailable=true in LaneCapabilities ONLY after lifecycle reaches 'ready'.
 *   - Wire the Phase 2 loopback guard BEFORE any model work (Phase 2 boundary stays intact).
 */

import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Reason codes (frozen constants; never derived from input)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed reason codes returned by all decision functions.
 * These are the ONLY strings that may appear as `reason` values in verdicts or decisions.
 * No secret, model path, URL, digest, or caller-controlled value ever appears in a reason.
 * @readonly
 */
export const RUNTIME_MANAGER_REASONS = Object.freeze({
  // Integrity
  OK: 'ok',
  MALFORMED_SPEC: 'malformed_spec',
  SOURCE_NOT_ALLOWED: 'source_not_allowed',
  SCHEME_NOT_ALLOWED: 'scheme_not_allowed',
  SIZE_MISMATCH: 'size_mismatch',
  DIGEST_MISMATCH: 'digest_mismatch',
  ACCUMULATOR_FINALIZED: 'accumulator_finalized',
  ACCUMULATOR_ABORTED: 'accumulator_aborted',

  // Lifecycle
  INVALID_TRANSITION: 'invalid_transition',
  NOT_READY: 'not_ready',
  UNKNOWN_EVENT: 'unknown_event',
  UNKNOWN_STATE: 'unknown_state',

  // Admission
  MALFORMED_ADMISSION_STATE: 'malformed_admission_state',
  AT_CAPACITY: 'at_capacity',
  QUEUE_FULL: 'queue_full',
  NO_IN_FLIGHT_TO_COMPLETE: 'no_in_flight_to_complete',

  // Resource limits
  MALFORMED_LIMITS: 'malformed_limits',
  MALFORMED_OBSERVATION: 'malformed_observation',
  RAM_OVER_LIMIT: 'ram_over_limit',
  VRAM_OVER_LIMIT: 'vram_over_limit',
  CPU_OVER_LIMIT: 'cpu_over_limit',

  // Top-level request gate
  MALFORMED_REQUEST_PARAMS: 'malformed_request_params',
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Supply-chain integrity verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * URL schemes permitted as model download sources.
 * HTTP is structurally banned — a model spec specifying an HTTP source is rejected at
 * spec-validation time, not at download time. This prevents a misconfigured registry from
 * silently serving models over a cleartext channel.
 * @type {ReadonlySet<string>}
 */
export const ALLOWED_SOURCE_SCHEMES = new Set(['https:']);

/**
 * The exact byte length of a valid SHA-256 hex digest string (64 lowercase hex chars).
 * @type {number}
 */
export const SHA256_HEX_LENGTH = 64;

/**
 * Validate that a download source URL is (a) a valid URL, (b) uses an allowed scheme
 * (HTTPS only), and (c) matches the caller-supplied allowlist.
 *
 * Fail-closed: any invalid URL, non-HTTPS scheme, empty allowlist, or allowlist miss → deny.
 * The source URL itself is NEVER copied into the returned reason string.
 *
 * @param {unknown} url          - The model download URL to validate.
 * @param {unknown} allowedUrls  - Explicit allowlist of permitted base URLs (string[]).
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateSourceUrl(url, allowedUrls) {
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_SPEC };
  }
  if (!Array.isArray(allowedUrls) || allowedUrls.length === 0) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.SOURCE_NOT_ALLOWED };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_SPEC };
  }
  if (!ALLOWED_SOURCE_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.SCHEME_NOT_ALLOWED };
  }
  // Allowlist match: the source URL must start with one of the allowed base URL strings.
  // We normalise to lowercase and strip trailing slashes for comparison.
  const normalised = url.toLowerCase();
  const matched = allowedUrls.some((allowed) => {
    if (typeof allowed !== 'string' || allowed.length === 0) return false;
    return normalised.startsWith(allowed.toLowerCase().replace(/\/$/, ''));
  });
  if (!matched) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.SOURCE_NOT_ALLOWED };
  }
  return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
}

/**
 * Validate a model integrity spec (expectedDigest + expectedSizeBytes) without performing
 * any I/O. Called at model-spec registration time to catch malformed registry entries early.
 *
 * @param {unknown} expectedDigest     - Lowercase SHA-256 hex string (64 chars exactly).
 * @param {unknown} expectedSizeBytes  - Positive integer byte count for the model file.
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateIntegritySpec(expectedDigest, expectedSizeBytes) {
  if (
    typeof expectedDigest !== 'string' ||
    expectedDigest.length !== SHA256_HEX_LENGTH ||
    !/^[0-9a-f]{64}$/.test(expectedDigest)
  ) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_SPEC };
  }
  if (
    !Number.isInteger(expectedSizeBytes) ||
    expectedSizeBytes <= 0
  ) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_SPEC };
  }
  return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
}

/**
 * @typedef {{ ok: boolean, reason: string }} IntegrityVerdict
 */

/**
 * Create a streaming integrity accumulator for a model download.
 *
 * The accumulator feeds every downloaded byte into a SHA-256 hash and tracks received byte
 * count. Call `update(chunk)` for each received chunk, then `finalize()` after the download
 * completes. `finalize()` uses constant-time comparison for the digest (preventing a timing
 * oracle on the expected digest) and an exact numeric equality check for size.
 *
 * SECURITY INVARIANTS:
 *   - `finalize()` MUST be called (and return { ok: true }) before the model is executed.
 *   - Once `finalize()` is called (or the accumulator is aborted), further calls to
 *     `update()` and `finalize()` return a fixed failure reason — the accumulator is a
 *     single-use object.
 *   - Neither the expected digest, the source URL, nor any computed partial digest appears
 *     in any returned reason string (the reasons are fixed RUNTIME_MANAGER_REASONS constants).
 *
 * PHASE 5 OBLIGATION:
 *   Phase 5's download adapter MUST:
 *     1. Create the accumulator BEFORE starting the download.
 *     2. Feed every received byte to `update()` (no skipping, no out-of-order).
 *     3. Call `finalize()` after the download stream ends.
 *     4. If `finalize().ok` is false, delete the downloaded file and REFUSE to transition
 *        the lifecycle out of 'starting' (call `transitionLifecycle(state, 'health_fail')`).
 *     5. Only if `finalize().ok` is true may Phase 5 proceed to the health-check round-trip.
 *
 * @param {{
 *   expectedDigest: string,
 *   expectedSizeBytes: number,
 *   sourceUrl: string,
 *   allowedSourceUrls: string[],
 * }} params
 * @returns {{
 *   update: (chunk: Uint8Array) => void,
 *   finalize: () => IntegrityVerdict,
 *   getReceivedBytes: () => number,
 *   abort: () => void,
 * }}
 * @throws {TypeError} when the spec or source URL fails validation (fail at creation time).
 */
export function createIntegrityAccumulator({ expectedDigest, expectedSizeBytes, sourceUrl, allowedSourceUrls }) {
  const specCheck = validateIntegritySpec(expectedDigest, expectedSizeBytes);
  if (!specCheck.ok) throw new TypeError(`createIntegrityAccumulator: ${specCheck.reason}`);

  const srcCheck = validateSourceUrl(sourceUrl, allowedSourceUrls);
  if (!srcCheck.ok) throw new TypeError(`createIntegrityAccumulator: ${srcCheck.reason}`);

  const hasher = crypto.createHash('sha256');
  let receivedBytes = 0;
  let finalized = false;
  let aborted = false;

  return {
    /**
     * Feed a chunk of downloaded bytes into the accumulator.
     * Must be called in order, for every byte, with no skipping.
     * @param {Uint8Array} chunk
     */
    update(chunk) {
      if (finalized) return; // silently ignore — finalize already called
      if (aborted) return;   // silently ignore — already aborted
      if (!(chunk instanceof Uint8Array) && !Buffer.isBuffer(chunk)) {
        aborted = true;
        return;
      }
      hasher.update(chunk);
      receivedBytes += chunk.length;
    },

    /**
     * Finalize the integrity check. Returns an IntegrityVerdict with ok=true only when
     * the received byte count matches expectedSizeBytes AND the SHA-256 digest matches
     * expectedDigest (constant-time comparison).
     *
     * After finalize() is called (regardless of result), the accumulator is sealed — further
     * updates are no-ops and further finalize() calls return ACCUMULATOR_FINALIZED.
     * @returns {IntegrityVerdict}
     */
    finalize() {
      if (aborted) return { ok: false, reason: RUNTIME_MANAGER_REASONS.ACCUMULATOR_ABORTED };
      if (finalized) return { ok: false, reason: RUNTIME_MANAGER_REASONS.ACCUMULATOR_FINALIZED };
      finalized = true;

      // Size check first (cheap, no timing oracle concern).
      if (receivedBytes !== expectedSizeBytes) {
        return { ok: false, reason: RUNTIME_MANAGER_REASONS.SIZE_MISMATCH };
      }

      // Digest check — constant-time to prevent a timing oracle on the expected digest.
      // Hash both sides to equal-length 32-byte buffers before timingSafeEqual.
      const computedHex = hasher.digest('hex'); // lowercase, 64 chars
      const da = crypto.createHash('sha256').update(computedHex, 'utf8').digest();
      const db = crypto.createHash('sha256').update(expectedDigest, 'utf8').digest();
      if (!crypto.timingSafeEqual(da, db)) {
        return { ok: false, reason: RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH };
      }

      return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
    },

    /**
     * Return the number of bytes received so far (for progress reporting by Phase 5).
     * @returns {number}
     */
    getReceivedBytes() {
      return receivedBytes;
    },

    /**
     * Abort the accumulator (e.g., download cancelled or error mid-stream).
     * After abort(), finalize() returns ACCUMULATOR_ABORTED.
     */
    abort() {
      aborted = true;
    },
  };
}

/**
 * Verify an already-downloaded model file held entirely in memory.
 * Suitable for small models or testing. For large models, Phase 5 should use
 * createIntegrityAccumulator with streaming to avoid loading the full file into RAM.
 *
 * SECURITY: the file data is never returned or logged; only the verdict { ok, reason }.
 *
 * @param {{
 *   fileData: Uint8Array,
 *   expectedDigest: string,
 *   expectedSizeBytes: number,
 *   sourceUrl: string,
 *   allowedSourceUrls: string[],
 * }} params
 * @returns {IntegrityVerdict}
 */
export function verifyModelBytes({ fileData, expectedDigest, expectedSizeBytes, sourceUrl, allowedSourceUrls }) {
  const srcCheck = validateSourceUrl(sourceUrl, allowedSourceUrls);
  if (!srcCheck.ok) return { ok: false, reason: srcCheck.reason };

  const specCheck = validateIntegritySpec(expectedDigest, expectedSizeBytes);
  if (!specCheck.ok) return { ok: false, reason: specCheck.reason };

  if (!(fileData instanceof Uint8Array) && !Buffer.isBuffer(fileData)) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_SPEC };
  }

  if (fileData.length !== expectedSizeBytes) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.SIZE_MISMATCH };
  }

  const computedHex = crypto.createHash('sha256').update(fileData).digest('hex');
  const da = crypto.createHash('sha256').update(computedHex, 'utf8').digest();
  const db = crypto.createHash('sha256').update(expectedDigest, 'utf8').digest();
  if (!crypto.timingSafeEqual(da, db)) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.DIGEST_MISMATCH };
  }

  return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Lifecycle state machine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid lifecycle states for the bundled runtime process.
 * Inference is served ONLY in the 'ready' state (canServeInference enforces this).
 * @readonly
 */
export const LIFECYCLE_STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  READY: 'ready',
  DRAINING: 'draining',
});

/**
 * Lifecycle event names that drive state transitions.
 * @readonly
 */
export const LIFECYCLE_EVENTS = Object.freeze({
  /** Signal: begin cold-start. stopped → starting. */
  START: 'start',
  /** Signal: health-check passed after cold-start. starting → ready. */
  HEALTH_OK: 'health_ok',
  /** Signal: health-check failed during cold-start. starting → stopped. */
  HEALTH_FAIL: 'health_fail',
  /** Signal: begin graceful drain. ready → draining. */
  DRAIN: 'drain',
  /** Signal: drain complete / process exited. draining → stopped. */
  STOPPED: 'stopped',
});

/**
 * @typedef {{ state: string }} LifecycleState
 */

/**
 * Allowed state transitions: Map<fromState, Set<event→toState>>.
 * Any (fromState, event) pair not in this map is an invalid transition → fail-closed.
 *
 * @type {ReadonlyMap<string, ReadonlyMap<string, string>>}
 */
const LIFECYCLE_TRANSITIONS = new Map([
  [
    LIFECYCLE_STATES.STOPPED,
    new Map([[LIFECYCLE_EVENTS.START, LIFECYCLE_STATES.STARTING]]),
  ],
  [
    LIFECYCLE_STATES.STARTING,
    new Map([
      [LIFECYCLE_EVENTS.HEALTH_OK, LIFECYCLE_STATES.READY],
      [LIFECYCLE_EVENTS.HEALTH_FAIL, LIFECYCLE_STATES.STOPPED],
    ]),
  ],
  [
    LIFECYCLE_STATES.READY,
    new Map([[LIFECYCLE_EVENTS.DRAIN, LIFECYCLE_STATES.DRAINING]]),
  ],
  [
    LIFECYCLE_STATES.DRAINING,
    new Map([[LIFECYCLE_EVENTS.STOPPED, LIFECYCLE_STATES.STOPPED]]),
  ],
]);

/**
 * Create the initial lifecycle state (the runtime always starts as stopped).
 * @returns {LifecycleState}
 */
export function createLifecycleState() {
  return { state: LIFECYCLE_STATES.STOPPED };
}

/**
 * Attempt a lifecycle state transition.
 *
 * Pure: the input `state` is never mutated; a new state object is returned on success.
 * Fail-closed: any unrecognised state, unknown event, or invalid (from, event) pair
 * returns { ok: false, reason } and the current state is unchanged.
 *
 * SECURITY: The lifecycle machine is the gate that prevents inference from being served
 * in a non-ready state (e.g. still starting, draining, or stopped). canServeInference
 * reads `state.state === LIFECYCLE_STATES.READY` — this transition function ensures the
 * only path to 'ready' is via a successful health_ok after a start.
 *
 * @param {LifecycleState} currentState
 * @param {string} event           - One of LIFECYCLE_EVENTS values.
 * @returns {{ ok: boolean, newState: LifecycleState, reason?: string }}
 */
export function transitionLifecycle(currentState, event) {
  if (!currentState || typeof currentState !== 'object' || typeof currentState.state !== 'string') {
    return { ok: false, newState: createLifecycleState(), reason: RUNTIME_MANAGER_REASONS.UNKNOWN_STATE };
  }
  if (typeof event !== 'string' || event.length === 0) {
    return { ok: false, newState: currentState, reason: RUNTIME_MANAGER_REASONS.UNKNOWN_EVENT };
  }
  const fromMap = LIFECYCLE_TRANSITIONS.get(currentState.state);
  if (!fromMap) {
    return { ok: false, newState: currentState, reason: RUNTIME_MANAGER_REASONS.UNKNOWN_STATE };
  }
  if (!fromMap.has(event)) {
    return { ok: false, newState: currentState, reason: RUNTIME_MANAGER_REASONS.INVALID_TRANSITION };
  }
  const toState = fromMap.get(event);
  return { ok: true, newState: { state: toState } };
}

/**
 * Returns true ONLY when the runtime is in the 'ready' state and can safely serve inference.
 *
 * SECURITY INVARIANT: inference callers MUST call this function before routing to the runtime.
 * The function is intentionally simple and branchless (no ambiguity) to minimise the risk of
 * an incorrect "truthy" result from a malformed state object.
 *
 * @param {LifecycleState} lifecycleState
 * @returns {boolean}
 */
export function canServeInference(lifecycleState) {
  if (!lifecycleState || typeof lifecycleState !== 'object') return false;
  return lifecycleState.state === LIFECYCLE_STATES.READY;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Backpressure / concurrency admission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AdmissionState
 * @property {number} maxInFlight  - Maximum concurrent inference requests allowed.
 * @property {number} queueBound   - Maximum requests that may be queued (pending admission).
 * @property {number} inFlight     - Current count of admitted (in-progress) requests.
 * @property {number} queued       - Current count of queued (pending) requests.
 */

/**
 * Create a fresh admission state with the given concurrency limits.
 *
 * Fail-closed: maxInFlight and queueBound must be positive integers.
 *
 * @param {{ maxInFlight: number, queueBound: number }} params
 * @returns {AdmissionState}
 * @throws {TypeError} on invalid parameters.
 */
export function createAdmissionState({ maxInFlight, queueBound }) {
  if (!Number.isInteger(maxInFlight) || maxInFlight <= 0) {
    throw new TypeError('createAdmissionState: maxInFlight must be a positive integer');
  }
  if (!Number.isInteger(queueBound) || queueBound <= 0) {
    throw new TypeError('createAdmissionState: queueBound must be a positive integer');
  }
  return { maxInFlight, queueBound, inFlight: 0, queued: 0 };
}

/**
 * Check whether a new inference request may be admitted or queued.
 *
 * Returns:
 *   { ok: true, reason: 'ok' }          — request may proceed immediately (in-flight slot free).
 *   { ok: false, reason: 'at_capacity'} — all in-flight slots full; request must queue.
 *   { ok: false, reason: 'queue_full' } — both in-flight and queue are full; request is rejected.
 *
 * Callers interpret at_capacity as "enqueue and wait" and queue_full as "return busy to caller."
 * Phase 5 orchestrates the queue and calls recordInFlight when a slot opens.
 *
 * Fail-closed: a malformed admissionState returns queue_full (cannot prove capacity exists).
 *
 * @param {AdmissionState} state
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateAdmission(state) {
  if (
    !state ||
    typeof state !== 'object' ||
    !Number.isInteger(state.maxInFlight) || state.maxInFlight <= 0 ||
    !Number.isInteger(state.queueBound) || state.queueBound <= 0 ||
    !Number.isInteger(state.inFlight) || state.inFlight < 0 ||
    !Number.isInteger(state.queued) || state.queued < 0
  ) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_ADMISSION_STATE };
  }

  if (state.inFlight < state.maxInFlight) {
    return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
  }

  if (state.queued < state.queueBound) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.AT_CAPACITY };
  }

  return { ok: false, reason: RUNTIME_MANAGER_REASONS.QUEUE_FULL };
}

/**
 * Record that a new request has been admitted to in-flight (granted a concurrency slot).
 * Returns a NEW admission state (pure; the input is not mutated).
 *
 * Phase 5 calls this when it is about to dispatch the request to the runtime.
 * It is the caller's responsibility to call recordCompletion when the request finishes.
 *
 * @param {AdmissionState} state
 * @returns {AdmissionState}
 * @throws {TypeError} on malformed state.
 */
export function recordInFlight(state) {
  if (!state || typeof state !== 'object' || !Number.isInteger(state.inFlight)) {
    throw new TypeError('recordInFlight: state is malformed');
  }
  return { ...state, inFlight: state.inFlight + 1 };
}

/**
 * Record that an in-flight request has completed (releases the concurrency slot).
 * Returns a NEW admission state (pure; the input is not mutated).
 *
 * @param {AdmissionState} state
 * @returns {AdmissionState}
 * @throws {TypeError} on malformed state or attempt to complete with no in-flight requests.
 */
export function recordCompletion(state) {
  if (!state || typeof state !== 'object' || !Number.isInteger(state.inFlight)) {
    throw new TypeError('recordCompletion: state is malformed');
  }
  if (state.inFlight <= 0) {
    throw new TypeError('recordCompletion: no in-flight requests to complete');
  }
  return { ...state, inFlight: state.inFlight - 1 };
}

/**
 * Record that a new request has been added to the queue (not yet admitted to in-flight).
 * Returns a NEW admission state (pure; the input is not mutated).
 *
 * @param {AdmissionState} state
 * @returns {AdmissionState}
 * @throws {TypeError} on malformed state.
 */
export function recordQueued(state) {
  if (!state || typeof state !== 'object' || !Number.isInteger(state.queued)) {
    throw new TypeError('recordQueued: state is malformed');
  }
  return { ...state, queued: state.queued + 1 };
}

/**
 * Record that a queued request has been dequeued (either admitted or cancelled).
 * Returns a NEW admission state (pure; the input is not mutated).
 *
 * @param {AdmissionState} state
 * @returns {AdmissionState}
 * @throws {TypeError} on malformed state or attempt to dequeue with no queued requests.
 */
export function recordDequeued(state) {
  if (!state || typeof state !== 'object' || !Number.isInteger(state.queued)) {
    throw new TypeError('recordDequeued: state is malformed');
  }
  if (state.queued <= 0) {
    throw new TypeError('recordDequeued: no queued requests to dequeue');
  }
  return { ...state, queued: state.queued - 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Resource-limit policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResourceLimits
 * @property {number} maxRamBytes    - Maximum RAM usage in bytes (> 0).
 * @property {number} maxVramBytes   - Maximum VRAM usage in bytes (> 0; use Infinity if no GPU).
 * @property {number} maxCpuPercent  - Maximum CPU usage 0–100 (exclusive upper bound).
 */

/**
 * @typedef {Object} ResourceObservation
 * @property {number} ramBytes    - Current RAM used by the runtime process in bytes.
 * @property {number} vramBytes   - Current VRAM used (0 if no GPU).
 * @property {number} cpuPercent  - Current CPU percent (0–100).
 */

/**
 * Create and validate resource limits.
 * Fail-closed: all fields must be positive finite numbers; maxCpuPercent must be 0–100.
 *
 * @param {{ maxRamBytes: number, maxVramBytes: number, maxCpuPercent: number }} params
 * @returns {ResourceLimits}
 * @throws {TypeError} on invalid parameters.
 */
export function createResourceLimits({ maxRamBytes, maxVramBytes, maxCpuPercent }) {
  if (!Number.isFinite(maxRamBytes) || maxRamBytes <= 0) {
    throw new TypeError('createResourceLimits: maxRamBytes must be a positive finite number');
  }
  if (!Number.isFinite(maxVramBytes) || maxVramBytes <= 0) {
    throw new TypeError('createResourceLimits: maxVramBytes must be a positive finite number');
  }
  if (!Number.isFinite(maxCpuPercent) || maxCpuPercent <= 0 || maxCpuPercent > 100) {
    throw new TypeError('createResourceLimits: maxCpuPercent must be in (0, 100]');
  }
  return { maxRamBytes, maxVramBytes, maxCpuPercent };
}

/**
 * Evaluate whether the current resource observation is within the configured limits.
 * Returns the FIRST limit violation found (RAM before VRAM before CPU) or ok.
 *
 * Fail-closed: malformed limits or observation → MALFORMED_LIMITS / MALFORMED_OBSERVATION.
 * The actual numeric values of the observation are NEVER returned in the reason string.
 *
 * @param {ResourceObservation} observation  - Current runtime resource usage (from Phase 5 stat adapter).
 * @param {ResourceLimits} limits            - Configured ceilings.
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateResourceLimits(observation, limits) {
  if (
    !limits ||
    typeof limits !== 'object' ||
    !Number.isFinite(limits.maxRamBytes) || limits.maxRamBytes <= 0 ||
    !Number.isFinite(limits.maxVramBytes) || limits.maxVramBytes <= 0 ||
    !Number.isFinite(limits.maxCpuPercent) || limits.maxCpuPercent <= 0
  ) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_LIMITS };
  }
  if (
    !observation ||
    typeof observation !== 'object' ||
    !Number.isFinite(observation.ramBytes) || observation.ramBytes < 0 ||
    !Number.isFinite(observation.vramBytes) || observation.vramBytes < 0 ||
    !Number.isFinite(observation.cpuPercent) || observation.cpuPercent < 0
  ) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_OBSERVATION };
  }

  if (observation.ramBytes > limits.maxRamBytes) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.RAM_OVER_LIMIT };
  }
  if (observation.vramBytes > limits.maxVramBytes) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.VRAM_OVER_LIMIT };
  }
  if (observation.cpuPercent > limits.maxCpuPercent) {
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.CPU_OVER_LIMIT };
  }

  return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Top-level runtime request gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RuntimeDecision
 * @property {boolean} ok        - true only when all gates pass (inference may proceed).
 * @property {string}  reason    - A RUNTIME_MANAGER_REASONS constant. Never a secret.
 */

/**
 * Top-level admission decision for a single inference request against the bundled runtime.
 *
 * Checks, in order:
 *   1. Lifecycle gate: runtime must be in 'ready' state. Non-ready → NOT_READY.
 *   2. Admission gate: in-flight concurrency and queue bounds. AT_CAPACITY / QUEUE_FULL.
 *   3. Resource-limit gate: RAM/VRAM/CPU ceilings. Over limit → reject.
 *
 * ALL THREE gates must pass for the request to be allowed.
 * Fail-closed: malformed parameters → MALFORMED_REQUEST_PARAMS.
 *
 * SECURITY PROPERTIES:
 *   - Inference is NEVER allowed in a non-ready lifecycle state (no timing window between
 *     states that could allow a request through a transitional state).
 *   - Backpressure trips at the exact configured bound — no overflow possible.
 *   - Resource limits are enforced BEFORE the request reaches the runtime, bounding OOM risk.
 *   - No secret, path, URL, or numeric observation value appears in any reason string.
 *   - This function has no side effects — the caller must call recordInFlight on the admission
 *     state when it decides to proceed (pure: decision is separated from state mutation).
 *
 * @param {{
 *   lifecycleState: LifecycleState,
 *   admissionState: AdmissionState,
 *   resourceObservation: ResourceObservation,
 *   resourceLimits: ResourceLimits,
 * }} params
 * @returns {RuntimeDecision}
 */
export function evaluateRuntimeRequest(params) {
  try {
    const { lifecycleState, admissionState, resourceObservation, resourceLimits } = params ?? {};
    if (!lifecycleState || !admissionState || !resourceObservation || !resourceLimits) {
      return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_REQUEST_PARAMS };
    }

    // 1. Lifecycle gate.
    if (!canServeInference(lifecycleState)) {
      return { ok: false, reason: RUNTIME_MANAGER_REASONS.NOT_READY };
    }

    // 2. Admission gate.
    const admission = evaluateAdmission(admissionState);
    if (!admission.ok) {
      return { ok: false, reason: admission.reason };
    }

    // 3. Resource-limit gate.
    const resources = evaluateResourceLimits(resourceObservation, resourceLimits);
    if (!resources.ok) {
      return { ok: false, reason: resources.reason };
    }

    return { ok: true, reason: RUNTIME_MANAGER_REASONS.OK };
  } catch {
    // Defense in depth: never let an unexpected error carry input data outward.
    return { ok: false, reason: RUNTIME_MANAGER_REASONS.MALFORMED_REQUEST_PARAMS };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 — Injected adapter interface (type documentation only; no implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The adapter interface that Phase 5 MUST supply to connect the decision core to the real
 * Ollama/llama.cpp runtime. The pure module in this file imports NONE of these — they are
 * passed explicitly by Phase 5's binding layer.
 *
 * SECURITY INVARIANT: the adapter must not expose vault, canister, keychain, or JWT handles.
 * It is scoped exclusively to model-lifecycle operations (spawn, download, health, resource probe).
 *
 * @typedef {Object} RuntimeAdapterFns
 * @property {(opts: SpawnOpts) => Promise<SpawnHandle>} spawn
 *   Spawn the Ollama/llama.cpp process. Must bind to 127.0.0.1 only (Phase 2 §4.5).
 *   Called ONLY after integrity verification passes (finalize().ok === true).
 * @property {(url: string, onChunk: (chunk: Uint8Array) => void) => Promise<void>} download
 *   Download a model file over TLS, calling onChunk for each received chunk.
 *   The URL MUST be one that passed validateSourceUrl. Phase 5 feeds chunks to the
 *   integrity accumulator via the onChunk callback.
 * @property {(handle: SpawnHandle) => Promise<boolean>} healthCheck
 *   Return true if the runtime responds correctly to a health probe (OpenAI-compat
 *   GET /v1/models or Ollama GET /api/tags). Phase 5 drives the health-check retry loop
 *   and calls transitionLifecycle(state, HEALTH_OK | HEALTH_FAIL).
 * @property {() => Promise<ResourceObservation>} statResources
 *   Return the current RAM/VRAM/CPU usage for the runtime process. Called before each
 *   inference request; result is passed to evaluateResourceLimits.
 */

/**
 * @typedef {Object} SpawnOpts
 * @property {string} binaryPath   - Absolute path to the Ollama/llama.cpp binary.
 * @property {string} modelPath    - Absolute path to the verified model file.
 * @property {number} port         - Ephemeral port allocated by Phase 5 (non-predictable).
 * @property {number} maxRamBytes  - Memory ceiling to pass to the runtime's CLI flags.
 */

/**
 * @typedef {Object} SpawnHandle
 * @property {number} pid  - Process ID of the spawned runtime.
 * @property {() => Promise<void>} kill  - Gracefully shut down the runtime.
 */
