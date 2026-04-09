import fs from 'node:fs';
import path from 'node:path';

/**
 * Default public hub canister HTTP base (no trailing slash) from checked-in canister_ids.json.
 * Uses the **raw** subdomain so `/api/v1/*` hits the canister's `http_request` handler.
 * `https://<id>.icp0.io` (without `raw`) returns 503 for these routes on typical ICP routing.
 * @param {string} repoRoot — absolute path to repository root
 * @param {string} [relativeJson='hub/icp/canister_ids.json']
 * @returns {string}
 */
export function hubBaseUrlFromCanisterIds(repoRoot, relativeJson = 'hub/icp/canister_ids.json') {
  const p = path.join(repoRoot, relativeJson);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const id = j.hub?.ic;
  if (!id || typeof id !== 'string') {
    throw new Error('Missing hub.ic in canister_ids.json');
  }
  return `https://${id}.raw.icp0.io`;
}

/**
 * Vault ids to export (order preserved). Matches scripts/canister-export-backup.sh.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function parseBackupVaultIds(env) {
  const raw = (env.KNOWTATION_CANISTER_BACKUP_VAULT_IDS ?? '').trim();
  if (raw.length > 0) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const single = (env.KNOWTATION_CANISTER_BACKUP_VAULT_ID ?? '').trim();
  return [single.length > 0 ? single : 'default'];
}

/**
 * Resolve canister base URL: explicit URL secrets, then repo canister_ids.json.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repoRoot
 * @returns {string | null} null if no URL and cannot default from disk
 */
export function resolveCanisterBackupBaseUrl(env, repoRoot) {
  const direct =
    (env.KNOWTATION_CANISTER_URL ?? '').trim() ||
    (env.KNOWTATION_CANISTER_BACKUP_URL ?? '').trim();
  if (direct) return direct.replace(/\/$/, '');
  if ((env.KNOWTATION_CANISTER_BACKUP_USER_ID ?? '').trim()) {
    try {
      return hubBaseUrlFromCanisterIds(repoRoot);
    } catch {
      return null;
    }
  }
  return null;
}
