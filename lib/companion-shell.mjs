/**
 * Companion App — Phase 5 orchestration shell.
 *
 * This binding layer composes the Phase 2–4 pure cores with Phase 5 adapters.
 * Authority-bearing objects are held by the authority group; runtime operations
 * receive only inert values such as URLs, paths, ports, and resource limits.
 */

import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  LIFECYCLE_EVENTS,
  canServeInference,
  createIntegrityAccumulator,
  createLifecycleState,
  transitionLifecycle,
  validateIntegritySpec,
  validateSourceUrl,
} from './companion-runtime-manager.mjs';
import { selectLane } from './model-runtime-lane.mjs';

export const COMPANION_SHELL_REASONS = Object.freeze({
  NOT_READY: 'not_ready',
  MANIFEST_UNTRUSTED: 'manifest_untrusted',
  INTEGRITY_FAILED: 'integrity_failed',
  SPAWN_FAILED: 'spawn_failed',
  HEALTH_FAILED: 'health_failed',
  INVALID_GROUP: 'invalid_group',
});

const DEFAULT_HEALTH_RECENCY_MS = 15_000;

/**
 * Build an authority group. Runtime adapters never receive this object.
 * @param {{ keychain?: unknown, oauth?: unknown, manifestFetcher?: Function, canister?: unknown }} params
 */
export function createAuthorityGroup(params = {}) {
  return Object.freeze({
    keychain: params.keychain ?? null,
    oauth: params.oauth ?? null,
    manifestFetcher: params.manifestFetcher ?? null,
    canister: params.canister ?? null,
  });
}

/**
 * Build a runtime group from inert runtime capabilities only.
 * @param {{ spawn: Function, download: Function, healthCheck: Function, statResources?: Function }} params
 */
export function createRuntimeGroup(params = {}) {
  if (
    typeof params.spawn !== 'function' ||
    typeof params.download !== 'function' ||
    typeof params.healthCheck !== 'function'
  ) {
    throw new TypeError(COMPANION_SHELL_REASONS.INVALID_GROUP);
  }
  return Object.freeze({
    spawn: params.spawn,
    download: params.download,
    healthCheck: params.healthCheck,
    statResources: typeof params.statResources === 'function' ? params.statResources : async () => ({ ramBytes: 0, vramBytes: 0, cpuPercent: 0 }),
  });
}

/**
 * Validate that model integrity metadata came from a first-party manifest that is
 * out-of-band from the model host.
 * @param {{ manifestUrl: string, modelUrl: string, expectedDigest: string, expectedSizeBytes: number, allowedSourceUrls: string[] }} spec
 */
export function validateManifestTrustAnchor(spec) {
  try {
    const manifest = new URL(spec?.manifestUrl);
    const model = new URL(spec?.modelUrl);
    if (manifest.protocol !== 'https:' || model.protocol !== 'https:') {
      return { ok: false, reason: COMPANION_SHELL_REASONS.MANIFEST_UNTRUSTED };
    }
    if (manifest.hostname === model.hostname) {
      return { ok: false, reason: COMPANION_SHELL_REASONS.MANIFEST_UNTRUSTED };
    }
    const src = validateSourceUrl(spec.modelUrl, spec.allowedSourceUrls);
    if (!src.ok) return { ok: false, reason: src.reason };
    const integrity = validateIntegritySpec(spec.expectedDigest, spec.expectedSizeBytes);
    if (!integrity.ok) return { ok: false, reason: integrity.reason };
    return { ok: true, reason: 'ok' };
  } catch {
    return { ok: false, reason: COMPANION_SHELL_REASONS.MANIFEST_UNTRUSTED };
  }
}

/**
 * Pure predicate for the Phase 1 `companionAvailable` seam.
 * @param {{
 *   integrityVerified?: boolean,
 *   lifecycleState?: { state: string },
 *   lastHealthOkAt?: number|null,
 *   now: number,
 *   listenerBound?: boolean,
 *   loopbackTokenPresent?: boolean,
 *   healthRecencyMs?: number,
 * }} state
 */
export function computeCompanionAvailable(state) {
  if (!state || typeof state.now !== 'number' || !Number.isFinite(state.now)) return false;
  if (state.integrityVerified !== true) return false;
  if (!canServeInference(state.lifecycleState)) return false;
  if (state.listenerBound !== true) return false;
  if (state.loopbackTokenPresent !== true) return false;
  if (typeof state.lastHealthOkAt !== 'number' || !Number.isFinite(state.lastHealthOkAt)) return false;
  const recency = state.healthRecencyMs ?? DEFAULT_HEALTH_RECENCY_MS;
  return state.now - state.lastHealthOkAt <= recency;
}

/**
 * Download to a temp file, feed every byte to the integrity accumulator, fsync,
 * finalize, and atomically rename to the verified path.
 * @param {{
 *   runtimeGroup: ReturnType<typeof createRuntimeGroup>,
 *   spec: { modelUrl: string, expectedDigest: string, expectedSizeBytes: number, allowedSourceUrls: string[] },
 *   tempPath: string,
 *   verifiedPath: string,
 * }} params
 */
