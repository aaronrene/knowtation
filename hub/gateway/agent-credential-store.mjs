/**
 * Phase C — durable store for scoped REST agent credentials.
 * Netlify: dedicated blob `gateway-agent-credentials` (not refresh-tokens-v1).
 * Dev/test: JSON file under KNOWTATION_GATEWAY_DATA_DIR.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  mintCredential,
  verifyCredential,
  revokeCredential,
  rotateCredential,
  listCredentialsForSub,
} from '../lib/agent-credential-core.mjs';

const BLOB_KEY = 'agent-credentials-v1';
const BLOB_GLOBAL = '__knowtation_gateway_agent_cred_blob';

let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}

function credentialFilePath() {
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(projectRoot, 'data');
  return path.join(dataDir, 'hosted_agent_credentials.json');
}

function getBlobStore() {
  return globalThis[BLOB_GLOBAL];
}

function normalizeRecords(raw) {
  const credentials =
    raw && typeof raw === 'object' && raw.credentials && typeof raw.credentials === 'object'
      ? raw.credentials
      : {};
  const out = {};
  for (const [id, rec] of Object.entries(credentials)) {
    if (typeof id === 'string' && rec && typeof rec === 'object' && typeof rec.token_hash === 'string') {
      out[id] = rec;
    }
  }
  return out;
}

async function load() {
  const store = getBlobStore();
  if (store) {
    const raw = await store.get(BLOB_KEY, { type: 'json' });
    return normalizeRecords(raw);
  }
  try {
    const raw = await fs.readFile(credentialFilePath(), 'utf8');
    return normalizeRecords(JSON.parse(raw));
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    return {};
  }
}

async function save(records) {
  const store = getBlobStore();
  if (store) {
    await store.setJSON(BLOB_KEY, { credentials: records || {} });
    return;
  }
  const filePath = credentialFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify({ credentials: records || {} }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(tmpPath, filePath);
}

/**
 * @returns {{
 *   mint: Function,
 *   verify: Function,
 *   revoke: Function,
 *   rotate: Function,
 *   list: Function,
 * }}
 */
export function createAgentCredentialStore() {
  return {
    mint: async (opts) => {
      const records = await load();
      const result = mintCredential(records, opts);
      await save(result.records);
      return {
        credential: result.credential,
        id: result.id,
        name: result.record.name,
        vault_ids: result.record.vault_ids,
        scopes: result.record.scopes,
        expires_at: result.record.expires_at,
        created_at: result.record.created_at,
      };
    },
    verify: async (credential, opts = {}) => {
      const records = await load();
      const result = verifyCredential(records, credential, opts);
      if (result.ok) await save(result.records);
      return result;
    },
    revoke: async (cid, sub) => {
      const records = await load();
      const result = revokeCredential(records, cid, sub);
      if (result.revoked) await save(result.records);
      return { ok: true, revoked: result.revoked };
    },
    rotate: async (cid, sub) => {
      const records = await load();
      const result = rotateCredential(records, cid, sub);
      await save(result.records);
      return {
        credential: result.credential,
        id: result.id,
        name: result.record.name,
        vault_ids: result.record.vault_ids,
        scopes: result.record.scopes,
        expires_at: result.record.expires_at,
        created_at: result.record.created_at,
      };
    },
    list: async (sub) => {
      const records = await load();
      return listCredentialsForSub(records, sub);
    },
  };
}

export { BLOB_GLOBAL };
