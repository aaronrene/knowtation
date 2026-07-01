/**
 * Phase 8 P1b-b — local credential store, Argon2id verify, JWT issuance (§3, §5).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { writeRolesFile, readRolesObject, loadRoleMap } from '../roles.mjs';
import { resolveLocalAuthRole } from './local-auth-role.mjs';

export const CREDENTIALS_FILE = 'hub_local_credentials.json';
export const LOGIN_ATTEMPTS_FILE = 'hub_local_login_attempts.json';

/** OWASP 2024 floor parameters (§3.2). */
export const ARGON2_PARAMS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
});

/** Fixed decoy PHC for timing-safe unknown-username verify (§3.3). */
export const DECOY_ARGON2_PHC =
  '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const SCHEMA = 'knowtation.hub_local_credentials/v0';

/**
 * Normalize username for lookup: NFC, trim, lowercase-fold for comparison (§3.1).
 * @param {string} username
 * @returns {string}
 */
export function normalizeUsername(username) {
  if (typeof username !== 'string') return '';
  return username.normalize('NFC').trim().toLowerCase();
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function credentialsPath(dataDir) {
  return path.join(dataDir, CREDENTIALS_FILE);
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function loginAttemptsPath(dataDir) {
  return path.join(dataDir, LOGIN_ATTEMPTS_FILE);
}

/**
 * @param {string} filePath
 */
export function chmod0600(filePath) {
  fs.chmodSync(filePath, 0o600);
}

/**
 * @param {object} params
 * @returns {boolean}
 */
export function assertArgon2ParamsFloor(params) {
  if (!params || typeof params !== 'object') return false;
  if (params.timeCost != null && params.timeCost < 3) return false;
  if (params.memoryCost != null && params.memoryCost < 65536) return false;
  if (params.parallelism != null && params.parallelism !== 4) return false;
  return true;
}

/**
 * Parse PHC string and validate parameter floors.
 * @param {string} phc
 * @returns {{ ok: boolean, params?: { timeCost: number, memoryCost: number, parallelism: number } }}
 */
export function parsePhcParams(phc) {
  if (typeof phc !== 'string' || !phc.startsWith('$argon2id$')) return { ok: false };
  const mMatch = phc.match(/\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (!mMatch) return { ok: false };
  const memoryCost = parseInt(mMatch[1], 10);
  const timeCost = parseInt(mMatch[2], 10);
  const parallelism = parseInt(mMatch[3], 10);
  if (!assertArgon2ParamsFloor({ memoryCost, timeCost, parallelism })) return { ok: false };
  return { ok: true, params: { memoryCost, timeCost, parallelism } };
}

/**
 * @param {string} dataDir
 * @returns {{ schema: string, credentials: Record<string, object>, userCounter: number }}
 */
export function loadCredentialStore(dataDir) {
  const filePath = credentialsPath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { schema: SCHEMA, credentials: {}, userCounter: 0 };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  return {
    schema: data.schema || SCHEMA,
    credentials: data.credentials && typeof data.credentials === 'object' ? data.credentials : {},
    userCounter: Number.isFinite(data.userCounter) ? data.userCounter : 0,
  };
}

/**
 * @param {string} dataDir
 * @param {{ schema: string, credentials: Record<string, object>, userCounter: number }} store
 */
export function saveCredentialStore(dataDir, store) {
  if (!dataDir) throw new Error('dataDir required');
  const filePath = credentialsPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    schema: SCHEMA,
    credentials: store.credentials,
    userCounter: store.userCounter,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  chmod0600(filePath);
}

/**
 * @param {{ credentials: Record<string, object> }} store
 * @param {string} normalizedUsername
 * @returns {{ sub: string, cred: object } | null}
 */
export function findCredentialByUsername(store, normalizedUsername) {
  for (const [sub, cred] of Object.entries(store.credentials)) {
    if (normalizeUsername(cred.username) === normalizedUsername) {
      return { sub, cred };
    }
  }
  return null;
}

/**
 * @param {string} passphrase
 * @returns {Promise<string>}
 */
export async function hashPassphrase(passphrase) {
  return argon2.hash(passphrase, {
    ...ARGON2_PARAMS,
    salt: crypto.randomBytes(16),
  });
}

/**
 * Timing-safe verify: dummy verify when username not found (§3.3).
 * @param {string|null|undefined} phc
 * @param {string} passphrase
 * @returns {Promise<boolean>}
 */
export async function verifyPassphrase(phc, passphrase) {
  const target = phc || DECOY_ARGON2_PHC;
  try {
    return await argon2.verify(target, passphrase);
  } catch (_) {
    return false;
  } finally {
    if (typeof passphrase === 'string') {
      passphrase.replace(/./g, '\0');
    }
  }
}

/**
 * @param {object} credential
 * @param {string} role
 * @param {string} sessionSecret
 * @param {string} jwtExpiry
 * @returns {string}
 */
export function issueLocalToken(credential, role, sessionSecret, jwtExpiry = '24h') {
  const sub = `local:${credential.userId}`;
  return jwt.sign(
    {
      sub,
      provider: 'local',
      id: credential.userId,
      name: credential.username,
      role,
    },
    sessionSecret,
    { expiresIn: jwtExpiry }
  );
}

/**
 * Create a new local credential and optionally assign admin role.
 * @param {string} dataDir
 * @param {string} username
 * @param {string} passphrase
 * @param {{ role?: string, mustRotatePassphrase?: boolean }} [opts]
 * @returns {Promise<{ userId: string, sub: string }>}
 */
export async function createLocalCredential(dataDir, username, passphrase, opts = {}) {
  const store = loadCredentialStore(dataDir);
  const normalized = normalizeUsername(username);
  if (findCredentialByUsername(store, normalized)) {
    throw new Error('USERNAME_TAKEN');
  }
  store.userCounter += 1;
  const finalUserId =
    store.userCounter === 1 ? 'admin_001' : `user_${String(store.userCounter).padStart(3, '0')}`;
  const sub = `local:${finalUserId}`;
  const argon2id = await hashPassphrase(passphrase);
  store.credentials[sub] = {
    userId: finalUserId,
    username: username.normalize('NFC').trim(),
    argon2id,
    createdAt: new Date().toISOString(),
    mustRotatePassphrase: Boolean(opts.mustRotatePassphrase),
  };
  saveCredentialStore(dataDir, store);
  const role = opts.role || 'admin';
  const roles = readRolesObject(dataDir);
  roles[sub] = role;
  writeRolesFile(dataDir, roles);
  return { userId: finalUserId, sub };
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function credentialStoreHasAdmin(dataDir) {
  const store = loadCredentialStore(dataDir);
  if (Object.keys(store.credentials).length === 0) return false;
  const roleMap = loadRoleMap(dataDir);
  for (const sub of Object.keys(store.credentials)) {
    if (roleMap.get(sub) === 'admin') return true;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function hasAnyCredential(dataDir) {
  const store = loadCredentialStore(dataDir);
  return Object.keys(store.credentials).length > 0;
}

/**
 * @param {string} dataDir
 * @returns {Record<string, { failures: number, firstFailureAt: string|null, lockedUntil: string|null }>}
 */
export function loadLoginAttempts(dataDir) {
  const filePath = loginAttemptsPath(dataDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @param {Record<string, object>} attempts
 */
export function saveLoginAttempts(dataDir, attempts) {
  const filePath = loginAttemptsPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(attempts, null, 2), 'utf8');
  chmod0600(filePath);
}

const LOCKOUT_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * @param {Record<string, object>} attempts
 * @param {string} key - sub or username key
 * @returns {{ locked: boolean, retryAfterSeconds?: number }}
 */
export function checkAccountLocked(attempts, key) {
  const rec = attempts[key];
  if (!rec || !rec.lockedUntil) return { locked: false };
  const until = new Date(rec.lockedUntil).getTime();
  if (Date.now() >= until) return { locked: false };
  return { locked: true, retryAfterSeconds: Math.ceil((until - Date.now()) / 1000) };
}

/**
 * @param {Record<string, object>} attempts
 * @param {string} key
 */
export function recordLoginFailure(attempts, key) {
  const now = new Date().toISOString();
  const rec = attempts[key] || { failures: 0, firstFailureAt: null, lockedUntil: null };
  if (rec.firstFailureAt) {
    const first = new Date(rec.firstFailureAt).getTime();
    if (Date.now() - first > LOCKOUT_WINDOW_MS) {
      rec.failures = 0;
      rec.firstFailureAt = null;
      rec.lockedUntil = null;
    }
  }
  if (!rec.firstFailureAt) rec.firstFailureAt = now;
  rec.failures += 1;
  if (rec.failures >= LOCKOUT_FAILURES) {
    rec.lockedUntil = new Date(Date.now() + LOCKOUT_WINDOW_MS).toISOString();
  }
  attempts[key] = rec;
  return rec;
}

/**
 * @param {Record<string, object>} attempts
 * @param {string} key
 */
export function clearLoginAttempts(attempts, key) {
  delete attempts[key];
}

/** Global token bucket: 20 attempts/minute (§7.2). */
const globalBucket = { tokens: 20, lastRefill: Date.now() };
const GLOBAL_RATE = 20;
const GLOBAL_WINDOW_MS = 60 * 1000;

/**
 * @returns {{ allowed: boolean, retryAfterSeconds?: number }}
 */
export function checkGlobalLoginRateLimit() {
  const now = Date.now();
  const elapsed = now - globalBucket.lastRefill;
  if (elapsed >= GLOBAL_WINDOW_MS) {
    globalBucket.tokens = GLOBAL_RATE;
    globalBucket.lastRefill = now;
  }
  if (globalBucket.tokens <= 0) {
    const retryAfterSeconds = Math.ceil((GLOBAL_WINDOW_MS - (now - globalBucket.lastRefill)) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  globalBucket.tokens -= 1;
  return { allowed: true };
}

/** Reset global bucket (tests). */
export function resetGlobalLoginRateLimitForTests() {
  globalBucket.tokens = GLOBAL_RATE;
  globalBucket.lastRefill = Date.now();
}

/**
 * Perform local login verification.
 * @param {string} dataDir
 * @param {string} username
 * @param {string} passphrase
 * @param {{ sessionSecret: string, jwtExpiry?: string, offlineLockedActive?: boolean, adminUserIdsSet?: Set<string> }} opts
 * @returns {Promise<{ ok: true, token: string, sub: string, credential: object } | { ok: false, code: string, retryAfterSeconds?: number }>}
 */
export async function authenticateLocalUser(dataDir, username, passphrase, opts) {
  const global = checkGlobalLoginRateLimit();
  if (!global.allowed) {
    return { ok: false, code: 'RATE_LIMITED', retryAfterSeconds: global.retryAfterSeconds };
  }

  if (!hasAnyCredential(dataDir)) {
    return { ok: false, code: 'OFFLINE_LOCKED_NOT_BOOTSTRAPPED' };
  }

  const store = loadCredentialStore(dataDir);
  const normalized = normalizeUsername(username);
  const found = findCredentialByUsername(store, normalized);
  const attempts = loadLoginAttempts(dataDir);
  const attemptKey = found ? found.sub : `username:${normalized}`;

  const lock = checkAccountLocked(attempts, attemptKey);
  if (lock.locked) {
    return { ok: false, code: 'ACCOUNT_LOCKED', retryAfterSeconds: lock.retryAfterSeconds };
  }

  const phc = found ? found.cred.argon2id : null;
  const valid = await verifyPassphrase(phc, passphrase);

  if (!valid) {
    recordLoginFailure(attempts, attemptKey);
    saveLoginAttempts(dataDir, attempts);
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  clearLoginAttempts(attempts, attemptKey);
  saveLoginAttempts(dataDir, attempts);

  const role = resolveLocalAuthRole(dataDir, found.sub, {
    offlineLockedActive: opts.offlineLockedActive,
    adminUserIdsSet: opts.adminUserIdsSet,
  });

  const token = issueLocalToken(found.cred, role, opts.sessionSecret, opts.jwtExpiry || '24h');
  return { ok: true, token, sub: found.sub, credential: found.cred };
}

/**
 * Issue CLI token after passphrase verify (§8.2).
 * @param {string} dataDir
 * @param {string} username
 * @param {string} passphrase
 * @param {{ sessionSecret: string, jwtExpiry?: string, offlineLockedActive?: boolean, adminUserIdsSet?: Set<string> }} opts
 * @returns {Promise<{ ok: true, token: string, sub: string } | { ok: false, code: string, retryAfterSeconds?: number }>}
 */
export async function issueCliLocalToken(dataDir, username, passphrase, opts) {
  const result = await authenticateLocalUser(dataDir, username, passphrase, opts);
  if (!result.ok) return result;
  return { ok: true, token: result.token, sub: result.sub };
}
