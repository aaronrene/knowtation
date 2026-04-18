/**
 * Knowtation Hub Bridge — Connect GitHub + Back up now + indexer + search for hosted product.
 * Stores GitHub token per user; sync fetches notes + full proposals from canister and pushes to repo (snapshot JSON + markdown).
 * Index/search: pull vault from canister, chunk → embed → sqlite-vec per user; search via POST /api/v1/search.
 * On Netlify, tokens and vector DBs persist via Netlify Blobs (set by netlify/functions/bridge.mjs).
 * Env: SESSION_SECRET, CANISTER_URL, HUB_BASE_URL; optional HUB_UI_ORIGIN, HUB_UI_PATH (default /hub), GITHUB_*, EMBEDDING_*, BRIDGE_PORT, DATA_DIR.
 * Consolidation: CONSOLIDATION_LLM_API_KEY / OPENAI_API_KEY, CONSOLIDATION_LLM_MODEL; CONSOLIDATION_MEMORY_ENCRYPT=true omits raw event payloads from consolidation LLM prompts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { parseCanisterProposalGetBody } from '../../lib/canister-proposal-response-parse.mjs';
import { runImport } from '../../lib/import.mjs';
import { IMPORT_SOURCE_TYPES } from '../../lib/import-source-types.mjs';
import { commitImageToRepo, parseGitHubRepoUrl, validateImageExtension, validateMagicBytes } from '../../lib/github-commit-image.mjs';
import { mergeProvenanceFrontmatter } from '../../lib/hub-provenance.mjs';
import { writeNote } from '../../lib/write.mjs';
import { resolveVaultRelativePath, parseFrontmatterAndBody } from '../../lib/vault.mjs';
import {
  resolveEffectiveCanisterUser,
  getScopeForUserVaultFromScopeMap,
  resolveAllowedVaultIdsForHostedContext,
} from '../lib/hosted-workspace-resolve.mjs';
import { applyScopeFilterToNotes, applyScopeFilterToProposals } from '../lib/scope-filter.mjs';
import { actorMayApproveProposals } from '../lib/hub-evaluator-may-approve.mjs';

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
const CANISTER_AUTH_SECRET = process.env.CANISTER_AUTH_SECRET || '';

/**
 * Base headers for all bridge→canister requests.
 * Includes x-gateway-auth when CANISTER_AUTH_SECRET is configured so the
 * canister's gatewayAuthorized() check (Phase 0) passes.
 * Uses the same env var name as the gateway (CANISTER_AUTH_SECRET).
 */
function canisterHeaders(extra = {}) {
  const h = { Accept: 'application/json', ...extra };
  if (CANISTER_AUTH_SECRET) h['x-gateway-auth'] = CANISTER_AUTH_SECRET;
  return h;
}
// On Netlify Lambda /var/task/ is read-only; only /tmp is writable.
// Use /tmp/knowtation-bridge-data when serverless and DATA_DIR is not explicitly set.
const DATA_DIR = process.env.DATA_DIR
  ? (path.isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : path.join(projectRoot, process.env.DATA_DIR))
  : (inServerless ? path.join(os.tmpdir(), 'knowtation-bridge-data') : path.join(projectRoot, 'data'));
const TOKENS_FILE = path.join(DATA_DIR, 'hub_github_tokens.json');
const ROLES_FILE = path.join(DATA_DIR, 'hub_roles.json');
const INVITES_FILE = path.join(DATA_DIR, 'hub_invites.json');
const WORKSPACE_FILE = path.join(DATA_DIR, 'hub_workspace.json');
const VAULT_ACCESS_FILE = path.join(DATA_DIR, 'hub_vault_access.json');
const SCOPE_FILE = path.join(DATA_DIR, 'hub_scope.json');
const EVALUATOR_MAY_APPROVE_FILE = path.join(DATA_DIR, 'hub_evaluator_may_approve.json');
const VALID_ROLES = new Set(['admin', 'editor', 'viewer', 'evaluator']);
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

function defaultEmbeddingModelForBridge(provider) {
  const p = String(provider || 'ollama').toLowerCase();
  if (p === 'openai') return 'text-embedding-3-small';
  if (p === 'voyage') return 'voyage-4-lite';
  return 'nomic-embed-text';
}

/** Trim + default empty env so accidental whitespace does not break provider matching or Ollama URL. */
function getBridgeEmbeddingConfig() {
  const pEnv = process.env.EMBEDDING_PROVIDER;
  const provider = (
    pEnv == null || String(pEnv).trim() === '' ? 'ollama' : String(pEnv).trim()
  ).toLowerCase();
  const mEnv = process.env.EMBEDDING_MODEL;
  const model =
    mEnv == null || String(mEnv).trim() === '' ? defaultEmbeddingModelForBridge(provider) : String(mEnv).trim();
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
  const hasVoyageKey = Boolean(process.env.VOYAGE_API_KEY && String(process.env.VOYAGE_API_KEY).trim());
  return (
    `${raw} (${kind}). On Netlify, Invalid URL often means sqlite-vec was esbuild-bundled ` +
    '(stack: getLoadablePath / input ".") — set [functions].external_node_modules for sqlite-vec and better-sqlite3 in netlify.toml. ' +
    `Resolved EMBEDDING_PROVIDER="${c.provider}"; OPENAI_API_KEY ${hasOpenAiKey ? 'is set' : 'is missing'}; ` +
    `VOYAGE_API_KEY ${hasVoyageKey ? 'is set' : 'is missing'}. ` +
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
const SALT_LEN = 16;
// Ciphertext format (v2): saltB64url.ivB64url.tagB64url.encB64url  (4 parts)
// Legacy format (v1):     ivB64url.tagB64url.encB64url             (3 parts — decrypt will return null → graceful reconnect)
function encrypt(text, secret) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = crypto.scryptSync(secret, salt, 32);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    salt.toString('base64url') + '.' +
    iv.toString('base64url') + '.' +
    tag.toString('base64url') + '.' +
    enc.toString('base64url')
  );
}
function decrypt(encrypted, secret) {
  const parts = encrypted.split('.');
  // v1 ciphertexts had 3 parts (hardcoded salt); treat as not-found so the
  // caller falls through to "prompt reconnect" without crashing.
  if (parts.length !== 4) return null;
  const [saltB, ivB, tagB, encB] = parts;
  if (!saltB || !ivB || !tagB || !encB) return null;
  try {
    const key = crypto.scryptSync(secret, Buffer.from(saltB, 'base64url'), 32);
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return decipher.update(Buffer.from(encB, 'base64url')) + decipher.final('utf8');
  } catch {
    return null;
  }
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

function bridgeEnvEvaluatorMayApprove() {
  return process.env.HUB_EVALUATOR_MAY_APPROVE === '1';
}

async function loadEvaluatorMayApproveMap(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(EVALUATOR_MAY_APPROVE_FILE)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(EVALUATOR_MAY_APPROVE_FILE, 'utf8'));
      const m = data?.evaluator_may_approve != null ? data.evaluator_may_approve : data;
      if (typeof m !== 'object' || m === null) return {};
      const out = {};
      for (const [k, v] of Object.entries(m)) {
        if (typeof k === 'string' && k.trim()) out[k.trim()] = Boolean(v);
      }
      return out;
    } catch (_) {
      return {};
    }
  }
  try {
    const rawStr = await blobStore.get('hub_evaluator_may_approve');
    if (!rawStr) return {};
    const data = JSON.parse(rawStr);
    const m = data?.evaluator_may_approve != null ? data.evaluator_may_approve : data;
    if (typeof m !== 'object' || m === null) return {};
    const out = {};
    for (const [k, v] of Object.entries(m)) {
      if (typeof k === 'string' && k.trim()) out[k.trim()] = Boolean(v);
    }
    return out;
  } catch (_) {
    return {};
  }
}

