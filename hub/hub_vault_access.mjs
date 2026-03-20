/**
 * Multi-vault (Phase 15): user → vault_ids mapping in data/hub_vault_access.json.
 * Format: { "user_id": ["vault_id1", "vault_id2"], ... }
 * Users not in the map get ["default"] only.
 */

import fs from 'fs';
import path from 'path';

const ACCESS_FILE = 'hub_vault_access.json';

/**
 * @param {string} dataDir - e.g. config.data_dir
 * @returns {{ [userId: string]: string[] }}
 */
export function readVaultAccess(dataDir) {
  if (!dataDir) return {};
  const filePath = path.join(dataDir, ACCESS_FILE);
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const out = {};
    if (data && typeof data === 'object') {
      for (const [uid, arr] of Object.entries(data)) {
        if (typeof uid === 'string' && uid.trim() && Array.isArray(arr)) {
          out[uid.trim()] = arr.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
        }
      }
    }
    return out;
  } catch (_) {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @param {{ [userId: string]: string[] }} access
 */
export function writeVaultAccess(dataDir, access) {
  if (!dataDir) throw new Error('data_dir required');
  const filePath = path.join(dataDir, ACCESS_FILE);
  const obj = {};
  for (const [uid, arr] of Object.entries(access)) {
    if (typeof uid === 'string' && uid.trim() && Array.isArray(arr)) {
      obj[uid.trim()] = arr.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
    }
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * Get allowed vault IDs for a user. Returns ['default'] if not in map.
 * @param {string} dataDir
 * @param {string} userId
 * @returns {string[]}
 */
export function getAllowedVaultIds(dataDir, userId) {
  const access = readVaultAccess(dataDir);
  const allowed = access[userId];
  return allowed && allowed.length > 0 ? allowed : ['default'];
}
