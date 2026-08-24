/**
 * AIP — ingest rules + idempotency store (file + dedicated Netlify blobs).
 * D26 / D27. Never reuse gateway-agent-credentials or gateway-billing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackTemplates } from '../../lib/automation-ingest-policy.mjs';

const RULES_BLOB_GLOBAL = '__knowtation_gateway_ingest_rules_blob';
const IDEM_BLOB_GLOBAL = '__knowtation_gateway_ingest_idempotency_blob';
const RULES_BLOB_KEY = 'automation-ingest-rules-v1';
const IDEM_BLOB_KEY = 'automation-ingest-idempotency-v1';
export const INGEST_STORE_UNAVAILABLE = 'AGENT_CREDENTIAL_STORE_UNAVAILABLE';

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

function resolveDataDir(override) {
  if (override) return override;
  return process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(projectRoot, 'data');
}

function rulesFilePath(override) {
  return path.join(resolveDataDir(override), 'automation_ingest_rules.json');
}

function idempotencyFilePath(override) {
  return path.join(resolveDataDir(override), 'automation_ingest_idempotency.json');
}

function wrapStoreError(e) {
  if (e && e.code === INGEST_STORE_UNAVAILABLE) return e;
  const err = new Error(e && e.message ? e.message : 'automation ingest store I/O failed');
  err.code = INGEST_STORE_UNAVAILABLE;
  err.status = 503;
  return err;
}

function emptyRulesEnvelope() {
  return { version: 1, subs: {} };
}

function emptyIdempotencyEnvelope() {
  return { version: 1, entries: {} };
}

function resolveRulesBackend() {
  if (isNetlify()) {
    const store = globalThis[RULES_BLOB_GLOBAL];
    if (!store) {
      const err = new Error('ingest rules blob global missing on Netlify');
      err.code = INGEST_STORE_UNAVAILABLE;
      err.status = 503;
      throw err;
    }
    return { kind: 'blob', store };
  }
  const store = globalThis[RULES_BLOB_GLOBAL];
  if (store) return { kind: 'blob', store };
  return { kind: 'file' };
}

function resolveIdemBackend() {
  if (isNetlify()) {
    const store = globalThis[IDEM_BLOB_GLOBAL];
    if (!store) {
      const err = new Error('ingest idempotency blob global missing on Netlify');
      err.code = INGEST_STORE_UNAVAILABLE;
      err.status = 503;
      throw err;
    }
    return { kind: 'blob', store };
  }
  const store = globalThis[IDEM_BLOB_GLOBAL];
  if (store) return { kind: 'blob', store };
  return { kind: 'file' };
}

async function readJsonBlob(store, key) {
  if (!store || typeof store.get !== 'function') return null;
  const raw = await store.get(key);
  if (raw == null) return null;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  }
  if (typeof raw === 'object') return raw;
  return null;
}

async function writeJsonBlob(store, key, value) {
  if (!store || typeof store.set !== 'function') {
    const err = new Error('ingest blob set unavailable');
    err.code = INGEST_STORE_UNAVAILABLE;
    err.status = 503;
    throw err;
  }
  await store.set(key, JSON.stringify(value));
}

async function readJsonFile(fp) {
  try {
    const raw = await fs.readFile(fp, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJsonFile(fp, value) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(value, null, 2), 'utf8');
}

async function loadRulesEnvelope(dataDir) {
  try {
    const backend = resolveRulesBackend();
    const raw =
      backend.kind === 'blob'
        ? await readJsonBlob(backend.store, RULES_BLOB_KEY)
        : await readJsonFile(rulesFilePath(dataDir));
    if (!raw || typeof raw !== 'object') return emptyRulesEnvelope();
    const subs = raw.subs && typeof raw.subs === 'object' ? raw.subs : {};
    return { version: 1, subs };
  } catch (e) {
    throw wrapStoreError(e);
  }
}

async function saveRulesEnvelope(envelope, dataDir) {
  try {
    const backend = resolveRulesBackend();
    if (backend.kind === 'blob') {
      await writeJsonBlob(backend.store, RULES_BLOB_KEY, envelope);
      return;
    }
    await writeJsonFile(rulesFilePath(dataDir), envelope);
  } catch (e) {
    throw wrapStoreError(e);
  }
}

async function loadIdempotencyEnvelope(dataDir) {
  try {
    const backend = resolveIdemBackend();
    const raw =
      backend.kind === 'blob'
        ? await readJsonBlob(backend.store, IDEM_BLOB_KEY)
        : await readJsonFile(idempotencyFilePath(dataDir));
    if (!raw || typeof raw !== 'object') return emptyIdempotencyEnvelope();
    const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
    return { version: 1, entries };
  } catch (e) {
    throw wrapStoreError(e);
  }
}

async function saveIdempotencyEnvelope(envelope, dataDir) {
  try {
    const backend = resolveIdemBackend();
    if (backend.kind === 'blob') {
      await writeJsonBlob(backend.store, IDEM_BLOB_KEY, envelope);
      return;
    }
    await writeJsonFile(idempotencyFilePath(dataDir), envelope);
  } catch (e) {
    throw wrapStoreError(e);
  }
}

/**
 * @param {string} sub
 * @returns {Promise<{ rules: object[], templates: object[] }>}
 */
export async function loadIngestRulesForSub(sub, dataDir) {
  const sid = String(sub || '');
  const envelope = await loadRulesEnvelope(dataDir);
  const row = envelope.subs[sid];
  const rules = row && Array.isArray(row.rules) ? row.rules : [];
  return { rules, templates: listPackTemplates() };
}

/**
 * @param {string} sub
 * @param {object[]} rules
 * @param {string} [dataDir]
 */
export async function saveIngestRulesForSub(sub, rules, dataDir) {
  const sid = String(sub || '');
  const envelope = await loadRulesEnvelope(dataDir);
  envelope.subs[sid] = { rules: Array.isArray(rules) ? rules : [], updated_at: Date.now() };
  await saveRulesEnvelope(envelope, dataDir);
  return envelope.subs[sid];
}

/**
 * @param {string} storeKey
 * @param {string} [dataDir]
 */
export async function getIngestIdempotency(storeKey, dataDir) {
  const envelope = await loadIdempotencyEnvelope(dataDir);
  const row = envelope.entries[storeKey];
  if (!row || typeof row !== 'object') return null;
  if (Number(row.expires_at) <= Date.now()) return null;
  return row;
}

/**
 * @param {string} storeKey
 * @param {object} entry
 * @param {string} [dataDir]
 */
export async function putIngestIdempotency(storeKey, entry, dataDir) {
  const envelope = await loadIdempotencyEnvelope(dataDir);
  envelope.entries[storeKey] = entry;
  const now = Date.now();
  for (const [k, v] of Object.entries(envelope.entries)) {
    if (!v || Number(v.expires_at) <= now) delete envelope.entries[k];
  }
  await saveIdempotencyEnvelope(envelope, dataDir);
  return envelope.entries[storeKey];
}