async function saveEvaluatorMayApproveMap(blobStore, map) {
  const obj = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof k === 'string' && k.trim()) obj[k.trim()] = Boolean(v);
  }
  const str = JSON.stringify({ evaluator_may_approve: obj }, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(EVALUATOR_MAY_APPROVE_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_evaluator_may_approve', str);
}

/** Effective “may approve proposals” for Hub UI and gateway (admin always; evaluator from map + env). */
function mayApproveProposalsForUser(uid, storedRoles, mayMap) {
  const role = effectiveRole(uid, storedRoles);
  return actorMayApproveProposals(uid, role, mayMap, bridgeEnvEvaluatorMayApprove());
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

/** Remove vault id from all hub_vault_access lists and hub_scope maps (hosted team). */
async function stripHostedVaultFromAccessAndScope(blobStore, vaultId) {
  const id = String(vaultId || '').trim();
  if (!id || id === 'default') return;
  const access = await loadVaultAccess(blobStore);
  const nextAccess = {};
  for (const [uid, arr] of Object.entries(access)) {
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((x) => String(x).trim() !== id);
    if (filtered.length > 0) nextAccess[uid] = filtered;
  }
  await saveVaultAccess(blobStore, nextAccess);

  const scope = await loadScope(blobStore);
  const nextScope = {};
  for (const [uid, vmap] of Object.entries(scope)) {
    if (!vmap || typeof vmap !== 'object') continue;
    const inner = {};
    for (const [vid, rules] of Object.entries(vmap)) {
      if (String(vid).trim() === id) continue;
      inner[vid] = rules;
    }
    if (Object.keys(inner).length > 0) nextScope[uid] = inner;
  }
  await saveScope(blobStore, nextScope);
}

/** Drop bridge vector store for (effective user, vault). */
async function removeHostedVectorBlobForVault(blobStore, effectiveUid, vaultId) {
  const safeUid = sanitizeUserId(effectiveUid);
  const vid = sanitizeVaultId(vaultId);
  const localDir = path.join(DATA_DIR, 'vectors', safeUid, vid);
  if (!blobStore) {
    if (fs.existsSync(localDir)) fs.rmSync(localDir, { recursive: true, force: true });
    return;
  }
  const key = 'vectors/' + safeUid + '/' + vid;
  try {
    if (typeof blobStore.delete === 'function') await blobStore.delete(key);
  } catch (_) {
    /* Netlify Blobs may omit delete; ignore */
  }
}

/** @returns {Promise<string[]>} */
async function fetchCanisterVaultIdsForUser(canisterUserId) {
  if (!CANISTER_URL || !canisterUserId) return ['default'];
  try {
    const vRes = await fetch(CANISTER_URL + '/api/v1/vaults', {
      method: 'GET',
      headers: canisterHeaders({ 'X-User-Id': canisterUserId }),
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
  const canisterIds = await fetchCanisterVaultIdsForUser(effective);
  const allowedVaultIds = resolveAllowedVaultIdsForHostedContext({
    delegate,
    actorUid,
    accessMap: access,
    canisterIds,
  });
  if (!allowedVaultIds.includes(vaultId)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      error: 'Access to this vault is not allowed.',
    };
  }
  let scope = getScopeForUserVaultFromScopeMap(scopeMap, actorUid, vaultId);
  // Evaluators must see the full vault (per allowed_vault_ids) to review proposals in context;
  // project/folder scope still applies to viewer/editor/admin delegating members.
  const actorRole = effectiveRole(actorUid, roles);
  if (actorRole === 'evaluator') {
    scope = null;
  }
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
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vault-Id');
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

/** Import / index parity: viewers cannot write; default role is member (treated like editor for hosted). */
async function requireBridgeEditorOrAdmin(req, res, next) {
  const roles = await loadRoles(req.blobStore);
  const role = effectiveRole(req.uid, roles);
  if (role === 'viewer') {
    return res.status(403).json({ error: 'This action requires editor or admin.', code: 'FORBIDDEN' });
  }
  next();
}

app.get('/api/v1/roles', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  try {
    const roles = await loadRoles(req.blobStore);
    const evaluator_may_approve = await loadEvaluatorMayApproveMap(req.blobStore);
    res.json({ roles, evaluator_may_approve });
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
    return res.status(400).json({ error: 'role must be admin, editor, viewer, or evaluator', code: 'BAD_REQUEST' });
  }
  try {
    const roles = await loadRoles(req.blobStore);
    const uidKey = userId.trim();
    roles[uidKey] = r;
    await saveRoles(req.blobStore, roles);
    const mayMap = await loadEvaluatorMayApproveMap(req.blobStore);
    if (r === 'evaluator' && req.body && Object.prototype.hasOwnProperty.call(req.body, 'evaluator_may_approve')) {
      mayMap[uidKey] = Boolean(req.body.evaluator_may_approve);
      await saveEvaluatorMayApproveMap(req.blobStore, mayMap);
    } else if (r !== 'evaluator' && Object.prototype.hasOwnProperty.call(mayMap, uidKey)) {
      delete mayMap[uidKey];
      await saveEvaluatorMayApproveMap(req.blobStore, mayMap);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[bridge] POST /api/v1/roles', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/roles/evaluator-may-approve', requireBridgeAuth, requireBridgeAdmin, async (req, res) => {
  const { user_id: userId, evaluator_may_approve: flag } = req.body || {};
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'user_id required', code: 'BAD_REQUEST' });
  }
  if (typeof flag !== 'boolean') {
    return res.status(400).json({ error: 'evaluator_may_approve must be boolean', code: 'BAD_REQUEST' });
  }
  const uidKey = userId.trim();
  try {
    const roles = await loadRoles(req.blobStore);
    if (effectiveRole(uidKey, roles) !== 'evaluator') {
      return res.status(400).json({ error: 'User must have evaluator role', code: 'BAD_REQUEST' });
    }
    const mayMap = await loadEvaluatorMayApproveMap(req.blobStore);
    mayMap[uidKey] = flag;
    await saveEvaluatorMayApproveMap(req.blobStore, mayMap);
    res.json({ ok: true });
  } catch (e) {
    console.error('[bridge] POST /api/v1/roles/evaluator-may-approve', e?.message);
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
  if (!['viewer', 'editor', 'admin', 'evaluator'].includes(role)) {
    return res.status(400).json({ error: 'role must be viewer, editor, admin, or evaluator', code: 'BAD_REQUEST' });
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
    const mayMap = await loadEvaluatorMayApproveMap(req.blobStore);
    const role = effectiveRole(req.uid, roles);
    const may_approve_proposals = mayApproveProposalsForUser(req.uid, roles, mayMap);
    res.json({ role, may_approve_proposals });
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
    const mayMap = await loadEvaluatorMayApproveMap(req.blobStore);
    const may_approve_proposals = mayApproveProposalsForUser(actor, roles, mayMap);
    res.json({
      actor_sub: actor,
      workspace_owner_id: workspace.owner_user_id,
      effective_canister_user_id: ctx.effectiveCanisterUid,
      delegating: ctx.delegating,
      allowed_vault_ids: ctx.allowedVaultIds,
      scope: ctx.scope,
      role,
      may_approve_proposals,
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

// ——— Delete vault (canister + team access/scope + vector blob) ———
app.delete('/api/v1/vaults/:vaultId', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
  if (!CANISTER_URL) {
    return res.status(503).json({ error: 'CANISTER_URL not configured', code: 'NOT_AVAILABLE' });
  }
  const vaultId = sanitizeVaultId(req.params.vaultId);
  if (!req.params.vaultId || String(req.params.vaultId).trim() === '' || vaultId === 'default') {
    return res.status(400).json({ error: 'Cannot delete the default vault', code: 'BAD_REQUEST' });
  }

  const prevVaultHeader = req.headers['x-vault-id'];
  req.headers['x-vault-id'] = vaultId;
  const hctx = await resolveHostedBridgeContext(req, req.uid);
  req.headers['x-vault-id'] = prevVaultHeader;

  if (!hctx.ok) {
    return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
  }

  const workspace = await loadWorkspace(req.blobStore);
  const owner = workspace.owner_user_id && String(workspace.owner_user_id).trim();
  if (owner && req.uid !== owner) {
    return res.status(403).json({
      error: 'Only the workspace owner can delete vaults.',
      code: 'FORBIDDEN',
    });
  }

  let canRes;
  try {
    canRes = await fetch(`${CANISTER_URL}/api/v1/vaults/${encodeURIComponent(vaultId)}`, {
      method: 'DELETE',
      headers: canisterHeaders({ 'X-User-Id': hctx.effectiveCanisterUid }),
    });
  } catch (e) {
    console.error('[bridge] DELETE vault canister fetch', e?.message);
    return res.status(502).json({ error: 'Could not reach canister', code: 'BAD_GATEWAY' });
  }

  const text = await canRes.text();
  if (!canRes.ok) {
    let errMsg = text;
    try {
      const j = JSON.parse(text);
      if (j && j.error) errMsg = j.error;
    } catch (_) {}
    return res.status(canRes.status >= 400 ? canRes.status : 502).json({
      error: errMsg || 'Canister error',
      code: 'UPSTREAM_ERROR',
    });
  }

  await stripHostedVaultFromAccessAndScope(req.blobStore, vaultId);
  await removeHostedVectorBlobForVault(req.blobStore, hctx.effectiveCanisterUid, vaultId);

  try {
    const data = text ? JSON.parse(text) : {};
    res.json({ ok: true, ...data });
  } catch (_) {
    res.json({ ok: true, deleted_vault_id: vaultId });
  }
});

/**
 * Full proposal documents for GitHub backup (list + GET each id). Same scope as notes.
 * @param {string} canisterUrl
 * @param {string} canisterUid
 * @param {string} vaultId
 * @param {{ projects?: string[], folders?: string[] } | null | undefined} scope
 */
async function fetchFullProposalsForGithubBackup(canisterUrl, canisterUid, vaultId, scope) {
  const base = String(canisterUrl || '').replace(/\/$/, '');
  const headers = canisterHeaders({ 'X-User-Id': canisterUid, 'X-Vault-Id': vaultId });
  const listRes = await fetch(`${base}/api/v1/proposals`, { method: 'GET', headers });
  if (!listRes.ok) {
    const err = new Error(`Canister proposals list ${listRes.status}`);
    err.status = 502;
    throw err;
  }
  let listJson;
  try {
    listJson = await listRes.json();
  } catch {
    const err = new Error('Invalid canister proposals list JSON');
    err.status = 502;
    throw err;
  }
  const stubs = Array.isArray(listJson.proposals) ? listJson.proposals : [];
  const full = [];
  for (const stub of stubs) {
    const id = stub && stub.proposal_id ? String(stub.proposal_id) : '';
    if (!id) continue;
    const oneRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers,
    });
    if (!oneRes.ok) {
      const err = new Error(`Canister proposal ${id} ${oneRes.status}`);
      err.status = 502;
      throw err;
    }
    const text = await oneRes.text();
    const body = parseCanisterProposalGetBody(id, text, stub);
    if (body._knowtation_backup_json_unparseable) {
      console.error('[bridge] vault/sync proposal JSON parse failed', { id, preview: text.slice(0, 300) });
    }
    full.push(body);
  }
  return applyScopeFilterToProposals(full, scope);
}

// ——— Back up now: fetch vault from canister, push to GitHub ———
app.post('/api/v1/vault/sync', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
  const uid = req.uid;

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

  const vaultId = sanitizeVaultId(req.headers['x-vault-id']);

  // Fetch vault from canister (export)
  let exportRes;
  try {
    exportRes = await fetch(CANISTER_URL + '/api/v1/export', {
      method: 'GET',
      headers: canisterHeaders({ 'X-User-Id': canisterUid, 'X-Vault-Id': vaultId }),
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

  let proposals = [];
  try {
    proposals = await fetchFullProposalsForGithubBackup(CANISTER_URL, canisterUid, vaultId, hctx.scope);
  } catch (e) {
    console.error('[bridge] vault/sync proposals fetch', e?.message);
    return res.status(e.status || 502).json({
      error: e.message || 'Could not fetch proposals for backup',
      code: 'BAD_GATEWAY',
    });
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

  const snapshotObj = {
    format_version: 1,
    kind: 'knowtation-hosted-backup',
    exported_at: new Date().toISOString(),
    vault_id: vaultId,
    proposals,
  };
  const snapshotJson = JSON.stringify(snapshotObj);
  const snapBlobRes = await fetch(`${ghApi}/repos/${owner}/${name}/git/blobs`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({
      content: Buffer.from(snapshotJson, 'utf8').toString('base64'),
      encoding: 'base64',
    }),
  });
  if (!snapBlobRes.ok) {
    return res.status(502).json({ error: 'GitHub blob failed (snapshot)', code: 'BAD_GATEWAY' });
  }
  const snapBlob = await snapBlobRes.json();
  tree.push({
    path: '.knowtation/backup/v1/snapshot.json',
    mode: '100644',
    type: 'blob',
    sha: snapBlob.sha,
  });

  const isInitialCommit = !baseSha;
  if (isInitialCommit && notes.length === 0 && proposals.length === 0) {
    const placeholder =
      '# Knowtation vault backup\n\n'
      + 'This folder is written by **Back up now** on hosted Knowtation.\n\n'
      + '- **Markdown files** elsewhere in this repo are your vault **notes**.\n'
      + '- **`.knowtation/backup/v1/snapshot.json`** holds full **proposal** records (status, review, enrich metadata, bodies).\n\n'
      + 'Your vault had no notes or proposals yet. Add content in the Hub and run **Back up now** again.\n';
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

  res.json({
    ok: true,
    message: 'Synced',
    notesCount: notes.length,
    proposalsCount: proposals.length,
  });
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

// Internal: GET GitHub connection (token + repo) for the gateway to use for image upload.
// Server-to-server only — never exposed to the browser. Auth required.
app.get('/api/v1/vault/github-token', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  try {
    const tokensByUser = await loadTokens(req.blobStore);
    const conn = tokensByUser[uid];
    if (!conn?.token) {
      return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
    }
    res.json({ token: conn.token, repo: conn.repo || null });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  }
});

/** Max notes per canister POST /api/v1/notes/batch (must match hub/icp NOTES_BATCH cap). */
const CANISTER_NOTES_BATCH_MAX = 100;

/**
 * @param {string} canisterUid
 * @param {string} actorUid
 * @param {string} vaultId
 * @param {{ path: string, body: string, frontmatter?: Record<string, unknown> }[]} notes
 */
async function postNotesBatchToCanister(canisterUid, actorUid, vaultId, notes) {
  if (!notes.length) return;
  for (let offset = 0; offset < notes.length; offset += CANISTER_NOTES_BATCH_MAX) {
    const chunk = notes.slice(offset, offset + CANISTER_NOTES_BATCH_MAX);
    const r = await fetch(CANISTER_URL + '/api/v1/notes/batch', {
      method: 'POST',
      headers: canisterHeaders({
        'Content-Type': 'application/json',
        'X-User-Id': canisterUid,
        'X-Actor-Id': actorUid,
        'X-Vault-Id': vaultId,
      }),
      body: JSON.stringify({ notes: chunk }),
    });
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`Canister batch note write failed (${r.status}): ${text.slice(0, 800)}`);
    }
  }
}

/**
 * Sanitize a user-supplied filename before writing it to disk.
 * - Strips all directory components (path traversal prevention).
 * - Removes every character that is not alphanumeric, a dot, hyphen, or underscore.
 * - Truncates to 200 chars so filesystem limits are never approached.
 * - Falls back to 'upload' when the result would be empty.
 */
function sanitizeUploadFilename(rawName) {
  const base = path.basename(rawName || '');
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return safe || 'upload';
}

const importTempDirMiddleware = (req, _res, next) => {
  req._importTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-bridge-import-'));
  next();
};
const bridgeImportUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req._importTempDir),
    filename: (_req, file, cb) => cb(null, sanitizeUploadFilename(file.originalname)),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
}).single('file');

// ——— Phase 18: GitHub image upload + image proxy ———

const bridgeImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('image');

app.post(
  /^\/api\/v1\/notes\/(.+)\/upload-image$/,
  requireBridgeAuth,
  requireBridgeEditorOrAdmin,
  bridgeImageUpload,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'image file required', code: 'BAD_REQUEST' });

      const originalName = req.file.originalname || 'image.jpg';
      try { validateImageExtension(originalName); } catch (e) {
        return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
      }
      if (!(req.file.mimetype || '').toLowerCase().startsWith('image/')) {
        return res.status(400).json({ error: 'File content-type must be image/*', code: 'BAD_REQUEST' });
      }
      const ext = originalName.split('.').pop().toLowerCase();
      try { validateMagicBytes(req.file.buffer, ext); } catch (e) {
        return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
      }

      const tokensByUser = await loadTokens(req.blobStore);
      const conn = tokensByUser[req.uid];
      if (!conn?.token) {
        return res.status(400).json({ error: 'GitHub not connected. Go to Settings → Backup → Connect GitHub.', code: 'GITHUB_NOT_CONNECTED' });
      }
      if (!conn.repo) {
        return res.status(400).json({ error: 'GitHub repo not set. Back up once first to set the remote.', code: 'GITHUB_NOT_CONFIGURED' });
      }

      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
      const uniqueName = `${Date.now()}-${safeName}`;
      const repoFilePath = `media/images/${yearMonth}/${uniqueName}`;

      const result = await commitImageToRepo({
        accessToken: conn.token,
        repoUrl: conn.repo,
        filePath: repoFilePath,
        fileBuffer: req.file.buffer,
        commitMessage: `Add image: ${safeName}`,
      });

      res.json({
        url: result.url,
        inserted_markdown: `![${safeName}](${result.url})`,
        sha: result.sha,
        repo_path: repoFilePath,
        repo_private: result.isPrivate === true,
      });
    } catch (e) {
      console.error('[bridge] upload-image error:', e?.message);
      const msg = e.message || String(e);
      const clientErr = /not found|not connected|lacks permission|lacks repo|Reconnect|scope|remote/i.test(msg);
      res.status(clientErr ? 400 : 500).json({ error: msg, code: clientErr ? 'BAD_REQUEST' : 'RUNTIME_ERROR' });
    }
  }
);

// Image proxy: serve raw.githubusercontent.com images via the stored GitHub token.
// Accepts JWT via ?token= query param (browsers cannot send headers for <img> tags).
const BRIDGE_IMAGE_PROXY_SIZE_LIMIT = 10 * 1024 * 1024;
app.get('/api/v1/vault/image-proxy', async (req, res) => {
  const auth = req.headers.authorization;
  const headerToken = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const uid = (headerToken || queryToken) ? userIdFromJwt(headerToken || queryToken) : null;
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/.+$/i.test(rawUrl)) {
    return res.status(400).json({ error: 'url must be a raw.githubusercontent.com path', code: 'BAD_REQUEST' });
  }

  let accessToken = '';
  try {
    const tokensByUser = await loadTokens(req.blobStore);
    const conn = tokensByUser[uid];
    if (conn?.token) accessToken = conn.token;
  } catch (_) {}

  const fetchHeaders = { 'User-Agent': 'Knowtation-Hub/1.0' };
  if (accessToken) fetchHeaders.Authorization = `token ${accessToken}`;

  let upstream;
  try {
    upstream = await fetch(rawUrl, { headers: fetchHeaders });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to fetch image from GitHub', code: 'UPSTREAM_ERROR' });
  }
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: 'Image not found on GitHub', code: 'UPSTREAM_ERROR' });
  }
  const ct = upstream.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) {
    return res.status(400).json({ error: 'URL does not point to an image', code: 'BAD_REQUEST' });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.byteLength > BRIDGE_IMAGE_PROXY_SIZE_LIMIT) {
    return res.status(400).json({ error: 'Image too large (max 10 MB)', code: 'BAD_REQUEST' });
  }
  res.setHeader('Content-Type', ct);
  res.setHeader('Content-Length', buf.byteLength);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});

