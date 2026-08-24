/**
 * Phase C + Lane D — durable store for scoped REST agent credentials.
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
const META_BLOB_KEY = 'agent-credentials-v1-meta';
const BLOB_GLOBAL = '__knowtation_gateway_agent_cred_blob';
export const AGENT_CREDENTIAL_STORE_INCONSISTENT = 'AGENT_CREDENTIAL_STORE_INCONSISTENT';
export const AGENT_CREDENTIAL_STORE_UNAVAILABLE = 'AGENT_CREDENTIAL_STORE_UNAVAILABLE';

let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}

function isNetlify() {
  return typeof process.env.NETLIFY === 'string' && process.env.NETLIFY.length > 0;
}

function credentialFilePath() {
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(projectRoot, 'data');
  return path.join(dataDir, 'hosted_agent_credentials.json');
}

function metaFilePath() {
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(projectRoot, 'data');
  return path.join(dataDir, 'hosted_agent_credentials.meta.json');
}

function emptyEnvelope() {
  return {
    schema_version: 1,
    credentials: {},
    wipe_required: false,
    wipe_reason: null,
    wipe_set_at: null,
  };
}

function wrapStoreError(e, fallbackCode = AGENT_CREDENTIAL_STORE_UNAVAILABLE) {
  if (e && e.code === AGENT_CREDENTIAL_STORE_INCONSISTENT) return e;
  const err = new Error(e && e.message ? e.message : 'agent credential store I/O failed');
  err.code = e && e.code === AGENT_CREDENTIAL_STORE_UNAVAILABLE ? AGENT_CREDENTIAL_STORE_UNAVAILABLE : fallbackCode;
  return err;
}

function inconsistentError(message = 'agent credential store inconsistent') {
  const err = new Error(message);
  err.code = AGENT_CREDENTIAL_STORE_INCONSISTENT;
  return err;
}

/**
 * @returns {{ kind: 'blob', store: object } | { kind: 'file' }}
 */
function resolveStorageBackend() {
  if (isNetlify()) {
    const store = globalThis[BLOB_GLOBAL];
    if (!store) {
      const err = new Error('agent credential blob global missing on Netlify');
      err.code = AGENT_CREDENTIAL_STORE_UNAVAILABLE;
      throw err;
    }
    return { kind: 'blob', store };
  }
  const store = globalThis[BLOB_GLOBAL];
  if (store) return { kind: 'blob', store };
  return { kind: 'file' };
}

