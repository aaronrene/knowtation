/**
 * Operator full logical export: paginated user index from canister + per-user notes/proposals.
 * @see scripts/canister-operator-full-export.mjs
 */
import {
  encryptOperatorBackupUtf8,
  fetchFullProposalsForOperatorExport,
  fetchNotesFromExport,
  putS3Object,
  utcBackupStamp,
} from './operator-canister-backup.mjs';

/**
 * @param {string} baseUrl
 * @param {string} operatorKey — X-Operator-Export-Key
 * @param {string} [cursor]
 * @param {number} [limit]
 * @returns {Promise<{ format_version: number, kind: string, user_ids: string[], next_cursor: string, done: boolean }>}
 */
export async function fetchOperatorUserIndexPage(baseUrl, operatorKey, cursor = '', limit = 200) {
  const base = baseUrl.replace(/\/$/, '');
  const u = new URL(`${base}/api/v1/operator/export`);
  if (cursor !== '' && cursor != null) u.searchParams.set('cursor', String(cursor));
  if (limit) u.searchParams.set('limit', String(limit));
  const r = await fetch(u.toString(), {
    method: 'GET',
    headers: {
      'X-Operator-Export-Key': operatorKey,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`operator user index ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * @param {string} baseUrl
 * @param {string} operatorKey
 * @param {number} [pageLimit]
 * @returns {Promise<string[]>}
 */
export async function collectAllOperatorUserIds(baseUrl, operatorKey, pageLimit = 200) {
  const ids = [];
  let cursor = '';
  for (;;) {
    const page = await fetchOperatorUserIndexPage(baseUrl, operatorKey, cursor, pageLimit);
    const batch = Array.isArray(page.user_ids) ? page.user_ids : [];
    ids.push(...batch);
    if (page.done) break;
    cursor = page.next_cursor != null ? String(page.next_cursor) : '';
    if (cursor === '') break;
  }
  return ids;
}

/**
 * @param {string} baseUrl
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function fetchVaultIdsForUser(baseUrl, userId) {
  const base = baseUrl.replace(/\/$/, '');
  const r = await fetch(`${base}/api/v1/vaults`, {
    method: 'GET',
    headers: {
      'X-User-Id': userId,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    throw new Error(`vaults ${r.status}`);
  }
  const data = await r.json();
  const vaults = Array.isArray(data.vaults) ? data.vaults : [];
  const ids = vaults.map((v) => (v && v.id != null ? String(v.id) : '')).filter(Boolean);
  return ids.length > 0 ? ids : ['default'];
}

/**
 * Merge proposals from multiple vault-scoped fetches (dedupe by proposal_id).
 * @param {string} baseUrl
 * @param {string} userId
 * @param {string[]} vaultIds
 * @returns {Promise<object[]>}
 */
export async function fetchFullProposalsForUserAllVaults(baseUrl, userId, vaultIds) {
  const byId = new Map();
  for (const vid of vaultIds) {
    const list = await fetchFullProposalsForOperatorExport(baseUrl, userId, vid);
    for (const p of list) {
      const id = p && p.proposal_id ? String(p.proposal_id) : '';
      if (id) byId.set(id, p);
    }
  }
  return [...byId.values()];
}

/**
 * @param {Array<{ user_id: string, vaults: Array<{ vault_id: string, notes: object[] }>, proposals: object[] }>} users
 */
export function buildOperatorFullExportPayload(users) {
  return {
    format_version: 4,
    kind: 'knowtation-operator-full-export',
    exported_at: new Date().toISOString(),
    users,
  };
}

/**
 * @param {string} baseUrl
 * @param {string} operatorKey
 * @param {(msg: string) => void} [log]
 * @returns {Promise<object>}
 */
export async function buildFullOperatorExportJson(baseUrl, operatorKey, log = () => {}) {
  const userIds = await collectAllOperatorUserIds(baseUrl, operatorKey);
  log(`operator full export: ${userIds.length} user id(s)`);
  const users = [];
  for (const userId of userIds) {
    const vaultIds = await fetchVaultIdsForUser(baseUrl, userId);
    const vaults = [];
    for (const vaultId of vaultIds) {
      const notes = await fetchNotesFromExport(baseUrl, userId, vaultId);
      vaults.push({ vault_id: vaultId, notes });
    }
    const proposals = await fetchFullProposalsForUserAllVaults(baseUrl, userId, vaultIds);
    users.push({ user_id: userId, vaults, proposals });
  }
  return buildOperatorFullExportPayload(users);
}

export { encryptOperatorBackupUtf8, putS3Object, utcBackupStamp };
