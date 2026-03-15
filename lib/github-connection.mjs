/**
 * GitHub connection (self-hosted): store access token for "Connect GitHub" flow.
 * Used when pushing vault to a user's repo; token is stored in data_dir (do not commit).
 */

import fs from 'fs';
import path from 'path';

const FILENAME = 'github_connection.json';

/**
 * @param {string} dataDir
 * @returns {{ access_token?: string } | null}
 */
export function readConnection(dataDir) {
  if (!dataDir) return null;
  const p = path.join(dataDir, FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} dataDir
 * @param {{ access_token: string }} data
 */
export function writeConnection(dataDir, data) {
  if (!dataDir) throw new Error('data_dir required');
  const p = path.join(dataDir, FILENAME);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ access_token: data.access_token || '' }, null, 0), 'utf8');
}