app.post(
  '/api/v1/import',
  requireBridgeAuth,
  requireBridgeEditorOrAdmin,
  importTempDirMiddleware,
  bridgeImportUpload,
  async (req, res) => {
    const tempDir = req._importTempDir;
    try {
      if (!CANISTER_URL) {
        return res.status(503).json({ error: 'Canister not configured', code: 'SERVICE_UNAVAILABLE' });
      }
      if (!req.file) return res.status(400).json({ error: 'file required', code: 'BAD_REQUEST' });
      const sourceType = req.body && req.body.source_type ? String(req.body.source_type).trim() : '';
      if (!IMPORT_SOURCE_TYPES.includes(sourceType)) {
        return res.status(400).json({
          error: `source_type must be one of: ${IMPORT_SOURCE_TYPES.join(', ')}`,
          code: 'BAD_REQUEST',
        });
      }
      const project = req.body && req.body.project ? String(req.body.project).trim() : undefined;
      const outputDir = req.body && req.body.output_dir ? String(req.body.output_dir).trim() : undefined;
      const tagsRaw = req.body && req.body.tags ? String(req.body.tags) : '';
      const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      let inputPath = req.file.path;
      if (req.file.originalname && req.file.originalname.toLowerCase().endsWith('.zip')) {
        const extractDir = path.join(tempDir, 'extracted');
        fs.mkdirSync(extractDir, { recursive: true });
        const zip = new AdmZip(req.file.path);
        // Zip-slip protection: every entry must resolve inside extractDir
        const extractDirResolved = path.resolve(extractDir) + path.sep;
        for (const entry of zip.getEntries()) {
          const entryResolved = path.resolve(extractDir, entry.entryName);
          if (entryResolved !== path.resolve(extractDir) && !entryResolved.startsWith(extractDirResolved)) {
            return res.status(400).json({ error: 'Invalid zip entry: path traversal detected', code: 'BAD_REQUEST' });
          }
        }
        zip.extractAllTo(extractDir, true);
        inputPath = extractDir;
      }
      const hctx = await resolveHostedBridgeContext(req, req.uid);
      if (!hctx.ok) {
        return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
      }
      const vaultPath = path.join(tempDir, 'vault-work');
      fs.mkdirSync(vaultPath, { recursive: true });
      const result = await runImport(sourceType, inputPath, { project, outputDir, tags, vaultPath });
      const importStamp = mergeProvenanceFrontmatter({}, {
        sub: hctx.actorUid,
        kind: 'import',
      });
      /** @type {{ path: string, body: string, frontmatter: Record<string, unknown> }[]} */
      const notesForCanister = [];
      for (const item of result.imported || []) {
        if (item.path && typeof item.path === 'string') {
          try {
            writeNote(vaultPath, item.path, { frontmatter: importStamp });
            const safe = resolveVaultRelativePath(vaultPath, item.path);
            const fullPath = path.join(vaultPath, safe);
            const markdownFull = fs.readFileSync(fullPath, 'utf8');
            const parsed = parseFrontmatterAndBody(markdownFull);
            const fm =
              parsed.frontmatter && typeof parsed.frontmatter === 'object' && !Array.isArray(parsed.frontmatter)
                ? /** @type {Record<string, unknown>} */ ({ ...parsed.frontmatter })
                : {};
            notesForCanister.push({
              path: safe.replace(/\\/g, '/'),
              body: parsed.body || '',
              frontmatter: fm,
            });
          } catch (e) {
            console.error('[bridge] import prepare note for canister failed for', item.path, e?.message || e);
            return res.status(502).json({
              error: e.message || 'Canister write failed',
              code: 'BAD_GATEWAY',
            });
          }
        }
      }
      try {
        await postNotesBatchToCanister(
          hctx.effectiveCanisterUid,
          hctx.actorUid,
          hctx.vaultId,
          notesForCanister,
        );
      } catch (e) {
        console.error('[bridge] import canister batch write failed', e?.message || e);
        return res.status(502).json({
          error: e.message || 'Canister write failed',
          code: 'BAD_GATEWAY',
        });
      }
      return res.json({ imported: result.imported, count: result.count });
    } catch (e) {
      const msg = e.message || String(e);
      const clientError =
        /OPENAI_API_KEY|required for transcription|Unsupported format|file not found|not found:|Transcription failed|413|Payload Too Large|25MB|Whisper accepts/i.test(
          msg,
        );
      res.status(clientError ? 400 : 500).json({
        error: msg,
        code: clientError ? 'BAD_REQUEST' : 'RUNTIME_ERROR',
      });
    } finally {
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
      }
    }
  },
);

