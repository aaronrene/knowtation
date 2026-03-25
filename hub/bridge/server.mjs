/**
 * Knowtation Hub Bridge — Connect GitHub + Back up now + indexer + search for hosted product.
 * Stores GitHub token per user; sync fetches vault from canister and pushes to repo.
 * Index/search: pull vault from canister, chunk → embed → sqlite-vec per user; search via POST /api/v1/search.
 * On Netlify, tokens and vector DBs persist via Netlify Blobs (set by netlify/functions/bridge.mjs).
 * Env: SESSION_SECRET, CANISTER_URL, HUB_BASE_URL; optional HUB_UI_ORIGIN, HUB_UI_PATH (default /hub), GITHUB_*, EMBEDDING_*, BRIDGE_PORT, DATA_DIR.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import {
  resolveEffectiveCanisterUser,
  getAllowedVaultIdsFromAccessMap,
  getScopeForUserVaultFromScopeMap,
  intersectVaultIds,
} from '../lib/hosted-workspace-resolve.mjs';
import { applyScopeFilterToNotes } from '../lib/scope-filter.mjs';

// When Netlify bundles as CJS, import.meta.url is empty; avoid it in serverless so the app loads and routes register.
const inServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
let projectRoot;
if (inServerless) {
  projectRoot = process.cwd();
} else {
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
const __dirname = path.join(projectRoot, 'hub', 'bridge');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const PORT = parseInt(process.env.BRIDGE_PORT || process.env.PORT || '3341', 10);
const BASE_URL = (process.env.HUB_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CANISTER_URL = (process.env.CANISTER_URL || '').replace(/\/$/, '');
const HUB_UI_ORIGIN = (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');
// Path under HUB_UI_ORIGIN where the Hub app lives (e.g. /hub). Empty string = root.
const HUB_UI_PATH = (process.env.HUB_UI_PATH || '/hub').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.HUB_JWT_SECRET;
const DATA_DIR = process.env.DATA_DIR
  ? (path.isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : path.join(projectRoot, process.env.DATA_DIR))
  : path.join(projectRoot, 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'hub_github_tokens.json');
const ROLES_FILE = path.join(DATA_DIR, 'hub_roles.json');
const INVITES_FILE = path.join(DATA_DIR, 'hub_invites.json');
const WORKSPACE_FILE = path.join(DATA_DIR, 'hub_workspace.json');
const VAULT_ACCESS_FILE = path.join(DATA_DIR, 'hub_vault_access.json');
const SCOPE_FILE = path.join(DATA_DIR, 'hub_scope.json');
const VALID_ROLES = new Set(['admin', 'editor', 'viewer']);
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const adminUserIdsSet = new Set(
  (process.env.HUB_ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function sanitizeUserId(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default';
}

function sanitizeVaultId(vaultId) {
  return String(vaultId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

let warnedOllamaLocalhostOnNetlify = false;

/** Trim + default empty env so accidental whitespace does not break provider matching or Ollama URL. */
function getBridgeEmbeddingConfig() {
  const pEnv = process.env.EMBEDDING_PROVIDER;
  const provider = (
    pEnv == null || String(pEnv).trim() === '' ? 'ollama' : String(pEnv).trim()
  ).toLowerCase();
  const mEnv = process.env.EMBEDDING_MODEL;
  const model =
    mEnv == null || String(mEnv).trim() === '' ? 'nomic-embed-text' : String(mEnv).trim();
  const oEnv = process.env.OLLAMA_URL;
  const ollama_url =
    oEnv == null || String(oEnv).trim() === '' ? 'http://localhost:11434' : String(oEnv).trim();
  if (inServerless && provider === 'ollama' && !warnedOllamaLocalhostOnNetlify) {
    warnedOllamaLocalhostOnNetlify = true;
    const t = String(ollama_url).trim() || 'http://localhost:11434';
    try {
      if (/^https?:\/\//i.test(t)) {
        const u = new URL(t);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          console.warn(
            '[bridge] EMBEDDING_PROVIDER=ollama with localhost OLLAMA_URL cannot reach your machine from Netlify. ' +
              'Set EMBEDDING_PROVIDER=openai and OPENAI_API_KEY, or OLLAMA_URL to a public https:// Ollama API base.',
          );
        }
      }
    } catch (_) {
      /* embed path will throw a clearer error via normalizeOllamaEmbedBaseUrl */
    }
  }
  return {
    provider,
    model,
    ollama_url,
  };
}

/**
 * Undici/fetch often throws TypeError with message "Invalid URL" only — map to actionable text for operators.
 * @param {unknown} err
 * @param {'index'|'search'} kind
 */
function bridgeEmbedFailureMessage(err, kind) {
  const raw = err && typeof err.message === 'string' ? err.message : String(err);
  if (raw !== 'Invalid URL' && !raw.includes('Invalid URL')) return raw;
  const c = getBridgeEmbeddingConfig();
  const hasOpenAiKey = Boolean(
    process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim(),
  );
  return (
    `${raw} (${kind}). On Netlify, Invalid URL often means sqlite-vec was esbuild-bundled ` +
    '(stack: getLoadablePath / input ".") — set [functions].external_node_modules for sqlite-vec and better-sqlite3 in netlify.toml. ' +
    `Resolved EMBEDDING_PROVIDER="${c.provider}"; OPENAI_API_KEY ${hasOpenAiKey ? 'is set' : 'is missing'}. ` +
    'If provider is ollama, OLLAMA_URL must be a full http(s) URL. Remove bad HTTP_PROXY/HTTPS_PROXY if set. ' +
    'See docs/DEPLOY-HOSTED.md (bridge semantic index/search).'
  );
}

