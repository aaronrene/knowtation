/**
 * Phase 8 P1b-b — first-admin bootstrap: setup token + CLI (§4).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLocalCredential, loadCredentialStore, credentialStoreHasAdmin } from './local-auth.mjs';
import { validatePassphraseStrength } from './breached-passwords.mjs';
import { appendLocalAuthAudit } from './local-auth-audit.mjs';

export const BOOTSTRAP_FILE = 'hub_local_bootstrap.json';
export const BOOTSTRAP_CONSUMED_FILE = 'hub_local_bootstrap_consumed.json';

/** Fixed decoy SHA-256 for timing-safe unknown-token verify (§7.4). */
const DECOY_TOKEN_HASH = crypto.createHash('sha256').update('decoy-bootstrap-token').digest('hex');

/**
 * @param {string} dataDir
 * @returns {Set<string>}
 */
function loadConsumedTokenHashes(dataDir) {
  const filePath = path.join(dataDir, BOOTSTRAP_CONSUMED_FILE);
  if (!fs.existsSync(filePath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const arr = Array.isArray(data.consumedHashes) ? data.consumedHashes : [];
    return new Set(arr);
  } catch (_) {
    return new Set();
  }
}

/**
 * @param {string} dataDir
 * @param {string} tokenHash
 */
function markTokenHashConsumed(dataDir, tokenHash) {
  const consumed = loadConsumedTokenHashes(dataDir);
  consumed.add(tokenHash);
  const filePath = path.join(dataDir, BOOTSTRAP_CONSUMED_FILE);
  fs.writeFileSync(filePath, JSON.stringify({ consumedHashes: [...consumed] }, null, 2), 'utf8');
  fs.chmodSync(filePath, 0o600);
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function bootstrapPath(dataDir) {
  return path.join(dataDir, BOOTSTRAP_FILE);
}

/**
 * @param {string} token
 * @returns {string}
 */
export function hashSetupToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Timing-safe token hash compare.
 * @param {string} presented
 * @param {string} storedHash
 * @returns {boolean}
 */
export function verifySetupTokenHash(presented, storedHash) {
  const a = Buffer.from(hashSetupToken(presented || ''), 'hex');
  const b = Buffer.from(storedHash || DECOY_TOKEN_HASH, 'hex');
  if (a.length !== b.length) {
    const decoy = Buffer.from(DECOY_TOKEN_HASH, 'hex');
    crypto.timingSafeEqual(decoy, decoy);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {string} dataDir
 * @returns {object|null}
 */
export function loadBootstrapRecord(dataDir) {
  const filePath = bootstrapPath(dataDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} dataDir
 * @param {object} record
 */
export function saveBootstrapRecord(dataDir, record) {
  const filePath = bootstrapPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  fs.chmodSync(filePath, 0o600);
}

/**
 * Prune expired bootstrap file at boot (§4.1).
 * @param {string} dataDir
 */
export function pruneExpiredBootstrapRecord(dataDir) {
  const rec = loadBootstrapRecord(dataDir);
  if (!rec || !rec.expiresAt) return;
  if (new Date(rec.expiresAt).getTime() < Date.now()) {
    try {
      fs.unlinkSync(bootstrapPath(dataDir));
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Parse expires-in like 15m, 1h.
 * @param {string} raw
 * @returns {number} ms
 */
export function parseExpiresInMs(raw) {
  const s = String(raw || '15m').trim();
  const m = s.match(/^(\d+)(m|h)$/i);
  if (!m) throw new Error('expires-in must be like 15m or 1h');
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = unit === 'h' ? n * 60 * 60 * 1000 : n * 60 * 1000;
  const maxMs = 60 * 60 * 1000;
  if (ms > maxMs) throw new Error('expires-in capped at 60 minutes');
  if (ms < 60 * 1000) throw new Error('expires-in minimum 1m');
  return ms;
}

/**
 * Generate setup token (Mechanism A, §4.1).
 * @param {string} dataDir
 * @param {string} username
 * @param {string} expiresIn - e.g. 15m
 * @returns {{ token: string, bootstrapTokenId: string }}
 */
export function generateSetupToken(dataDir, username, expiresIn = '15m') {
  if (credentialStoreHasAdmin(dataDir)) {
    throw new Error('ALREADY_BOOTSTRAPPED');
  }
  const ms = parseExpiresInMs(expiresIn);
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSetupToken(token);
  const bootstrapTokenId = crypto.randomBytes(8).toString('hex');
  const record = {
    username: username.normalize('NFC').trim(),
    tokenHash,
    expiresAt: new Date(Date.now() + ms).toISOString(),
    consumed: false,
    bootstrapTokenId,
  };
  saveBootstrapRecord(dataDir, record);
  return { token, bootstrapTokenId };
}

/** In-process bootstrap mutex (contention safety, §9 stress). */
let bootstrapConsumeChain = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withBootstrapMutex(fn) {
  const run = bootstrapConsumeChain.then(fn, fn);
  bootstrapConsumeChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/** Bootstrap attempt rate limit (§7.4). */
const bootstrapAttempts = { count: 0, windowStart: Date.now() };
const BOOTSTRAP_ATTEMPT_LIMIT = 5;
const BOOTSTRAP_WINDOW_MS = 15 * 60 * 1000;

/**
 * @returns {boolean}
 */
export function checkBootstrapRateLimit() {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.KNOWTATION_OFFLINE_LOCKED_AUTH_TEST_NO_BOOTSTRAP_RL === '1'
  ) {
    return true;
  }
  const now = Date.now();
  if (now - bootstrapAttempts.windowStart > BOOTSTRAP_WINDOW_MS) {
    bootstrapAttempts.count = 0;
    bootstrapAttempts.windowStart = now;
  }
  if (bootstrapAttempts.count >= BOOTSTRAP_ATTEMPT_LIMIT) return false;
  bootstrapAttempts.count += 1;
  return true;
}

/** Reset bootstrap rate limit (tests). */
export function resetBootstrapRateLimitForTests() {
  bootstrapAttempts.count = 0;
  bootstrapAttempts.windowStart = Date.now();
}

/**
 * Consume setup token via bootstrap route (Mechanism A).
 * @param {string} dataDir
 * @param {string} setupToken
 * @param {string} username
 * @param {string} passphrase
 * @param {{ ip?: string, ua?: string }} auditMeta
 * @returns {Promise<{ ok: true, userId: string } | { ok: false, code: string }>}
 */
export async function consumeSetupToken(dataDir, setupToken, username, passphrase, auditMeta = {}) {
  return withBootstrapMutex(async () => {
    if (!checkBootstrapRateLimit()) {
      return { ok: false, code: 'RATE_LIMITED' };
    }

    const presentedHash = hashSetupToken(setupToken);
    const consumedHashes = loadConsumedTokenHashes(dataDir);
    if (consumedHashes.has(presentedHash)) {
      appendLocalAuthAudit(dataDir, 'local_auth.bootstrap_rejected', {
        reason: 'consumed',
        ip: auditMeta.ip || 'unknown',
        ts: new Date().toISOString(),
      });
      return { ok: false, code: 'BOOTSTRAP_TOKEN_CONSUMED' };
    }

    if (credentialStoreHasAdmin(dataDir)) {
      return { ok: false, code: 'ALREADY_BOOTSTRAPPED' };
    }
    const strength = validatePassphraseStrength(passphrase);
    if (!strength.ok) {
      return { ok: false, code: strength.code || 'WEAK_PASSPHRASE' };
    }

    const record = loadBootstrapRecord(dataDir);
  if (!record) {
    verifySetupTokenHash(setupToken, DECOY_TOKEN_HASH);
    appendLocalAuthAudit(dataDir, 'local_auth.bootstrap_rejected', {
      reason: 'unknown_token',
      ip: auditMeta.ip || 'unknown',
      ts: new Date().toISOString(),
    });
    return { ok: false, code: 'BOOTSTRAP_TOKEN_EXPIRED' };
  }
  if (record.consumed) {
    appendLocalAuthAudit(dataDir, 'local_auth.bootstrap_rejected', {
      reason: 'consumed',
      ip: auditMeta.ip || 'unknown',
      ts: new Date().toISOString(),
    });
    return { ok: false, code: 'BOOTSTRAP_TOKEN_CONSUMED' };
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    appendLocalAuthAudit(dataDir, 'local_auth.bootstrap_rejected', {
      reason: 'expired',
      ip: auditMeta.ip || 'unknown',
      ts: new Date().toISOString(),
    });
    return { ok: false, code: 'BOOTSTRAP_TOKEN_EXPIRED' };
  }
  if (!verifySetupTokenHash(setupToken, record.tokenHash)) {
    verifySetupTokenHash(setupToken, DECOY_TOKEN_HASH);
    appendLocalAuthAudit(dataDir, 'local_auth.bootstrap_rejected', {
      reason: 'invalid_token',
      ip: auditMeta.ip || 'unknown',
      ts: new Date().toISOString(),
    });
    return { ok: false, code: 'BOOTSTRAP_TOKEN_EXPIRED' };
  }

  const normalizedReq = username.normalize('NFC').trim();
  const normalizedRec = record.username;
  if (normalizeUsernameCompare(normalizedReq, normalizedRec) === false) {
    return { ok: false, code: 'BOOTSTRAP_TOKEN_EXPIRED' };
  }

  const { userId, sub } = await createLocalCredential(dataDir, username, passphrase, {
    role: 'admin',
    mustRotatePassphrase: true,
  });

  record.consumed = true;
  markTokenHashConsumed(dataDir, record.tokenHash);
  try {
    fs.unlinkSync(bootstrapPath(dataDir));
  } catch (_) {
    saveBootstrapRecord(dataDir, { ...record, consumed: true });
  }

  appendLocalAuthAudit(dataDir, 'local_auth.bootstrap_consumed', {
    sub,
    username: record.username,
    ip: auditMeta.ip || 'unknown',
    ts: new Date().toISOString(),
    bootstrapTokenId: record.bootstrapTokenId || 'unknown',
  });

  return { ok: true, userId };
  });
}

function normalizeUsernameCompare(a, b) {
  return a.normalize('NFC').trim().toLowerCase() === b.normalize('NFC').trim().toLowerCase();
}

/**
 * CLI bootstrap-admin (Mechanism B, §4.2).
 * @param {string} dataDir
 * @param {string} username
 * @param {string} passphrase
 * @returns {Promise<{ ok: true, userId: string }>}
 */
export async function bootstrapAdminCli(dataDir, username, passphrase) {
  if (credentialStoreHasAdmin(dataDir)) {
    throw new Error('ALREADY_BOOTSTRAPPED');
  }
  const strength = validatePassphraseStrength(passphrase);
  if (!strength.ok) {
    const err = new Error(strength.code || 'WEAK_PASSPHRASE');
    err.code = strength.code;
    throw err;
  }
  const { userId } = await createLocalCredential(dataDir, username, passphrase, { role: 'admin' });
  return { ok: true, userId };
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function isBootstrapped(dataDir) {
  return credentialStoreHasAdmin(dataDir) || Object.keys(loadCredentialStore(dataDir).credentials).length > 0;
}