// ——— Index + Search (hosted: indexer runs in bridge, canister does not run Node) ———
const BATCH_EMBED = 10;
const BATCH_UPSERT = 50;

app.post('/api/v1/index', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
  const uid = req.uid;
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
      headers: canisterHeaders({ 'X-User-Id': canisterUid, 'X-Vault-Id': vaultId }),
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
    const { embedWithUsage, embeddingDimension } = await import('../../lib/embedding.mjs');
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
      // Drop prior vectors for this vault so search cannot return paths no longer in the export.
      if (typeof store.deleteByVaultId === 'function') {
        await store.deleteByVaultId(vaultId);
      }
      await persistVectorsToBlob(req, canisterUid, vectorsDir);
      return res.json({
        ok: true,
        notesProcessed: notes.length,
        chunksIndexed: 0,
        embedding_input_tokens: 0,
      });
    }
    const embeddingConfig = storeConfig.embedding;
    const vectors = [];
    let embedding_input_tokens = 0;
    for (let i = 0; i < allChunks.length; i += BATCH_EMBED) {
      const batch = allChunks.slice(i, i + BATCH_EMBED);
      const texts = batch.map((c) => c.text);
      const { vectors: batchVectors, embedding_input_tokens: batchTok } = await embedWithUsage(
        texts,
        embeddingConfig,
        { voyageInputType: 'document' },
      );
      embedding_input_tokens += batchTok;
      for (let j = 0; j < batch.length; j++) {
        vectors.push(batchVectors[j] || []);
      }
    }
    const dim = embeddingDimension(embeddingConfig);
    const store = await createVectorStore(storeConfig);
    await store.ensureCollection(dim);
    // Remove stale chunk rows for this vault before upsert; otherwise deleted notes stay in KNN.
    if (typeof store.deleteByVaultId === 'function') {
      await store.deleteByVaultId(vaultId);
    }
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
    const indexResult = { ok: true, notesProcessed: notes.length, chunksIndexed: allChunks.length, embedding_input_tokens };
    res.json(indexResult);
    fireBridgeCaptureEvent('index', { note_count: notes.length, chunk_count: allChunks.length }, sanitizeUserId(uid), vaultId);
    return;
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
  // Auto-capture after successful response — fire-and-forget, does not affect latency.
  const _captureVaultId = sanitizeVaultId(req.headers['x-vault-id']);
  const _captureMode = req.body?.mode === 'keyword' ? 'keyword' : 'semantic';
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300 && query) {
      fireBridgeCaptureEvent('search', { query, mode: _captureMode }, sanitizeUserId(uid), _captureVaultId);
    }
  });
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required', code: 'BAD_REQUEST' });
  }
  const limit = Math.max(1, Math.min(parseInt(req.body?.limit, 10) || 20, 100));
  const snippetChars = parseInt(req.body?.snippetChars, 10) || 300;
  try {
    const mode = req.body?.mode === 'keyword' ? 'keyword' : 'semantic';
    const bridgeVaultId = sanitizeVaultId(req.headers['x-vault-id']);

    if (mode === 'keyword') {
      let exportRes;
      try {
        exportRes = await fetch(CANISTER_URL + '/api/v1/export', {
          method: 'GET',
          headers: canisterHeaders({ 'X-User-Id': canisterUid, 'X-Vault-Id': bridgeVaultId }),
        });
      } catch (_e) {
        return res.status(502).json({ error: 'Could not reach canister', code: 'BAD_GATEWAY' });
      }
      if (!exportRes.ok) {
        return res.status(502).json({ error: 'Canister export failed', code: 'BAD_GATEWAY', status: exportRes.status });
      }
      let vault;
      try {
        vault = await exportRes.json();
      } catch (_e) {
        return res.status(502).json({ error: 'Invalid canister response', code: 'BAD_GATEWAY' });
      }
      let rawNotes = vault.notes || [];
      if (hctx.scope) {
        rawNotes = applyScopeFilterToNotes(rawNotes, hctx.scope);
      }
      const { noteRecordFromExportPayload, keywordSearchNotesArray } = await import('../../lib/keyword-search.mjs');
      const { filterNotesByListOptions } = await import('../../lib/list-notes.mjs');
      let shaped = rawNotes.map((n) => noteRecordFromExportPayload(n));
      shaped = filterNotesByListOptions(shaped, {
        folder: req.body?.folder,
        project: req.body?.project,
        tag: req.body?.tag,
        since: req.body?.since,
        until: req.body?.until,
        chain: req.body?.chain,
        entity: req.body?.entity,
        episode: req.body?.episode,
        content_scope: req.body?.content_scope,
      });
      const fields =
        req.body?.fields === 'path' || req.body?.fields === 'full' ? req.body.fields : 'path+snippet';
      const out = keywordSearchNotesArray(shaped, query, {
        limit,
        order: req.body?.order,
        fields,
        snippetChars,
        match: req.body?.match === 'all_terms' ? 'all_terms' : 'phrase',
        countOnly: req.body?.count_only === true || req.body?.countOnly === true,
      });
      if (out.results && hctx.scope) {
        return res.json({ ...out, results: applyScopeFilterToNotes(out.results, hctx.scope) });
      }
      return res.json(out);
    }

    const { embed } = await import('../../lib/embedding.mjs');
    const { createVectorStore } = await import('../../lib/vector-store.mjs');
    const { filterHitsByContentScope, resolveSearchFolderForContentScope } = await import('../../lib/approval-log.mjs');
    const { MAX_VECTOR_KNN } = await import('../../lib/vector-knn-limit.mjs');

    const vectorsDir = await getVectorsDirForUser(req, canisterUid);
    const storeConfig = getBridgeStoreConfig(canisterUid, vectorsDir);
    const store = await createVectorStore(storeConfig);
    const [queryVector] = await embed([query], storeConfig.embedding, { voyageInputType: 'query' });
    if (!queryVector) {
      return res.status(500).json({ error: 'Embedding failed', code: 'INTERNAL_ERROR' });
    }
    const cs = req.body?.content_scope || 'all';
    const userFolder = req.body?.folder;
    const resolved = resolveSearchFolderForContentScope(cs, userFolder);
    if (resolved.impossible) {
      return res.json({ results: [], query, mode: 'semantic' });
    }
    let searchLimit = limit;
    if (resolved.wideNotesFetch) {
      searchLimit = Math.min(10000, Math.max(limit * 120, 2500));
    } else if (cs !== 'all') {
      searchLimit = Math.min(10000, Math.max(limit * 40, 800));
    }
    searchLimit = Math.min(searchLimit, MAX_VECTOR_KNN);
    const hits = await store.search(queryVector, {
      limit: searchLimit,
      vault_id: bridgeVaultId,
      project: req.body?.project,
      tag: req.body?.tag,
      folder: resolved.folder,
      since: req.body?.since,
      until: req.body?.until,
      order: req.body?.order,
      chain: req.body?.chain,
      entity: req.body?.entity,
      episode: req.body?.episode,
    });
    let scopedHits = filterHitsByContentScope(hits || [], cs);
    scopedHits = scopedHits.slice(0, limit);
    let results = scopedHits.map((h) => ({
      path: h.path,
      score: h.score,
      ...(typeof h.vec_distance === 'number' && Number.isFinite(h.vec_distance)
        ? { vec_distance: h.vec_distance }
        : {}),
      project: h.project ?? null,
      tags: h.tags ?? [],
      snippet: truncateSnippet(h.text, snippetChars),
    }));
    if (hctx.scope) {
      results = applyScopeFilterToNotes(results, hctx.scope);
    }
    return res.json({ results, query, mode: 'semantic' });
  } catch (e) {
    console.error('Bridge search error:', e);
    return res.status(500).json({
      error: 'Search failed',
      code: 'INTERNAL_ERROR',
      message: bridgeEmbedFailureMessage(e, 'search'),
    });
  }
});