const DB_FILENAME = 'knowtation_vectors.db';

function getBridgeStoreConfig(uid, vectorsDirOverride) {
  const vectorsDir = vectorsDirOverride ?? (() => {
    const d = path.join(DATA_DIR, 'vectors', sanitizeUserId(uid));
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  })();
  return {
    vector_store: 'sqlite-vec',
    data_dir: vectorsDir,
    embedding: getBridgeEmbeddingConfig(),
  };
}

const isServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
function encrypt(text, secret) {
  const key = crypto.scryptSync(secret, 'salt', 32);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64url') + '.' + tag.toString('base64url') + '.' + enc.toString('base64url');
}
function decrypt(encrypted, secret) {
  const [ivB, tagB, encB] = encrypted.split('.');
  if (!ivB || !tagB || !encB) return null;
  const key = crypto.scryptSync(secret, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return decipher.update(Buffer.from(encB, 'base64url')) + decipher.final('utf8');
}

function parseAndDecryptTokens(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let decryptFailures = 0;
  for (const [uid, v] of Object.entries(raw)) {
    if (v && typeof v.token === 'string') {
      const t = decrypt(v.token, SESSION_SECRET);
      if (t) out[uid] = { token: t, repo: v.repo || null };
      else decryptFailures++;
    }
  }
  if (decryptFailures > 0) {
    console.warn(
      '[bridge] loadTokens: decrypt failed for',
      decryptFailures,
      'stored GitHub token(s). If SESSION_SECRET was rotated on the bridge, run Connect GitHub again to re-store the token.'
    );
  }
  return out;
}

async function loadTokens(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(TOKENS_FILE)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
      return parseAndDecryptTokens(raw);
    } catch (_) {
      return {};
    }
  }
  try {
    const rawStr = await blobStore.get('hub_github_tokens');
    if (!rawStr) return {};
    const raw = JSON.parse(rawStr);
    return parseAndDecryptTokens(raw);
  } catch (_) {
    return {};
  }
}

async function saveTokens(blobStore, tokens) {
  const toWrite = {};
  for (const [uid, v] of Object.entries(tokens)) {
    toWrite[uid] = { token: encrypt(v.token, SESSION_SECRET), repo: v.repo || null };
  }
  const str = JSON.stringify(toWrite, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(TOKENS_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_github_tokens', str);
}

// ——— Roles & invites (hosted parity: same contract as self-hosted hub/roles.mjs, hub/invites.mjs) ———
async function loadRoles(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(ROLES_FILE)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
      const roles = data.roles != null ? data.roles : data;
      return typeof roles === 'object' && roles !== null ? roles : {};
    } catch (_) {
      return {};
    }
  }
  try {
    const rawStr = await blobStore.get('hub_roles');
    if (!rawStr) return {};
    const data = JSON.parse(rawStr);
    const roles = data.roles != null ? data.roles : data;
    return typeof roles === 'object' && roles !== null ? roles : {};
  } catch (_) {
    return {};
  }
}

async function saveRoles(blobStore, roles) {
  const obj = {};
  for (const [sub, role] of Object.entries(roles)) {
    if (typeof sub === 'string' && sub.trim() && VALID_ROLES.has(role)) obj[sub.trim()] = role;
  }
  const str = JSON.stringify({ roles: obj }, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(ROLES_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_roles', str);
}

async function loadInvites(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(INVITES_FILE)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(INVITES_FILE, 'utf8'));
      const invites = data.invites && typeof data.invites === 'object' ? data.invites : {};
      return invites;
    } catch (_) {
      return {};
    }
  }
  try {
    const rawStr = await blobStore.get('hub_invites');
    if (!rawStr) return {};
    const data = JSON.parse(rawStr);
    const invites = data.invites && typeof data.invites === 'object' ? data.invites : {};
    return invites;
  } catch (_) {
    return {};
  }
}

async function saveInvites(blobStore, invites) {
  const obj = {};
  for (const [token, entry] of Object.entries(invites)) {
    if (typeof token === 'string' && token && entry && typeof entry.role === 'string' && typeof entry.created_at === 'string') {
      obj[token] = { role: entry.role, created_at: entry.created_at };
    }
  }
  const str = JSON.stringify({ invites: obj }, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(INVITES_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_invites', str);
}

async function loadWorkspace(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(WORKSPACE_FILE)) return { owner_user_id: null };
    try {
      const data = JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf8'));
      const id = data?.owner_user_id;
      return { owner_user_id: typeof id === 'string' && id.trim() ? id.trim() : null };
    } catch (_) {
      return { owner_user_id: null };
    }
  }
  try {
    const rawStr = await blobStore.get('hub_workspace');
    if (!rawStr) return { owner_user_id: null };
    const data = JSON.parse(rawStr);
    const id = data?.owner_user_id;
    return { owner_user_id: typeof id === 'string' && id.trim() ? id.trim() : null };
  } catch (_) {
    return { owner_user_id: null };
  }
}