export async function downloadVerifyAndStageModel({ runtimeGroup, spec, tempPath, verifiedPath }) {
  const acc = createIntegrityAccumulator({
    expectedDigest: spec.expectedDigest,
    expectedSizeBytes: spec.expectedSizeBytes,
    sourceUrl: spec.modelUrl,
    allowedSourceUrls: spec.allowedSourceUrls,
  });
  const file = await open(tempPath, 'w', 0o600);
  let writes = Promise.resolve();
  try {
    await runtimeGroup.download(spec.modelUrl, (chunk) => {
      acc.update(chunk);
      writes = writes.then(() => file.write(chunk));
    });
    await writes;
    await file.sync();
  } catch (err) {
    acc.abort();
    await file.close().catch(() => {});
    await rm(tempPath, { force: true });
    throw err;
  }
  await file.close();
  const verdict = acc.finalize();
  if (!verdict.ok) {
    await rm(tempPath, { force: true });
    throw new Error(COMPANION_SHELL_REASONS.INTEGRITY_FAILED);
  }
  if (!path.isAbsolute(verifiedPath)) throw new TypeError(COMPANION_SHELL_REASONS.INTEGRITY_FAILED);
  await rename(tempPath, verifiedPath);
  return { ok: true, verifiedPath };
}

/**
 * Create the run-from-source companion shell.
 * @param {{
 *   authorityGroup?: ReturnType<typeof createAuthorityGroup>,
 *   runtimeGroup: ReturnType<typeof createRuntimeGroup>,
 *   now?: () => number,
 *   healthRecencyMs?: number,
 * }} params
 */
export function createCompanionShell(params) {
  const runtimeGroup = createRuntimeGroup(params?.runtimeGroup);
  const authorityGroup = params?.authorityGroup ?? createAuthorityGroup();
  const now = params?.now ?? (() => Date.now());
  const healthRecencyMs = params?.healthRecencyMs ?? DEFAULT_HEALTH_RECENCY_MS;

  let lifecycleState = createLifecycleState();
  let integrityVerified = false;
  let listenerBound = false;
  let loopbackTokenPresent = false;
  let lastHealthOkAt = null;
  let handle = null;

  function markUnavailable() {
    lastHealthOkAt = null;
    if (canServeInference(lifecycleState)) {
      const drained = transitionLifecycle(lifecycleState, LIFECYCLE_EVENTS.DRAIN);
      lifecycleState = drained.ok ? drained.newState : createLifecycleState();
    }
  }

  return {
    authorityGroup,
    runtimeGroup,
    get state() {
      return {
        lifecycleState,
        integrityVerified,
        listenerBound,
        loopbackTokenPresent,
        lastHealthOkAt,
      };
    },
    setListenerBound(value) {
      listenerBound = value === true;
      if (!listenerBound) markUnavailable();
    },
    setLoopbackTokenPresent(value) {
      loopbackTokenPresent = value === true;
      if (!loopbackTokenPresent) markUnavailable();
    },
    markIntegrityVerified() {
      integrityVerified = true;
    },
    markIntegrityFailed() {
      integrityVerified = false;
      markUnavailable();
    },
    companionAvailable() {
      return computeCompanionAvailable({
        integrityVerified,
        lifecycleState,
        lastHealthOkAt,
        listenerBound,
        loopbackTokenPresent,
        now: now(),
        healthRecencyMs,
      });
    },
    laneCapabilities(extra = {}) {
      return { ...extra, companionAvailable: this.companionAvailable() };
    },
    selectLane(preferences = {}, extraCapabilities = {}) {
      return selectLane(this.laneCapabilities(extraCapabilities), preferences);
    },
    async startRuntime(spawnOpts) {
      if (!integrityVerified) throw new Error(COMPANION_SHELL_REASONS.INTEGRITY_FAILED);
      const started = transitionLifecycle(lifecycleState, LIFECYCLE_EVENTS.START);
      if (!started.ok) throw new Error(COMPANION_SHELL_REASONS.NOT_READY);
      lifecycleState = started.newState;
      try {
        handle = await runtimeGroup.spawn(spawnOpts);
      } catch {
        lifecycleState = createLifecycleState();
        throw new Error(COMPANION_SHELL_REASONS.SPAWN_FAILED);
      }
      const healthy = await runtimeGroup.healthCheck(handle);
      if (!healthy) {
        await handle.kill?.();
        const failed = transitionLifecycle(lifecycleState, LIFECYCLE_EVENTS.HEALTH_FAIL);
        lifecycleState = failed.newState;
        lastHealthOkAt = null;
        throw new Error(COMPANION_SHELL_REASONS.HEALTH_FAILED);
      }
      const ready = transitionLifecycle(lifecycleState, LIFECYCLE_EVENTS.HEALTH_OK);
      lifecycleState = ready.newState;
      lastHealthOkAt = now();
      return handle;
    },
    async healthProbe() {
      if (!handle) {
        markUnavailable();
        return false;
      }
      const healthy = await runtimeGroup.healthCheck(handle);
      if (!healthy) {
        markUnavailable();
        return false;
      }
      lastHealthOkAt = now();
      return true;
    },
    async shutdown() {
      markUnavailable();
      if (handle && typeof handle.kill === 'function') await handle.kill();
      const stopped = transitionLifecycle({ state: 'draining' }, LIFECYCLE_EVENTS.STOPPED);
      lifecycleState = stopped.ok ? stopped.newState : createLifecycleState();
      handle = null;
    },
  };
}