function normalizeCredentialRecords(credentials) {
  const out = {};
  if (!credentials || typeof credentials !== 'object') return out;
  for (const [id, rec] of Object.entries(credentials)) {
    if (typeof id === 'string' && rec && typeof rec === 'object' && typeof rec.token_hash === 'string') {
      out[id] = rec;
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 */
function normalizeEnvelope(raw) {
  if (!raw || typeof raw !== 'object') return emptyEnvelope();
  const credentials =
    raw.credentials && typeof raw.credentials === 'object'
      ? normalizeCredentialRecords(raw.credentials)
      : normalizeCredentialRecords(raw);
  return {
    schema_version: raw.schema_version === 1 ? 1 : 1,
    credentials,
    wipe_required: Boolean(raw.wipe_required),
    wipe_reason: raw.wipe_reason == null ? null : String(raw.wipe_reason).slice(0, 128),
    wipe_set_at: Number.isFinite(raw.wipe_set_at) ? raw.wipe_set_at : null,
  };
}

/**
 * @param {unknown} raw
 */
function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema_version !== 1) return null;
  return {
    schema_version: 1,
    nonempty_seen: Boolean(raw.nonempty_seen),
    count: Number.isFinite(raw.count) ? raw.count : 0,
    updated_at: Number.isFinite(raw.updated_at) ? raw.updated_at : 0,
  };
}

async function readMeta(backend) {
  try {
    if (backend.kind === 'blob') {
      const raw = await backend.store.get(META_BLOB_KEY, { type: 'json' });
      return raw == null ? null : normalizeMeta(raw);
    }
    try {
      const text = await fs.readFile(metaFilePath(), 'utf8');
      return normalizeMeta(JSON.parse(text));
    } catch (e) {
      if (e && e.code === 'ENOENT') return null;
      throw wrapStoreError(e);
    }
  } catch (e) {
    throw wrapStoreError(e);
  }
}

async function writeMeta(backend, count, updatedAt) {
  const payload = {
    schema_version: 1,
    nonempty_seen: true,
    count,
    updated_at: updatedAt,
  };
  if (backend.kind === 'blob') {
    await backend.store.setJSON(META_BLOB_KEY, payload);
    return;
  }
  const filePath = metaFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

function assertNotInconsistent(envelope, meta) {
  const count = Object.keys(envelope.credentials || {}).length;
  if (meta && meta.nonempty_seen && count === 0) {
    throw inconsistentError();
  }
}

async function readEnvelope(backend, meta) {
  try {
    if (backend.kind === 'blob') {
      const raw = await backend.store.get(BLOB_KEY, { type: 'json' });
      if (raw == null) {
        const envelope = emptyEnvelope();
        assertNotInconsistent(envelope, meta);
        return envelope;
      }
      const envelope = normalizeEnvelope(raw);
      assertNotInconsistent(envelope, meta);
      return envelope;
    }
    try {
      const text = await fs.readFile(credentialFilePath(), 'utf8');
      const envelope = normalizeEnvelope(JSON.parse(text));
      assertNotInconsistent(envelope, meta);
      return envelope;
    } catch (e) {
      if (e && e.code === AGENT_CREDENTIAL_STORE_INCONSISTENT) throw e;
      if (e && e.code === 'ENOENT') {
        if (meta && meta.nonempty_seen) throw inconsistentError();
        return emptyEnvelope();
      }
      throw wrapStoreError(e);
    }
  } catch (e) {
    if (e && e.code === AGENT_CREDENTIAL_STORE_INCONSISTENT) throw e;
    throw wrapStoreError(e);
  }
}

async function load() {
  const backend = resolveStorageBackend();
  const meta = await readMeta(backend);
  const envelope = await readEnvelope(backend, meta);
  return { envelope, meta, backend };
}

async function save(envelope, backend, meta) {
  const credentials = envelope.credentials || {};
  const count = Object.keys(credentials).length;
  if (meta && meta.nonempty_seen && count === 0) {
    throw inconsistentError();
  }

  const payload = {
    schema_version: 1,
    credentials,
    wipe_required: Boolean(envelope.wipe_required),
    wipe_reason: envelope.wipe_reason == null ? null : String(envelope.wipe_reason).slice(0, 128),
    wipe_set_at: Number.isFinite(envelope.wipe_set_at) ? envelope.wipe_set_at : null,
  };

  try {
    if (backend.kind === 'blob') {
      await backend.store.setJSON(BLOB_KEY, payload);
    } else {
      const filePath = credentialFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmpPath, filePath);
    }
    if (count > 0) {
      await writeMeta(backend, count, Date.now());
    }
  } catch (e) {
    throw wrapStoreError(e);
  }
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
      const { envelope, meta, backend } = await load();
      const result = mintCredential(envelope.credentials, opts);
      await save({ ...envelope, credentials: result.records }, backend, meta);
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
      const { envelope, meta, backend } = await load();
      const result = verifyCredential(envelope.credentials, credential, opts);
      try {
        if (result.ok) {
          await save({ ...envelope, credentials: result.records }, backend, meta);
        } else if (result.records) {
          await save({ ...envelope, credentials: result.records }, backend, meta);
        }
      } catch (saveErr) {
        if (!result.ok && result.records) return result;
        throw saveErr;
      }
      return result;
    },
    revoke: async (cid, sub) => {
      const { envelope, meta, backend } = await load();
      const result = revokeCredential(envelope.credentials, cid, sub);
      if (result.revoked) await save({ ...envelope, credentials: result.records }, backend, meta);
      return { ok: true, revoked: result.revoked };
    },
    rotate: async (cid, sub) => {
      const { envelope, meta, backend } = await load();
      const result = rotateCredential(envelope.credentials, cid, sub);
      await save({ ...envelope, credentials: result.records }, backend, meta);
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
      const { envelope } = await load();
      return {
        credentials: listCredentialsForSub(envelope.credentials, sub),
        store: {
          wipe_required: Boolean(envelope.wipe_required),
          inconsistent: false,
        },
      };
    },
  };
}

export { BLOB_GLOBAL, BLOB_KEY, META_BLOB_KEY };
