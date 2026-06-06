/**
 * Companion App — Phase 5 runtime resource probe.
 *
 * Probes only the supervised runtime PID. VRAM is reported as aggregate-safe zero
 * in this phase; this module never enumerates GPU process tables or escalates
 * privilege for telemetry.
 */

import { execFile as nodeExecFile } from 'node:child_process';
import { readFile as nodeReadFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(nodeExecFile);

export const RESOURCE_PROBE_REASONS = Object.freeze({
  INVALID_PID: 'invalid_pid',
  PROBE_FAILED: 'probe_failed',
});

/**
 * @param {unknown} pid
 * @returns {number}
 */
export function requireRuntimePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError(RESOURCE_PROBE_REASONS.INVALID_PID);
  }
  return pid;
}

/**
 * Create a PID-scoped resource probe with a <=500ms cache.
 * @param {{
 *   pid: number,
 *   platform?: string,
 *   now?: () => number,
 *   execFile?: Function,
 *   readFile?: Function,
 *   pageSizeBytes?: number,
 *   cacheMs?: number,
 * }} opts
 */
export function createCompanionResourceProbe(opts) {
  const pid = requireRuntimePid(opts?.pid);
  const platform = opts?.platform ?? process.platform;
  const now = opts?.now ?? (() => Date.now());
  const execFile = opts?.execFile ?? execFileAsync;
  const readFile = opts?.readFile ?? nodeReadFile;
  const pageSizeBytes = opts?.pageSizeBytes ?? 4096;
  const cacheMs = Math.min(opts?.cacheMs ?? 500, 500);
  let cachedAt = -Infinity;
  let cached = null;

  return {
    async statResources() {
      const current = now();
      if (cached && current - cachedAt <= cacheMs) return cached;
      cached = await probeByPlatform({ pid, platform, execFile, readFile, pageSizeBytes });
      cachedAt = current;
      return cached;
    },
  };
}

/**
 * @param {{ pid: number, platform: string, execFile: Function, readFile: Function, pageSizeBytes: number }} opts
 */
export async function probeByPlatform(opts) {
  if (opts.platform === 'linux') return probeLinuxProc(opts);
  if (opts.platform === 'darwin' || opts.platform === 'freebsd') return probeWithPs(opts);
  if (opts.platform === 'win32') return probeWindows(opts);
  return probeWithPs(opts);
}

async function probeLinuxProc({ pid, readFile, pageSizeBytes }) {
  try {
    const statm = await readFile(`/proc/${pid}/statm`, 'utf8');
    const parts = String(statm).trim().split(/\s+/);
    const rssPages = Number(parts[1]);
    if (!Number.isFinite(rssPages) || rssPages < 0) throw new Error('bad_statm');
    return { ramBytes: rssPages * pageSizeBytes, vramBytes: 0, cpuPercent: 0 };
  } catch {
    throw new Error(RESOURCE_PROBE_REASONS.PROBE_FAILED);
  }
}

async function probeWithPs({ pid, execFile }) {
  try {
    const result = await execFile('/bin/ps', ['-o', 'rss=', '-o', 'pcpu=', '-p', String(pid)], {
      encoding: 'utf8',
      maxBuffer: 4096,
    });
    const stdout = typeof result === 'string' ? result : result.stdout;
    const line = String(stdout).trim().split(/\n/).find(Boolean);
    if (!line) throw new Error('missing_ps');
    const [rssKb, cpuPercent] = line.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(rssKb) || rssKb < 0 || !Number.isFinite(cpuPercent) || cpuPercent < 0) {
      throw new Error('bad_ps');
    }
    return { ramBytes: rssKb * 1024, vramBytes: 0, cpuPercent };
  } catch {
    throw new Error(RESOURCE_PROBE_REASONS.PROBE_FAILED);
  }
}

async function probeWindows({ pid, execFile }) {
  try {
    const ps = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `"$p = Get-Process -Id ${pid}; Write-Output ($p.WorkingSet64.ToString() + ' ' + $p.CPU.ToString())"`,
    ];
    const result = await execFile('powershell.exe', ps, { encoding: 'utf8', maxBuffer: 4096 });
    const stdout = typeof result === 'string' ? result : result.stdout;
    const [ramBytes, cpuSeconds] = String(stdout).trim().split(/\s+/).map(Number);
    if (!Number.isFinite(ramBytes) || ramBytes < 0 || !Number.isFinite(cpuSeconds) || cpuSeconds < 0) {
      throw new Error('bad_windows_probe');
    }
    const cpuPercent = Math.min(100, cpuSeconds / Math.max(1, os.cpus().length));
    return { ramBytes, vramBytes: 0, cpuPercent };
  } catch {
    throw new Error(RESOURCE_PROBE_REASONS.PROBE_FAILED);
  }
}