async function saveWorkspace(blobStore, ownerUserId) {
  const payload = JSON.stringify(
    { owner_user_id: ownerUserId && String(ownerUserId).trim() ? String(ownerUserId).trim() : null },
    null,
    2,
  );
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(WORKSPACE_FILE, payload, 'utf8');
    return;
  }
  await blobStore.set('hub_workspace', payload);
}

async function loadVaultAccess(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(VAULT_ACCESS_FILE)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(VAULT_ACCESS_FILE, 'utf8'));
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
  try {
    const rawStr = await blobStore.get('hub_vault_access');
    if (!rawStr) return {};
    const data = JSON.parse(rawStr);
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

async function saveVaultAccess(blobStore, access) {
  const obj = {};
  for (const [uid, arr] of Object.entries(access || {})) {
    if (typeof uid === 'string' && uid.trim() && Array.isArray(arr)) {
      obj[uid.trim()] = arr.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
    }
  }
  const str = JSON.stringify(obj, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(VAULT_ACCESS_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_vault_access', str);
}

async function loadScope(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(SCOPE_FILE)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (_) {
      return {};
    }
  }
  try {
    const rawStr = await blobStore.get('hub_scope');
    if (!rawStr) return {};
    const data = JSON.parse(rawStr);
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

async function saveScope(blobStore, scope) {
  const cleaned = {};
  for (const [uid, vaultMap] of Object.entries(scope || {})) {
    if (typeof uid !== 'string' || !uid.trim() || !vaultMap || typeof vaultMap !== 'object') continue;
    cleaned[uid.trim()] = {};
    for (const [vaultId, rules] of Object.entries(vaultMap)) {
      if (typeof vaultId !== 'string' || !vaultId.trim() || !rules || typeof rules !== 'object') continue;
      const projects = Array.isArray(rules.projects)
        ? rules.projects.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
        : [];
      const folders = Array.isArray(rules.folders)
        ? rules.folders.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
        : [];
      if (projects.length > 0 || folders.length > 0) {
        cleaned[uid.trim()][vaultId.trim()] = { projects, folders };
      }
    }
  }
  const str = JSON.stringify(cleaned, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(SCOPE_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_scope', str);
}

/** @returns {Promise<string[]>} */
async function fetchCanisterVaultIdsForUser(canisterUserId) {
  if (!CANISTER_URL || !canisterUserId) return ['default'];
  try {
    const vRes = await fetch(CANISTER_URL + '/api/v1/vaults', {
      method: 'GET',
      headers: { 'X-User-Id': canisterUserId, Accept: 'application/json' },
    });
    if (!vRes.ok) return ['default'];
    const data = await vRes.json();
    const vaults = Array.isArray(data.vaults) ? data.vaults : [];
    if (vaults.length === 0) return ['default'];
    return vaults.map((v) => String(v.id || 'default')).filter(Boolean);
  } catch (_) {
    return ['default'];
  }
}

/**
 * @param {import('express').Request} req
 * @param {string} actorUid
 * @returns {Promise<{ ok: true, effectiveCanisterUid: string, actorUid: string, vaultId: string, scope: { projects: string[], folders: string[] } | null, allowedVaultIds: string[], delegating: boolean } | { ok: false, status: number, code: string, error: string }>}
 */
async function resolveHostedBridgeContext(req, actorUid) {
  const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
  const workspace = await loadWorkspace(req.blobStore);
  const roles = await loadRoles(req.blobStore);
  const access = await loadVaultAccess(req.blobStore);
  const scopeMap = await loadScope(req.blobStore);
  const ownerId = workspace.owner_user_id;
  const { effective, delegate } = resolveEffectiveCanisterUser({
    actorSub: actorUid,
    workspaceOwnerId: ownerId,
    storedRoles: roles,
    adminUserIdsSet,
  });
  const allowedRaw = getAllowedVaultIdsFromAccessMap(access, actorUid);
  const canisterIds = await fetchCanisterVaultIdsForUser(effective);
  const allowedVaultIds = intersectVaultIds(canisterIds, allowedRaw);
  if (!allowedVaultIds.includes(vaultId)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      error: 'Access to this vault is not allowed.',
    };
  }
  const scope = getScopeForUserVaultFromScopeMap(scopeMap, actorUid, vaultId);
  return {
    ok: true,
    effectiveCanisterUid: effective,
    actorUid,
    vaultId,
    scope,
    allowedVaultIds,
    delegating: delegate,
  };
}

function effectiveRole(uid, storedRoles) {
  if (!uid) return 'member';
  const stored = storedRoles && storedRoles[uid];
  if (stored && VALID_ROLES.has(stored)) return stored;
  return adminUserIdsSet.has(uid) ? 'admin' : 'member';
}

/** Return a directory path that contains (or will contain) knowtation_vectors.db for this user and vault. Rehydrates from Blob if needed. Phase 15: keyed by (uid, vault_id). */
async function getVectorsDirForUser(req, uid) {
  const safeUid = sanitizeUserId(uid);
  const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
  if (!req.blobStore) {
    const d = path.join(DATA_DIR, 'vectors', safeUid, vaultId);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }
  const dir = path.join(os.tmpdir(), 'knowtation-bridge-vectors', safeUid, vaultId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const key = 'vectors/' + safeUid + '/' + vaultId;
  try {
    const data = await req.blobStore.get(key, { type: 'arrayBuffer' });
    if (data && data.byteLength > 0) {
      fs.writeFileSync(path.join(dir, DB_FILENAME), Buffer.from(data));
    }
  } catch (_) {
    // No existing blob or read error; start fresh
  }
  return dir;
}

/** Persist user's vector DB from disk to Blob (call after index). Phase 15: key includes vault_id. */
async function persistVectorsToBlob(req, uid, vectorsDir) {
  if (!req.blobStore) return;
  const dbPath = path.join(vectorsDir, DB_FILENAME);
  if (!fs.existsSync(dbPath)) return;
  const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
  const key = 'vectors/' + sanitizeUserId(uid) + '/' + vaultId;
  const buf = fs.readFileSync(dbPath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await req.blobStore.set(key, arrayBuffer);
}

function signState(payload) {
  const payloadStr = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('hex');
  return Buffer.from(payloadStr).toString('base64url') + '.' + sig;
}

function verifyState(stateStr, maxAgeMs = 600000) {
  if (!stateStr || typeof stateStr !== 'string') return null;
  const [b64, sig] = stateStr.split('.');
  if (!b64 || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(JSON.stringify(payload)).digest('hex');
    if (expected !== sig) return null;
    if (Date.now() - (payload.ts || 0) > maxAgeMs) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function userIdFromJwt(token) {
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    return payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  req.blobStore = globalThis.__netlify_blob_store || null;
  next();
});

app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.HUB_CORS_ORIGIN || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Credentials', 'true');
  next();
});

// When Netlify rewrites /* to /.netlify/functions/bridge/:splat, Express sees the full path; strip prefix so routes match.
if (inServerless) {
  const bridgePrefix = '/.netlify/functions/bridge';
  app.use((req, _res, next) => {
    if (req.url.startsWith(bridgePrefix)) {
      req.url = req.url.slice(bridgePrefix.length) || '/';
    }
    next();
  });
}

// ——— Roles & invites (hosted parity) ———
async function requireBridgeAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  req.uid = uid;
  next();
}

async function requireBridgeAdmin(req, res, next) {
  const roles = await loadRoles(req.blobStore);
  const role = effectiveRole(req.uid, roles);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
  next();
}

app.get('/api/v1/roles', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  try {
    const roles = await loadRoles(req.blobStore);
    res.json({ roles });
  } catch (e) {
    console.error('[bridge] GET /api/v1/roles', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/roles', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const { user_id: userId, role } = req.body || {};
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'user_id required (e.g. github:12345)', code: 'BAD_REQUEST' });
  }
  const r = (role || 'editor').toLowerCase();
  if (!VALID_ROLES.has(r)) {
    return res.status(400).json({ error: 'role must be admin, editor, or viewer', code: 'BAD_REQUEST' });
  }
  try {
    const roles = await loadRoles(req.blobStore);
    roles[userId.trim()] = r;
    await saveRoles(req.blobStore, roles);
    res.json({ ok: true });
  } catch (e) {
    console.error('[bridge] POST /api/v1/roles', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/v1/invites', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  try {
    const invitesMap = await loadInvites(req.blobStore);
    const now = Date.now();
    const list = [];
    for (const [token, entry] of Object.entries(invitesMap)) {
      const created = new Date(entry.created_at).getTime();
      const expires_at = new Date(created + INVITE_EXPIRY_MS).toISOString();
      if (now - created <= INVITE_EXPIRY_MS) {
        list.push({ token, role: entry.role, created_at: entry.created_at, expires_at });
      }
    }
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ invites: list });
  } catch (e) {
    console.error('[bridge] GET /api/v1/invites', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/invites', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const role = (req.body?.role || 'editor').toLowerCase();
  if (!['viewer', 'editor', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'role must be viewer, editor, or admin', code: 'BAD_REQUEST' });
  }
  try {
    const token = crypto.randomBytes(24).toString('base64url');
    const created_at = new Date().toISOString();
    const expires_at = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();
    const invites = await loadInvites(req.blobStore);
    invites[token] = { role, created_at };
    await saveInvites(req.blobStore, invites);
    const base = (HUB_UI_ORIGIN + (HUB_UI_PATH || '/hub') + '/').replace(/(\/)+$/, '/');
    const invite_url = base + '?invite=' + encodeURIComponent(token);
    res.status(201).json({ invite_url, token, role, created_at, expires_at });
  } catch (e) {
    console.error('[bridge] POST /api/v1/invites', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.delete('/api/v1/invites/:token', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).json({ error: 'token required', code: 'BAD_REQUEST' });
  try {
    const invites = await loadInvites(req.blobStore);
    const had = token in invites;
    delete invites[token];
    await saveInvites(req.blobStore, invites);
    res.json({ ok: true, removed: had });
  } catch (e) {
    console.error('[bridge] DELETE /api/v1/invites/:token', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/invites/consume', requireBridgeAuth, async (req, res) => {
  const token = req.body?.token;
  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ error: 'token required', code: 'BAD_REQUEST' });
  }
  const uid = req.uid;
  try {
    const invites = await loadInvites(req.blobStore);
    const entry = invites[token];
    if (!entry) {
      return res.status(404).json({ error: 'Invite not found or already used', code: 'NOT_FOUND' });
    }
    const created = new Date(entry.created_at).getTime();
    if (Date.now() - created > INVITE_EXPIRY_MS) {
      delete invites[token];
      await saveInvites(req.blobStore, invites);
      return res.status(410).json({ error: 'Invite expired', code: 'EXPIRED' });
    }
    const roles = await loadRoles(req.blobStore);
    roles[uid] = entry.role;
    await saveRoles(req.blobStore, roles);
    delete invites[token];
    await saveInvites(req.blobStore, invites);
    res.json({ ok: true, role: entry.role });
  } catch (e) {
    console.error('[bridge] POST /api/v1/invites/consume', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

// For gateway GET /api/v1/settings: return role from bridge store so invited users get correct role
app.get('/api/v1/role', requireBridgeAuth, async (req, res) => {
  try {
    const roles = await loadRoles(req.blobStore);
    const role = effectiveRole(req.uid, roles);
    res.json({ role });
  } catch (e) {
    console.error('[bridge] GET /api/v1/role', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/v1/workspace', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  try {
    const w = await loadWorkspace(req.blobStore);
    res.json({ owner_user_id: w.owner_user_id });
  } catch (e) {
    console.error('[bridge] GET /api/v1/workspace', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/workspace', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const raw = req.body?.owner_user_id;
  const owner_user_id =
    raw === null || raw === undefined || raw === ''
      ? null
      : typeof raw === 'string' && raw.trim()
        ? raw.trim()
        : null;
  try {
    await saveWorkspace(req.blobStore, owner_user_id);
    const w = await loadWorkspace(req.blobStore);
    res.json({ ok: true, owner_user_id: w.owner_user_id });
  } catch (e) {
    console.error('[bridge] POST /api/v1/workspace', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/v1/vault-access', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  try {
    const access = await loadVaultAccess(req.blobStore);
    res.json({ access });
  } catch (e) {
    console.error('[bridge] GET /api/v1/vault-access', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/vault-access', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const access = req.body?.access;
  if (!access || typeof access !== 'object') {
    return res.status(400).json({ error: 'access object required', code: 'BAD_REQUEST' });
  }
  try {
    await saveVaultAccess(req.blobStore, access);
    const out = await loadVaultAccess(req.blobStore);
    res.json({ ok: true, access: out });
  } catch (e) {
    console.error('[bridge] POST /api/v1/vault-access', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/v1/scope', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  try {
    const scope = await loadScope(req.blobStore);
    res.json({ scope });
  } catch (e) {
    console.error('[bridge] GET /api/v1/scope', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/scope', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const scope = req.body?.scope;
  if (!scope || typeof scope !== 'object') {
    return res.status(400).json({ error: 'scope object required', code: 'BAD_REQUEST' });
  }
  try {
    await saveScope(req.blobStore, scope);
    const out = await loadScope(req.blobStore);
    res.json({ ok: true, scope: out });
  } catch (e) {
    console.error('[bridge] POST /api/v1/scope', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/v1/hosted-context', requireBridgeAuth, async (req, res) => {
  try {
    const actor = req.uid;
    const workspace = await loadWorkspace(req.blobStore);
    const roles = await loadRoles(req.blobStore);
    const ctx = await resolveHostedBridgeContext(req, actor);
    if (!ctx.ok) {
      return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });
    }
    const role = effectiveRole(actor, roles);
    res.json({
      actor_sub: actor,
      workspace_owner_id: workspace.owner_user_id,
      effective_canister_user_id: ctx.effectiveCanisterUid,
      delegating: ctx.delegating,
      allowed_vault_ids: ctx.allowedVaultIds,
      scope: ctx.scope,
      role,
    });
  } catch (e) {
    console.error('[bridge] GET /api/v1/hosted-context', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

// ——— Connect GitHub ———
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  app.get('/auth/github-connect', (req, res) => {
    const token = req.query.token || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') && req.headers.authorization.slice(7));
    const uid = token ? userIdFromJwt(token) : null;
    if (!uid) {
      return res.redirect(HUB_UI_ORIGIN + HUB_UI_PATH + '/?github_connect_error=not_authenticated');
    }
    const state = signState({ uid, ts: Date.now() });
    const redirectUri = BASE_URL + '/auth/callback/github-connect';
    const url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(process.env.GITHUB_CLIENT_ID)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&scope=repo'
      + '&state=' + encodeURIComponent(state);
    res.redirect(url);
  });

  app.get('/auth/callback/github-connect', async (req, res) => {
    const { code, state } = req.query || {};
    const hubBase = HUB_UI_ORIGIN + HUB_UI_PATH + '/';
    console.log('[bridge] callback: hubBase=%s (ORIGIN=%s PATH=%s)', hubBase, HUB_UI_ORIGIN, HUB_UI_PATH);
    const payload = verifyState(state);
    if (!payload) {
      const url = hubBase + '?github_connect_error=error_state';
      console.log('[bridge] redirect (error_state): %s', url);
      return res.redirect(302, url);
    }
    if (!code) {
      const url = hubBase + '?github_connect_error=error_code';
      console.log('[bridge] redirect (error_code): %s', url);
      return res.redirect(302, url);
    }
    const uid = payload.uid;
    const redirectUri = BASE_URL + '/auth/callback/github-connect';
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await tokenRes.json();
    if (!data.access_token) {
      const url = hubBase + '?github_connect_error=error_token';
      console.log('[bridge] redirect (error_token): %s', url);
      return res.redirect(302, url);
    }
    const tokensByUser = await loadTokens(req.blobStore);
    tokensByUser[uid] = { token: data.access_token, repo: tokensByUser[uid]?.repo || null };
    try {
      await saveTokens(req.blobStore, tokensByUser);
    } catch (e) {
      console.error('[bridge] saveTokens after GitHub OAuth failed:', e?.message || e);
      const url = hubBase + '?github_connect_error=blob_storage';
      return res.redirect(302, url);
    }
    const redirectTo = hubBase + '?github_connected=1';
    console.log('[bridge] redirect after connect: HUB_UI_ORIGIN=%s HUB_UI_PATH=%s redirectTo=%s', HUB_UI_ORIGIN, HUB_UI_PATH, redirectTo);
    res.redirect(302, redirectTo);
  });
}

// ——— Back up now: fetch vault from canister, push to GitHub ———
app.post('/api/v1/vault/sync', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const hctx = await resolveHostedBridgeContext(req, uid);
  if (!hctx.ok) {
    return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
  }
  const canisterUid = hctx.effectiveCanisterUid;

  const tokensByUser = await loadTokens(req.blobStore);
  const conn = tokensByUser[uid];
  const repo = req.body?.repo || conn?.repo;
  if (!conn?.token) {
    return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
  }
  if (!repo || typeof repo !== 'string') {
    return res.status(400).json({ error: 'Repo required', code: 'REPO_REQUIRED', hint: 'Send { "repo": "owner/name" } or set repo after connecting GitHub.' });
  }

  const [owner, name] = repo.split('/').filter(Boolean);
  if (!owner || !name) {
    return res.status(400).json({ error: 'Invalid repo format', code: 'BAD_REQUEST' });
  }

  // Fetch vault from canister (export)
  let exportRes;
  try {
    const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
    exportRes = await fetch(CANISTER_URL + '/api/v1/export', {
      method: 'GET',
      headers: { 'X-User-Id': canisterUid, 'X-Vault-Id': vaultId, Accept: 'application/json' },
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach canister', code: 'BAD_GATEWAY' });
  }
  if (!exportRes.ok) {
    return res.status(502).json({ error: 'Canister error', code: 'BAD_GATEWAY', status: exportRes.status });
  }
  let vault;
  try {
    vault = await exportRes.json();
  } catch (_) {
    return res.status(502).json({ error: 'Invalid canister response', code: 'BAD_GATEWAY' });
  }
  let notes = vault.notes || [];
  if (hctx.scope) {
    notes = applyScopeFilterToNotes(notes, hctx.scope);
  }

  // Store repo for next time
  if (req.body?.repo && (!conn.repo || conn.repo !== repo)) {
    tokensByUser[uid] = { ...conn, repo };
    await saveTokens(req.blobStore, tokensByUser);
  }

  // Push to GitHub: get default branch, create blobs, create tree, commit, push
  const ghToken = conn.token;
  const ghApi = 'https://api.github.com';
  // GitHub requires a non-empty User-Agent; some serverless runtimes send none → 403 "Administrative rules".
  const ghHeaders = {
    Authorization: 'token ' + ghToken,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'KnowtationHub-Bridge/1.0 (+https://knowtation.store)',
  };
  const headsRefEnc = (branch) => encodeURIComponent(`heads/${String(branch || 'main').trim()}`);

  let defaultBranch;
  try {
    const repoRes = await fetch(`${ghApi}/repos/${owner}/${name}`, { headers: ghHeaders });
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        return res.status(400).json({ error: 'Repo not found or no access', code: 'REPO_NOT_FOUND' });
      }
      throw new Error('GitHub API ' + repoRes.status);
    }
    const repoData = await repoRes.json();
    defaultBranch = String(repoData.default_branch || 'main').trim() || 'main';
  } catch (e) {
    return res.status(502).json({ error: 'GitHub API error', code: 'BAD_GATEWAY' });
  }

  // GET single ref: documented as /git/ref/{ref} with ref = heads/<branch> (URL-encoded). Avoids edge cases with /git/refs/... on some hosts.
  const refRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/ref/${headsRefEnc(defaultBranch)}`, { headers: ghHeaders });
  let baseSha = null;
  let baseTreeSha = null;
  if (refRes.ok) {
    const refData = await refRes.json();
    baseSha = refData.object?.sha;
    if (!baseSha) {
      return res.status(502).json({ error: 'Invalid ref response', code: 'BAD_GATEWAY' });
    }
    const baseTreeRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/commits/${baseSha}`, { headers: ghHeaders });
    if (!baseTreeRes.ok) {
      return res.status(502).json({ error: 'Could not get base commit', code: 'BAD_GATEWAY' });
    }
    const baseCommit = await baseTreeRes.json();
    baseTreeSha = baseCommit.tree?.sha;
  } else if (refRes.status === 404) {
    // Repo exists on GitHub but has no commits yet (Quick setup / empty repo) — no refs/heads/* yet.
    baseSha = null;
    baseTreeSha = null;
  } else {
    const refErrBody = await refRes.text();
    console.warn('[bridge] GitHub GET ref failed', { owner, name, branch: defaultBranch, status: refRes.status, body: refErrBody.slice(0, 500) });
    if (refRes.status === 403 || refRes.status === 401) {
      return res.status(502).json({
        error:
          'GitHub denied access when reading the branch (often missing User-Agent or expired token). Use Settings → Connect GitHub again.',
        code: 'BAD_GATEWAY',
      });
    }
    return res.status(502).json({
      error: 'Could not read branch on GitHub. If the repo is new with no commits, try Back up again after redeploying the bridge; otherwise check bridge logs.',
      code: 'BAD_GATEWAY',
    });
  }

  const tree = [];
  for (const note of notes) {
    const path = note.path || 'note.md';
    const content = (note.frontmatter && note.frontmatter !== '{}' ? '---\n' + note.frontmatter + '\n---\n\n' : '') + (note.body || '');
    const blobRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/blobs`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' }),
    });
    if (!blobRes.ok) {
      return res.status(502).json({ error: 'GitHub blob failed', code: 'BAD_GATEWAY' });
    }
    const blob = await blobRes.json();
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const isInitialCommit = !baseSha;
  if (isInitialCommit && tree.length === 0) {
    const placeholder =
      '# Knowtation vault backup\n\n'
      + 'Your hosted vault had no notes yet. Add notes in the Hub and run **Back up now** again to sync them here.\n';
    const blobRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/blobs`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        content: Buffer.from(placeholder, 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    });
    if (!blobRes.ok) {
      return res.status(502).json({ error: 'GitHub blob failed', code: 'BAD_GATEWAY' });
    }
    const blob = await blobRes.json();
    tree.push({ path: '.knowtation/README.md', mode: '100644', type: 'blob', sha: blob.sha });
  }

  const treePayload = baseTreeSha ? { base_tree: baseTreeSha, tree } : { tree };
  const treeRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/trees`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify(treePayload),
  });
  if (!treeRes.ok) {
    return res.status(502).json({ error: 'GitHub tree failed', code: 'BAD_GATEWAY' });
  }
  const newTree = await treeRes.json();

  const commitRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/commits`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({
      message: 'Knowtation Hub backup ' + new Date().toISOString(),
      tree: newTree.sha,
      parents: baseSha ? [baseSha] : [],
    }),
  });
  if (!commitRes.ok) {
    return res.status(502).json({ error: 'GitHub commit failed', code: 'BAD_GATEWAY' });
  }
  const newCommit = await commitRes.json();

  let refUpdateRes;
  if (baseSha) {
    refUpdateRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/refs/${headsRefEnc(defaultBranch)}`, {
      method: 'PATCH',
      headers: ghHeaders,
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    });
  } else {
    refUpdateRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/refs`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ ref: `refs/heads/${defaultBranch}`, sha: newCommit.sha }),
    });
  }
  if (!refUpdateRes.ok) {
    return res.status(502).json({ error: 'GitHub push failed', code: 'BAD_GATEWAY' });
  }

  res.json({ ok: true, message: 'Synced', notesCount: notes.length });
});

// Optional: GET status for Settings (connected + repo)
app.get('/api/v1/vault/github-status', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const tokensByUser = await loadTokens(req.blobStore);
  const conn = tokensByUser[uid];
  res.json({
    github_connected: Boolean(conn?.token),
    repo: conn?.repo || null,
  });
});

// ——— Index + Search (hosted: indexer runs in bridge, canister does not run Node) ———
const BATCH_EMBED = 10;
const BATCH_UPSERT = 50;

app.post('/api/v1/index', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const hctx = await resolveHostedBridgeContext(req, uid);
  if (!hctx.ok) {
    return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
  }
  const canisterUid = hctx.effectiveCanisterUid;
  const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
  let exportRes;
  try {
    exportRes = await fetch(CANISTER_URL + '/api/v1/export', {
      method: 'GET',
      headers: { 'X-User-Id': canisterUid, 'X-Vault-Id': vaultId, Accept: 'application/json' },
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach canister', code: 'BAD_GATEWAY' });
  }
  if (!exportRes.ok) {
    return res.status(502).json({ error: 'Canister export failed', code: 'BAD_GATEWAY', status: exportRes.status });
  }
  let vault;
  try {
    vault = await exportRes.json();
  } catch (_) {
    return res.status(502).json({ error: 'Invalid canister response', code: 'BAD_GATEWAY' });
  }
  let notes = vault.notes || [];
  if (hctx.scope) {
    notes = applyScopeFilterToNotes(notes, hctx.scope);
  }
  try {
    if (!globalThis.__knowtation_bridge_embed_logged) {
      globalThis.__knowtation_bridge_embed_logged = true;
      const c = getBridgeEmbeddingConfig();
      const hasOpenAiKey = Boolean(
        process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim(),
      );
      console.log(
        '[bridge] embedding (no secrets):',
        JSON.stringify({
          provider: c.provider,
          model: c.model,
          ollama_url_set: Boolean(process.env.OLLAMA_URL && String(process.env.OLLAMA_URL).trim()),
          openai_key_set: hasOpenAiKey,
        }),
      );
    }
    const { chunkNote } = await import('../../lib/chunk.mjs');
    const { embed, embeddingDimension } = await import('../../lib/embedding.mjs');
    const { createVectorStore } = await import('../../lib/vector-store.mjs');

    const vectorsDir = await getVectorsDirForUser(req, canisterUid);
    const storeConfig = getBridgeStoreConfig(canisterUid, vectorsDir);
    const chunkOpts = {
      chunkSize: parseInt(process.env.INDEXER_CHUNK_SIZE || '2048', 10),
      chunkOverlap: parseInt(process.env.INDEXER_CHUNK_OVERLAP || '256', 10),
    };
    const allChunks = [];
    for (const n of notes) {
      const note = {
        body: n.body || '',
        path: n.path || 'note.md',
        project: undefined,
        tags: [],
        date: undefined,
      };
      const chunks = chunkNote(note, chunkOpts);
      for (const c of chunks) allChunks.push(c);
    }
    if (allChunks.length === 0) {
      const store = await createVectorStore(storeConfig);
      const dim = embeddingDimension(storeConfig.embedding);
      await store.ensureCollection(dim);
      return res.json({ ok: true, notesProcessed: notes.length, chunksIndexed: 0 });
    }
    const embeddingConfig = storeConfig.embedding;
    const vectors = [];
    for (let i = 0; i < allChunks.length; i += BATCH_EMBED) {
      const batch = allChunks.slice(i, i + BATCH_EMBED);
      const texts = batch.map((c) => c.text);
      const batchVectors = await embed(texts, embeddingConfig);
      for (let j = 0; j < batch.length; j++) {
        vectors.push(batchVectors[j] || []);
      }
    }
    const dim = embeddingDimension(embeddingConfig);
    const store = await createVectorStore(storeConfig);
    await store.ensureCollection(dim);
    for (let i = 0; i < allChunks.length; i += BATCH_UPSERT) {
      const batch = allChunks.slice(i, i + BATCH_UPSERT);
      const points = batch.map((chunk, j) => ({
        id: `${vaultId}::${chunk.id}`,
        vector: vectors[i + j] || [],
        text: chunk.text,
        path: chunk.path,
        vault_id: vaultId,
        project: chunk.project,
        tags: chunk.tags,
        date: chunk.date,
        causal_chain_id: chunk.causal_chain_id,
        entity: chunk.entity,
        episode_id: chunk.episode_id,
      }));
      await store.upsert(points);
    }
    await persistVectorsToBlob(req, canisterUid, vectorsDir);
    return res.json({ ok: true, notesProcessed: notes.length, chunksIndexed: allChunks.length });
  } catch (e) {
    console.error('Bridge index error:', e);
    return res.status(500).json({
      error: 'Index failed',
      code: 'INTERNAL_ERROR',
      message: bridgeEmbedFailureMessage(e, 'index'),
    });
  }
});

function truncateSnippet(text, maxChars = 300) {
  if (text == null || typeof text !== 'string') return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > maxChars / 2 ? slice.slice(0, lastSpace) : slice) + '…';
}

app.post('/api/v1/search', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const hctx = await resolveHostedBridgeContext(req, uid);
  if (!hctx.ok) {
    return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
  }
  const canisterUid = hctx.effectiveCanisterUid;
  const query = req.body?.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required', code: 'BAD_REQUEST' });
  }
  const limit = Math.max(1, Math.min(parseInt(req.body?.limit, 10) || 20, 100));
  const snippetChars = parseInt(req.body?.snippetChars, 10) || 300;
  try {
    const { embed } = await import('../../lib/embedding.mjs');
    const { createVectorStore } = await import('../../lib/vector-store.mjs');

    const vectorsDir = await getVectorsDirForUser(req, canisterUid);
    const storeConfig = getBridgeStoreConfig(canisterUid, vectorsDir);
    const store = await createVectorStore(storeConfig);
    const bridgeVaultId = sanitizeVaultId(req.headers['x-vault-id']);
    const [queryVector] = await embed([query], storeConfig.embedding);
    if (!queryVector) {
      return res.status(500).json({ error: 'Embedding failed', code: 'INTERNAL_ERROR' });
    }
    const hits = await store.search(queryVector, {
      limit,
      vault_id: bridgeVaultId,
      project: req.body?.project,
      tag: req.body?.tag,
      folder: req.body?.folder,
      since: req.body?.since,
      until: req.body?.until,
      order: req.body?.order,
      chain: req.body?.chain,
      entity: req.body?.entity,
      episode: req.body?.episode,
    });
    let results = (hits || []).map((h) => ({
      path: h.path,
      score: h.score,
      project: h.project ?? null,
      tags: h.tags ?? [],
      snippet: truncateSnippet(h.text, snippetChars),
    }));
    if (hctx.scope) {
      results = applyScopeFilterToNotes(results, hctx.scope);
    }
    return res.json({ results, query });
  } catch (e) {
    console.error('Bridge search error:', e);
    return res.status(500).json({
      error: 'Search failed',
      code: 'INTERNAL_ERROR',
      message: bridgeEmbedFailureMessage(e, 'search'),
    });
  }
});

if (!isServerless) {
  if (!CANISTER_URL || !SESSION_SECRET) {
    console.error('Bridge: CANISTER_URL and SESSION_SECRET (or HUB_JWT_SECRET) are required');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log('Knowtation Hub Bridge listening on http://localhost:' + PORT);
    console.log('  Canister: ' + CANISTER_URL);
    console.log('  GitHub connect: ' + (process.env.GITHUB_CLIENT_ID ? 'enabled' : 'not configured'));
    console.log('  Index/Search: ' + (process.env.EMBEDDING_PROVIDER || 'ollama') + ' (run POST /api/v1/index to index)');
  });
}

export { app };
