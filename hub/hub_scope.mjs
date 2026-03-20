/**
 * Multi-vault (Phase 15) Option B: per-user per-vault scope (projects/folders allowlist).
 * Format: { "user_id": { "vault_id": { "projects": string[], "folders": string[] } }, ... }
 * Omitted or empty = no scope (user sees full vault).
 */

import fs from 'fs';
import path from 'path';

const SCOPE_FILE = 'hub_scope.json';

/**
 * @param {string} dataDir - e.g. config.data_dir
 * @returns {{ [userId: string]: { [vaultId: string]: { projects?: string[], folders?: string[] } } }}
 */
export function readScope(dataDir) {
  if (!dataDir) return {};
  const filePath = path.join(dataDir, SCOPE_FILE);
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    return data;
  } catch (_) {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @param {{ [userId: string]: { [vaultId: string]: { projects?: string[], folders?: string[] } } }} scope
 */
export function writeScope(dataDir, scope) {
  if (!dataDir) throw new Error('data_dir required');
  const filePath = path.join(dataDir, SCOPE_FILE);
  const obj = {};
  for (const [uid, vaultMap] of Object.entries(scope)) {
    if (typeof uid !== 'string' || !uid.trim() || !vaultMap || typeof vaultMap !== 'object') continue;
    obj[uid.trim()] = {};
    for (const [vaultId, rules] of Object.entries(vaultMap)) {
      if (typeof vaultId !== 'string' || !vaultId.trim() || !rules) continue;
      const projects = Array.isArray(rules.projects)
        ? rules.projects.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
        : [];
      const folders = Array.isArray(rules.folders)
        ? rules.folders.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
        : [];
      if (projects.length > 0 || folders.length > 0) {
        obj[uid.trim()][vaultId.trim()] = { projects, folders };
      }
    }
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * Get scope for (userId, vaultId). Returns null if no scope (full access).
 * @param {string} dataDir
 * @param {string} userId
 * @param {string} vaultId
 * @returns {{ projects: string[], folders: string[] } | null}
 */
export function getScopeForUserVault(dataDir, userId, vaultId) {
  const scope = readScope(dataDir);
  const userScope = scope[userId];
  if (!userScope || typeof userScope[vaultId] !== 'object') return null;
  const r = userScope[vaultId];
  const projects = Array.isArray(r.projects) ? r.projects : [];
  const folders = Array.isArray(r.folders) ? r.folders : [];
  if (projects.length === 0 && folders.length === 0) return null;
  return { projects, folders };
}