app.use((err, req, res, _next) => {
  if (res.headersSent) return;
  console.error('[bridge] unhandled error:', err?.stack || err?.message || err);
  let status = 500;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') status = 413;
    else status = 400;
  } else if (typeof err.status === 'number' && err.status >= 400 && err.status < 600) {
    status = err.status;
  } else if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) {
    status = err.statusCode;
  }
  res.status(status).json({
    error: err.message || 'Internal error',
    code: err.code || 'INTERNAL_ERROR',
  });
});

// ——— Memory endpoints (Phase 8) ———

/**
 * Fire-and-forget memory event capture for hosted bridge endpoints.
 * Uses Netlify Blobs when available (hosted), falls back to file-based for self-hosted.
 * Never throws, never delays the response.
 */
function fireBridgeCaptureEvent(type, data, uid, vaultId) {
  (async () => {
    try {
      if (globalThis.__netlify_blob_store) {
        // Hosted: append to Netlify Blobs for durability across Lambda invocations.
        const { createMemoryEvent, MEMORY_EVENT_TYPES } = await import('../../lib/memory-event.mjs');
        if (!MEMORY_EVENT_TYPES.includes(type)) return;
        const event = createMemoryEvent(type, data, { vaultId: vaultId || 'default' });
        await blobsAppendMemoryEvent(uid, vaultId, event);
      } else {
        // Self-hosted: file-based.
        const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
        const { MemoryManager } = await import('../../lib/memory.mjs');
        const mm = new MemoryManager(new FileMemoryProvider(bridgeMemoryDir(uid, vaultId || 'default')));
        if (mm.shouldCapture(type)) mm.store(type, data);
      }
    } catch (_) {}
  })();
}

