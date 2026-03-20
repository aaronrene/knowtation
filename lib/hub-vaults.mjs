/**
 * Multi-vault (Phase 15): read/write data/hub_vaults.yaml.
 * Format: { vaults: [ { id: string, path: string, label?: string } ] }
 * At least one entry with id "default" when file exists.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const VAULTS_FILE = 'hub_vaults.yaml';

/**
 * Read vault list from data_dir. Returns empty array if file missing or invalid.
 * @param {string} dataDir - Resolved data_dir path
 * @param {string} [cwd] - For resolving relative paths (default dataDir parent)
 * @returns {{ id: string, path: string, label?: string }[]}
 */
export function readHubVaults(dataDir, cwd) {
  if (!dataDir || typeof dataDir !== 'string') return [];
  const p = path.join(dataDir, VAULTS_FILE);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = yaml.load(raw) || {};
    const list = Array.isArray(data.vaults) ? data.vaults : [];
    const cwdResolve = cwd || path.dirname(path.dirname(dataDir));
    return list
      .filter((v) => v && typeof v.id === 'string' && typeof v.path === 'string')
      .map((v) => ({
        id: String(v.id).trim(),
        path: path.isAbsolute(v.path) ? v.path : path.resolve(cwdResolve, v.path),
        label: typeof v.label === 'string' ? v.label.trim() : undefined,
      }));
  } catch (_) {
    return [];
  }
}

/**
 * Write hub_vaults.yaml. Validates that each path exists and is a directory.
 * @param {string} dataDir - Resolved data_dir path
 * @param {{ id: string, path: string, label?: string }[]} vaults
 * @param {string} [cwd] - For resolving relative paths when writing (paths stored relative if under cwd)
 */
export function writeHubVaults(dataDir, vaults, cwd) {
  if (!dataDir || typeof dataDir !== 'string') throw new Error('data_dir is required');
  if (!Array.isArray(vaults)) throw new Error('vaults must be an array');
  const cwdResolve = cwd || path.dirname(path.dirname(dataDir));
  const hasDefault = vaults.some((v) => v && String(v.id).trim() === 'default');
  if (!hasDefault) throw new Error('At least one vault must have id "default"');

  const list = vaults.map((v) => {
    const id = String(v.id).trim();
    if (!id) throw new Error('Vault id cannot be empty');
    const rawPath = String(v.path).trim();
    if (!rawPath) throw new Error(`Vault "${id}" path cannot be empty`);
    const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwdResolve, rawPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Vault path does not exist or is not a directory: ${resolved}`);
    }
    const storedPath = path.relative(cwdResolve, resolved);
    return {
      id,
      path: storedPath.startsWith('..') ? resolved : storedPath,
      ...(v.label != null && v.label !== '' ? { label: String(v.label).trim() } : {}),
    };
  });

  const out = yaml.dump({ vaults: list }, { lineWidth: 120 });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, VAULTS_FILE), out, 'utf8');
}
