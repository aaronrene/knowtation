/**
 * Hub Setup: read/write data/hub_setup.yaml (vault_path and vault.git overrides).
 * Used by the Setup wizard in the Hub UI. Merged by loadConfig() in config.mjs.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Read current hub_setup overrides (for GET /api/v1/setup).
 * @param {string} dataDir - Resolved data_dir path
 * @returns {{ vault_path?: string, vault?: { git?: { enabled?: boolean, remote?: string } } } | null}
 */
export function readHubSetup(dataDir) {
  const p = path.join(dataDir, 'hub_setup.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return yaml.load(raw) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Write hub_setup.yaml. Only writes vault_path and vault.git; other keys are preserved if present.
 * @param {string} dataDir - Resolved data_dir path
 * @param {{ vault_path?: string, vault?: { git?: { enabled?: boolean, remote?: string } } }} payload
 * @throws if payload is invalid or write fails
 */
export function writeHubSetup(dataDir, payload) {
  if (!dataDir || typeof dataDir !== 'string') {
    throw new Error('data_dir is required');
  }
  const p = path.join(dataDir, 'hub_setup.yaml');
  const existing = readHubSetup(dataDir) || {};
  const updated = { ...existing };

  if (payload.vault_path !== undefined) {
    const v = typeof payload.vault_path === 'string' ? payload.vault_path.trim() : '';
    if (!v) throw new Error('vault_path cannot be empty');
    updated.vault_path = v;
  }
  if (payload.vault?.git !== undefined) {
    updated.vault = updated.vault || {};
    updated.vault.git = { ...(updated.vault.git || {}), ...payload.vault.git };
    if (payload.vault.git.enabled !== undefined) updated.vault.git.enabled = !!payload.vault.git.enabled;
    if (payload.vault.git.remote !== undefined) {
      const r = typeof payload.vault.git.remote === 'string' ? payload.vault.git.remote.trim() : '';
      updated.vault.git.remote = r || undefined;
    }
  }

  const out = yaml.dump(updated, { lineWidth: 120 });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, out, 'utf8');
}
