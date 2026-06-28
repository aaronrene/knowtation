import fs from 'fs';
import path from 'path';

export const PROTOCOL_IDEMPOTENCY_FILE = 'hub_external_protocol_idempotency.json';
export const PROTOCOL_OPS_LOG_FILE = 'hub_external_protocol_ops.json';

function loadIdempotencyStore(dataDir) {
  const fp = path.join(dataDir, PROTOCOL_IDEMPOTENCY_FILE);
  if (!fs.existsSync(fp)) return { vaults: {} };
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return { vaults: {} };
    return { vaults: j.vaults && typeof j.vaults === 'object' ? j.vaults : {} };
  } catch {
    return { vaults: {} };
  }
}

function saveIdempotencyStore(dataDir, store) {
  const fp = path.join(dataDir, PROTOCOL_IDEMPOTENCY_FILE);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
}

export async function checkIdempotency(dataDir, vaultId, taskId, verb, idempotencyKey) {
  if (!idempotencyKey) return null;
  const store = loadIdempotencyStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault || !Array.isArray(vault.entries)) return null;

  const now = Date.now();
  // Cleanup expired entries while we're here
  vault.entries = vault.entries.filter(e => new Date(e.expires_at).getTime() > now - 86400000);

  const keyMatch = vault.entries.find(e => e.key === `${taskId}#${verb}#${idempotencyKey}`);
  if (keyMatch) {
    if (new Date(keyMatch.expires_at).getTime() > now) {
      return { conflict: false, response: { ok: true, status: keyMatch.status, ...keyMatch.body } };
    }
  }
  
  // Check if same task + verb but different key has succeeded
  const actionMatch = vault.entries.find(e => e.key.startsWith(`${taskId}#${verb}#`) && e.key !== `${taskId}#${verb}#${idempotencyKey}`);
  if (actionMatch && new Date(actionMatch.expires_at).getTime() > now && actionMatch.status >= 200 && actionMatch.status < 300) {
    return { conflict: true };
  }
  
  return null;
}

export async function saveIdempotency(dataDir, vaultId, taskId, verb, idempotencyKey, result, ttlSeconds) {
  if (!idempotencyKey) return;
  const store = loadIdempotencyStore(dataDir);
  if (!store.vaults[vaultId]) store.vaults[vaultId] = { entries: [] };
  
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (ttlSeconds * 1000)).toISOString();
  
  const entry = {
    key: `${taskId}#${verb}#${idempotencyKey}`,
    verb,
    status: result.status || 200,
    body: result.body || {},
    expires_at: expiresAt,
    created: now.toISOString()
  };
  
  // Remove older entry with same key if exists
  store.vaults[vaultId].entries = store.vaults[vaultId].entries.filter(e => e.key !== entry.key);
  store.vaults[vaultId].entries.push(entry);
  
  saveIdempotencyStore(dataDir, store);
}

export function appendOperationalLog(dataDir, entry) {
  const fp = path.join(dataDir, PROTOCOL_OPS_LOG_FILE);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, JSON.stringify(entry) + '\n', 'utf8');
}
