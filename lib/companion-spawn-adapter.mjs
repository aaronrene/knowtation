/**
 * Companion App — Phase 5 runtime spawn adapter.
 *
 * This module owns process launch and health probing only. It imports no session,
 * OAuth, keychain, vault, or canister authority and accepts no authority-bearing
 * object in its public surface.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

export const SPAWN_ADAPTER_REASONS = Object.freeze({
  INVALID_BINARY_PATH: 'invalid_binary_path',
  INVALID_MODEL_PATH: 'invalid_model_path',
  INVALID_PORT: 'invalid_port',
  INVALID_RAM_LIMIT: 'invalid_ram_limit',
  SPAWN_FAILED: 'spawn_failed',
});

export const SECRET_ENV_KEY_PATTERNS = Object.freeze([
  /SESSION_SECRET/i,
  /(^|_)JWT($|_)/i,
  /TOKEN/i,
  /REFRESH/i,
  /API_KEY/i,
  /KEYCHAIN/i,
  /SECRET/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
]);

const ENV_ALLOWLIST = new Set([
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SYSTEMROOT',
  'WINDIR',
]);

/**
 * @param {unknown} value
 * @param {string} reason
 * @returns {string}
 */
function requireAbsolutePath(value, reason) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw new TypeError(reason);
  }
  return value;
}

/**
 * Create a minimal child environment with known secret-bearing keys stripped.
 * @param {Record<string, string|undefined>} sourceEnv
 * @returns {Record<string, string>}
 */
export function createScrubbedRuntimeEnv(sourceEnv = process.env) {
  const clean = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== 'string') continue;
    if (!ENV_ALLOWLIST.has(key)) continue;
    if (SECRET_ENV_KEY_PATTERNS.some((pattern) => pattern.test(key))) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Build a shell-free argv array for the bundled runtime.
 * @param {{ modelPath: string, port: number, maxRamBytes: number, socketPath?: string }} opts
 * @returns {string[]}
 */
export function buildRuntimeArgv(opts) {
  const modelPath = requireAbsolutePath(opts?.modelPath, SPAWN_ADAPTER_REASONS.INVALID_MODEL_PATH);
  const port = opts?.port;
  const maxRamBytes = opts?.maxRamBytes;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(SPAWN_ADAPTER_REASONS.INVALID_PORT);
  }
  if (!Number.isFinite(maxRamBytes) || maxRamBytes <= 0) {
    throw new TypeError(SPAWN_ADAPTER_REASONS.INVALID_RAM_LIMIT);
  }
  const argv = [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--model',
    modelPath,
    '--max-ram-bytes',
    String(Math.floor(maxRamBytes)),
  ];
  if (typeof opts.socketPath === 'string' && opts.socketPath.length > 0) {
    argv.push('--unix-socket', opts.socketPath);
  }
  return argv;
}

/**
 * Create the Phase 5 runtime spawn/kill/health adapter.
 * @param {{ spawn?: typeof nodeSpawn, fetch?: typeof globalThis.fetch, env?: Record<string,string|undefined> }} [deps]
 */
export function createCompanionSpawnAdapter(deps = {}) {
  const spawnFn = deps.spawn ?? nodeSpawn;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const sourceEnv = deps.env ?? process.env;

  return {
    async spawn(opts) {
      const binaryPath = requireAbsolutePath(opts?.binaryPath, SPAWN_ADAPTER_REASONS.INVALID_BINARY_PATH);
      const argv = buildRuntimeArgv(opts);
      let child;
      try {
        child = spawnFn(binaryPath, argv, {
          shell: false,
          detached: false,
          stdio: ['ignore', 'ignore', 'ignore'],
          env: createScrubbedRuntimeEnv(sourceEnv),
        });
      } catch {
        throw new Error(SPAWN_ADAPTER_REASONS.SPAWN_FAILED);
      }
      if (!child || !Number.isInteger(child.pid)) {
        throw new Error(SPAWN_ADAPTER_REASONS.SPAWN_FAILED);
      }
      return {
        pid: child.pid,
        port: opts.port,
        async kill() {
          if (typeof child.kill === 'function' && !child.killed) child.kill('SIGTERM');
        },
      };
    },

    async healthCheck(handle) {
      if (!handle || !Number.isInteger(handle.port) || typeof fetchFn !== 'function') return false;
      for (const endpoint of ['/v1/models', '/api/tags']) {
        try {
          const res = await fetchFn(`http://127.0.0.1:${handle.port}${endpoint}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (res && res.ok) return true;
        } catch {
          // Try the alternate health endpoint below.
        }
      }
      return false;
    },

    async reclaimStaleRuntime(handle) {
      if (!handle || typeof handle.kill !== 'function') return false;
      await handle.kill();
      return true;
    },
  };
}