function bridgeMemoryAuth(req) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  const vaultId = sanitizeVaultId(req.headers['x-vault-id'] || req.query.vault_id);
  const scope = req.query.scope === 'global' ? 'global' : 'vault';
  return { uid: uid ? sanitizeUserId(uid) : null, vaultId, scope };
}

function bridgeMemoryDir(uid, vaultId, scope) {
  if (scope === 'global') {
    return path.join(DATA_DIR, 'memory', uid, '_global');
  }
  return path.join(DATA_DIR, 'memory', uid, vaultId);
}

app.get('/api/v1/memory/:key', async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  try {
    const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
    const { MemoryManager } = await import('../../lib/memory.mjs');
    const provider = new FileMemoryProvider(bridgeMemoryDir(uid, vaultId));
    const mm = new MemoryManager(provider);
    const event = mm.getLatest(req.params.key);
    if (!event) return res.json({ key: req.params.key, value: null, updated_at: null });
    res.json({ key: req.params.key, value: event.data, updated_at: event.ts, id: event.id });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/memory/store', requireBridgeAuth, requireBridgeEditorOrAdmin, express.json(), async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);
  try {
    const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
    const { MemoryManager } = await import('../../lib/memory.mjs');
    const provider = new FileMemoryProvider(bridgeMemoryDir(uid, vaultId));
    const mm = new MemoryManager(provider);
    const { key, value, ttl } = req.body || {};
    if (!key || !value) return res.status(400).json({ error: 'key and value required', code: 'BAD_REQUEST' });
    const data = typeof value === 'object' ? { key, ...value } : { key, text: String(value) };
    const result = mm.store('user', data, { vaultId, ttl });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.get('/api/v1/memory', async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  try {
    let events;
    if (globalThis.__netlify_blob_store) {
      // Hosted: read from Blobs.
      events = await blobsGetMemoryEvents(uid, vaultId);
      if (req.query.type) events = events.filter((e) => e.type === req.query.type);
      if (req.query.since) events = events.filter((e) => e.ts >= req.query.since);
      if (req.query.until) events = events.filter((e) => e.ts <= req.query.until);
      events.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
      events = events.slice(0, Math.min(parseInt(req.query.limit) || 20, 100));
    } else {
      const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
      const { MemoryManager } = await import('../../lib/memory.mjs');
      const mm = new MemoryManager(new FileMemoryProvider(bridgeMemoryDir(uid, vaultId)));
      events = mm.list({
        type: req.query.type || undefined,
        since: req.query.since || undefined,
        until: req.query.until || undefined,
        limit: Math.min(parseInt(req.query.limit) || 20, 100),
      });
    }
    res.json({ events, count: events.length });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/memory/search', express.json(), async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  res.json({ results: [], count: 0, note: 'Hosted memory search requires vector provider (future).' });
});

app.delete('/api/v1/memory/clear', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);
  try {
    const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
    const { MemoryManager } = await import('../../lib/memory.mjs');
    const provider = new FileMemoryProvider(bridgeMemoryDir(uid, vaultId));
    const mm = new MemoryManager(provider);
    const result = mm.clear({
      type: req.query.type || undefined,
      before: req.query.before || undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.get('/api/v1/memory-stats', async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  try {
    const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
    const { MemoryManager } = await import('../../lib/memory.mjs');
    const provider = new FileMemoryProvider(bridgeMemoryDir(uid, vaultId));
    const mm = new MemoryManager(provider);
    res.json(mm.stats());
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// ——— Hosted Consolidation (Phase 10 / Stream 1) ———

// ——— Blobs-backed memory helpers (hosted path) ———

/** Netlify Blobs key for a user's raw memory events. */
function memoryBlobKey(uid, vaultId) {
  return `memory/${uid}/${vaultId || 'default'}/events`;
}

/** Load memory events from Netlify Blobs (hosted) or return [] if unavailable. */
async function blobsGetMemoryEvents(uid, vaultId) {
  const store = globalThis.__netlify_blob_store;
  if (!store) return [];
  try {
    const raw = await store.get(memoryBlobKey(uid, vaultId), { type: 'text' });
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch (_) { return []; }
}

/** Persist memory events to Netlify Blobs, capped at 500 events. */
async function blobsSetMemoryEvents(uid, vaultId, events) {
  const store = globalThis.__netlify_blob_store;
  if (!store) return;
  try {
    await store.set(memoryBlobKey(uid, vaultId), JSON.stringify(events.slice(-500)));
  } catch (_) {}
}

/** Append a single event to Blobs memory store (read-modify-write). */
async function blobsAppendMemoryEvent(uid, vaultId, event) {
  const events = await blobsGetMemoryEvents(uid, vaultId);
  events.push(event);
  await blobsSetMemoryEvents(uid, vaultId, events);
}

// ——— Consolidation cost tracking ———

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function utcMonthString() {
  return new Date().toISOString().slice(0, 7);
}

/** Blobs key for per-user consolidation cost record. */
function consolidationCostBlobKey(uid) {
  return `memory/${uid}/consolidation-cost`;
}

/** Load consolidation cost record — Blobs on hosted, file on self-hosted. */
async function loadConsolidationCost(uid) {
  const store = globalThis.__netlify_blob_store;
  if (store) {
    try {
      const raw = await store.get(consolidationCostBlobKey(uid), { type: 'text' });
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (_) { return {}; }
  }
  const filePath = path.join(DATA_DIR, 'consolidation', uid + '_cost.json');
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) { return {}; }
}

/** Persist consolidation cost record — Blobs on hosted, file on self-hosted. */
async function saveConsolidationCost(uid, data) {
  const store = globalThis.__netlify_blob_store;
  if (store) {
    try {
      await store.set(consolidationCostBlobKey(uid), JSON.stringify(data));
    } catch (_) {}
    return;
  }
  const filePath = path.join(DATA_DIR, 'consolidation', uid + '_cost.json');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function recordConsolidationPass(uid, costUsd) {
  const rec = await loadConsolidationCost(uid);
  const today = utcDateString();
  const month = utcMonthString();
  const prevCostDate = rec.cost_date;
  const prevMonth = rec.pass_month;
  return {
    last_pass: new Date().toISOString(),
    cost_today_usd: prevCostDate === today ? Number((rec.cost_today_usd || 0) + costUsd) : costUsd,
    cost_date: today,
    cost_cap_usd: process.env.CONSOLIDATION_COST_CAP_USD ? parseFloat(process.env.CONSOLIDATION_COST_CAP_USD) : null,
    pass_count_month: prevMonth === month ? (rec.pass_count_month || 0) + 1 : 1,
    pass_month: month,
  };
}

/**
 * POST /api/v1/memory/consolidate
 * Body: { dry_run?, passes?, lookback_hours?, max_events_per_pass?, max_topics_per_pass?, llm?: { max_tokens? } }
 * Response: { topics, total_events, verify, discover, cost_usd, pass_id }
 */
app.post('/api/v1/memory/consolidate', requireBridgeAuth, requireBridgeEditorOrAdmin, express.json(), async (req, res) => {
  const { uid, vaultId } = bridgeMemoryAuth(req);

  const llmApiKey = process.env.CONSOLIDATION_LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!llmApiKey) {
    return res.status(503).json({
      error: 'No LLM API key configured for hosted consolidation (CONSOLIDATION_LLM_API_KEY or OPENAI_API_KEY).',
      code: 'LLM_NOT_CONFIGURED',
    });
  }

  const mergedBody =
    req.body && typeof req.body === 'object' ? { ...req.body } : {};

  const { dry_run, passes } = mergedBody;

  // 30-minute server-side cooldown on real (non-dry-run) passes to prevent runaway costs.
  // Automated scheduler runs respect their own configured interval; this guards manual triggers.
  if (!dry_run) {
    try {
      const costRec = await loadConsolidationCost(uid);
      const lastPassAt = costRec?.last_pass;
      if (lastPassAt) {
        const elapsedMs = Date.now() - new Date(lastPassAt).getTime();
        const cooldownMs = 30 * 60 * 1000;
        if (elapsedMs < cooldownMs) {
          const waitMin = Math.ceil((cooldownMs - elapsedMs) / 60_000);
          return res.status(429).json({
            error: `Consolidation available again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.`,
            code: 'RATE_LIMITED',
            retry_after_minutes: waitMin,
          });
        }
      }
    } catch (_) {
      // If cost record can't be read, allow the pass through — don't block on a read error.
    }
  }

  try {
    const { FileMemoryProvider } = await import('../../lib/memory-provider-file.mjs');
    const { MemoryManager } = await import('../../lib/memory.mjs');
    const { consolidateMemory } = await import('../../lib/memory-consolidate.mjs');
    const { computeCallCost } = await import('../../lib/daemon-cost.mjs');
    const { createMemoryEvent } = await import('../../lib/memory-event.mjs');

    // Hosted (Blobs): load events into a temp FileMemoryProvider so consolidateMemory
    // can read and write to it, then sync remaining events back to Blobs.
    // Self-hosted: use the normal file-based memory directory.
    let mm;
    let tempDir = null;
    const isHostedBlobs = Boolean(globalThis.__netlify_blob_store);

    if (isHostedBlobs) {
      const rawEvents = await blobsGetMemoryEvents(uid, vaultId);
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-mm-'));
      if (rawEvents.length > 0) {
        fs.writeFileSync(
          path.join(tempDir, 'events.jsonl'),
          rawEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
          'utf8',
        );
      }
      mm = new MemoryManager(new FileMemoryProvider(tempDir));
    } else {
      mm = new MemoryManager(new FileMemoryProvider(bridgeMemoryDir(uid, vaultId)));
    }

    const maxTok =
      mergedBody.llm && typeof mergedBody.llm === 'object' && mergedBody.llm.max_tokens != null
        ? Math.floor(Number(mergedBody.llm.max_tokens))
        : 1024;
    const lbH =
      mergedBody.lookback_hours != null && Number.isFinite(Number(mergedBody.lookback_hours))
        ? Number(mergedBody.lookback_hours)
        : 24;
    const maxEv =
      mergedBody.max_events_per_pass != null && Number.isFinite(Number(mergedBody.max_events_per_pass))
        ? Number(mergedBody.max_events_per_pass)
        : 200;
    const maxTop =
      mergedBody.max_topics_per_pass != null && Number.isFinite(Number(mergedBody.max_topics_per_pass))
        ? Number(mergedBody.max_topics_per_pass)
        : 10;

    const consolidationConfig = {
      data_dir: isHostedBlobs ? os.tmpdir() : DATA_DIR,
      llm: {
        provider: 'openai',
        api_key: llmApiKey,
        model: process.env.CONSOLIDATION_LLM_MODEL || 'gpt-4o-mini',
      },
      daemon: {
        lookback_hours: lbH,
        max_events_per_pass: maxEv,
        max_topics_per_pass: maxTop,
        llm: { max_tokens: Number.isFinite(maxTok) ? maxTok : 1024 },
      },
      memory: {
        provider: 'file',
        encrypt: process.env.CONSOLIDATION_MEMORY_ENCRYPT === 'true',
      },
    };

    // Track LLM call cost via a wrapping llmFn.
    let totalCostUsd = 0;
    const { completeChat } = await import('../../lib/llm-complete.mjs');
    const trackingLlmFn = async (cfg, callOpts) => {
      const rawResponse = await completeChat(consolidationConfig, callOpts);
      totalCostUsd += computeCallCost(callOpts, rawResponse);
      return rawResponse;
    };

    const result = await consolidateMemory(consolidationConfig, {
      mm,
      dryRun: Boolean(dry_run),
      passes: passes ?? undefined,
      llmFn: dry_run ? undefined : trackingLlmFn,
    });

    const pass_id = 'cpass_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

    if (!dry_run) {
      const updated = await recordConsolidationPass(uid, totalCostUsd);
      await saveConsolidationCost(uid, updated);

      // Store pass-level summary event.
      const passEvent = createMemoryEvent('consolidation_pass', {
        topics_count: Array.isArray(result.topics) ? result.topics.length : (result.topics ?? 0),
        total_events: result.total_events,
        cost_usd: totalCostUsd,
        pass_id,
        verify: result.verify ?? null,
        discover: result.discover ?? null,
      });

      if (isHostedBlobs) {
        // Sync remaining events (post-consolidation) + pass summary back to Blobs.
        const remaining = mm.list({ limit: 500 });
        await blobsSetMemoryEvents(uid, vaultId, [...remaining, passEvent]);
      } else {
        mm.store('consolidation_pass', passEvent.data);
      }
    }

    // Clean up temp dir used for hosted path.
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }

    return res.json({
      topics: result.topics,
      total_events: result.total_events,
      verify: result.verify ?? null,
      discover: result.discover ?? null,
      cost_usd: totalCostUsd,
      pass_id,
      dry_run: result.dry_run,
    });
  } catch (e) {
    console.error('[bridge] POST /api/v1/memory/consolidate', e?.message);
    res.status(500).json({ error: e.message || 'Consolidation failed', code: 'RUNTIME_ERROR' });
  }
});

/**
 * GET /api/v1/memory/consolidate/status
 * Response: { last_pass, cost_today_usd, cost_cap_usd, pass_count_month }
 */
app.get('/api/v1/memory/consolidate/status', async (req, res) => {
  const { uid } = bridgeMemoryAuth(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  try {
    const rec = await loadConsolidationCost(uid);
    const today = utcDateString();
    const month = utcMonthString();
    const passCountMonth = rec.pass_month === month ? (rec.pass_count_month || 0) : 0;

    // Cooldown: minutes until the next manual consolidation is available.
    const lastPass = rec.last_pass ?? null;
    let cooldownMinutes = 0;
    if (lastPass) {
      const elapsedMs = Date.now() - new Date(lastPass).getTime();
      const remaining = 30 * 60 * 1000 - elapsedMs;
      cooldownMinutes = remaining > 0 ? Math.ceil(remaining / 60_000) : 0;
    }

    return res.json({
      last_pass: lastPass,
      pass_count_month: passCountMonth,
      cooldown_minutes: cooldownMinutes,
      // Legacy cost fields kept for backward compat
      cost_today_usd: rec.cost_date === today ? (rec.cost_today_usd || 0) : 0,
      cost_cap_usd: process.env.CONSOLIDATION_COST_CAP_USD
        ? parseFloat(process.env.CONSOLIDATION_COST_CAP_USD)
        : null,
    });
  } catch (e) {
    console.error('[bridge] GET /api/v1/memory/consolidate/status', e?.message);
    res.status(500).json({ error: e.message || 'Internal error', code: 'RUNTIME_ERROR' });
  }
});

if (!isServerless) {
  if (!CANISTER_URL || !SESSION_SECRET) {
    console.error('Bridge: CANISTER_URL and SESSION_SECRET (or HUB_JWT_SECRET) are required.');
    console.error('  Add them to the repo root .env (bridge loads ../../.env) or export in your shell.');
    console.error('  Template: hub/bridge/.env.example');
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
