/**
 * Phase 13 — Role store. Reads data/hub_roles.json (optional).
 * Format: { "roles": { "provider:id": "admin" | "editor" | "viewer" } }
 * or flat: { "github:123": "admin" }. Unknown or missing → treat as member (editor).
 */

import fs from 'fs';
import path from 'path';

const ROLES_FILE = 'hub_roles.json';
const VALID_ROLES = new Set(['admin', 'editor', 'viewer']);

/**
 * Load role map from data_dir. Returns Map<sub, role>.
 * File format: { "roles": { "sub": "role", ... } } or { "sub": "role", ... }.
 * @param {string} dataDir - e.g. config.data_dir
 * @returns {Map<string, string>}
 */
export function loadRoleMap(dataDir) {
  const map = new Map();
  if (!dataDir) return map;
  const filePath = path.join(dataDir, ROLES_FILE);
  try {
    if (!fs.existsSync(filePath)) return map;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const roles = data.roles != null ? data.roles : data;
    if (typeof roles !== 'object' || roles === null) return map;
    for (const [sub, role] of Object.entries(roles)) {
      if (typeof sub === 'string' && VALID_ROLES.has(role)) map.set(sub, role);
    }
  } catch (_) {
    // Invalid file or missing: treat as no overrides
  }
  return map;
}

/**
 * Get role for a user (sub). Uses provided map; if not in map, returns 'member'.
 * 'member' is treated as editor in permission checks (backward compatibility).
 * @param {Map<string, string>} roleMap - from loadRoleMap(data_dir)
 * @param {string} sub - e.g. "github:123"
 * @returns {string} - 'admin' | 'editor' | 'viewer' | 'member'
 */
export function getRole(roleMap, sub) {
  if (!sub) return 'member';
  const role = roleMap.get(sub);
  return role ?? 'member';
}

/**
 * Read current roles as a plain object (for API GET).
 * @param {string} dataDir
 * @returns {{ [sub: string]: string }}
 */
export function readRolesObject(dataDir) {
  const map = loadRoleMap(dataDir);
  return Object.fromEntries(map);
}

/**
 * Write roles to data/hub_roles.json. Overwrites the file.
 * @param {string} dataDir
 * @param {{ [sub: string]: string }} roles - e.g. { "github:123": "admin" }
 */
export function writeRolesFile(dataDir, roles) {
  if (!dataDir) throw new Error('data_dir required');
  const filePath = path.join(dataDir, ROLES_FILE);
  const obj = {};
  for (const [sub, role] of Object.entries(roles)) {
    if (typeof sub === 'string' && sub.trim() && VALID_ROLES.has(role)) obj[sub.trim()] = role;
  }
  fs.writeFileSync(filePath, JSON.stringify({ roles: obj }, null, 2), 'utf8');
}
