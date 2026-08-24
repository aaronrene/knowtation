/**
 * Phase C — scoped REST agent credential core (storage-agnostic).
 *
 * Opaque credentials use wire format `kt_agent_<id>.<secret>`, hash-at-rest, and
 * never consume-on-use (unlike OAuth refresh rotation). See
 * docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md.
 */

import crypto from 'node:crypto';

/** Default credential lifetime: 90 days. */
export const DEFAULT_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Access JWT lifetime (seconds) — freeze §5.2. */
export const AGENT_ACCESS_TTL_SECONDS = 900;
/** Max non-revoked credentials per sub. */
export const MAX_CREDENTIALS_PER_SUB = 25;
/** Absolute max credential TTL (ms). */
export const MAX_CREDENTIAL_TTL_MS = DEFAULT_CREDENTIAL_TTL_MS;
/** Minimum credential TTL (ms). */
export const MIN_CREDENTIAL_TTL_MS = 60 * 60 * 1000;

export const AGENT_CREDENTIAL_PREFIX = 'kt_agent_';
export const AGENT_ACCESS_TYPE = 'agent_access';
export const AGENT_ACCESS_TYP = 'kt_agent_access';
export const AGENT_ACCESS_AUD = 'knowtation-hub-rest';

export const ALLOWED_AGENT_SCOPES = Object.freeze(['vault:read', 'propose', 'vault:write', 'ingest:automation']);
export const FORBIDDEN_AGENT_SCOPES = Object.freeze(['admin', 'vault:admin']);
export const DEFAULT_AGENT_SCOPES = Object.freeze(['propose', 'vault:read']);

const SECRET_BYTES = 32;
const ID_BYTES = 16;
const CID_BYTES = 16;

/**
 * @param {string} secret
 * @returns {string}
 */
export function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('base64url');
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqualHashes(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * @param {unknown} token
 * @returns {{ id: string, secret: string } | null}
 */
export function parseAgentCredential(token) {
  if (typeof token !== 'string' || !token.startsWith(AGENT_CREDENTIAL_PREFIX)) return null;
  const rest = token.slice(AGENT_CREDENTIAL_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return null;
  const id = rest.slice(0, dot);
  const secret = rest.slice(dot + 1);
  if (!id || !secret || secret.includes('.')) return null;
  return { id, secret };
}

/**
 * @param {unknown} scopes
 * @returns {string[]}
 */
export function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return [...DEFAULT_AGENT_SCOPES];
  const out = [];
  for (const s of scopes) {
    const t = String(s || '').trim();
    if (!t) continue;
    if (FORBIDDEN_AGENT_SCOPES.includes(t)) {
      const err = new Error('admin scopes forbidden');
      err.code = 'AGENT_SCOPE_FORBIDDEN';
      throw err;
    }
    if (!ALLOWED_AGENT_SCOPES.includes(t)) {
      const err = new Error(`unknown scope: ${t}`);
      err.code = 'AGENT_SCOPE_UNKNOWN';
      throw err;
    }
    if (!out.includes(t)) out.push(t);
  }
  if (out.length === 0) {
    const err = new Error('scopes required');
    err.code = 'AGENT_SCOPE_EMPTY';
    throw err;
  }
  return out;
}

/**
 * @param {string[]} requested
 * @param {string[]} roleScopes
 * @returns {string[]}
 */
export function applyScopeCeiling(requested, roleScopes) {
  const role = Array.isArray(roleScopes) ? roleScopes.map(String) : [];
  const out = [];
  for (const s of requested) {
    if (s === 'propose' || s === 'ingest:automation') {
      out.push(s);
      continue;
    }
    if (role.includes(s) || (s === 'vault:write' && role.includes('vault:write'))) {
      out.push(s);
    }
  }
  if (out.length === 0) {
    const err = new Error('scopes exceed caller ceiling');
    err.code = 'AGENT_SCOPE_CEILING';
    throw err;
  }
  return out;
}

/**
 * @param {unknown} vaultIds
 * @returns {string[]}
 */
export function normalizeVaultIds(vaultIds) {
  if (!Array.isArray(vaultIds) || vaultIds.length === 0) {
    const err = new Error('vault_ids required');
    err.code = 'AGENT_VAULT_IDS_REQUIRED';
    throw err;
  }
  const out = [];
  for (const v of vaultIds) {
    const t = String(v || '').trim();
    if (!t) continue;
    if (!out.includes(t)) out.push(t.slice(0, 128));
    if (out.length > 32) {
      const err = new Error('too many vault_ids');
      err.code = 'AGENT_VAULT_IDS_LIMIT';
      throw err;
    }
  }
  if (out.length === 0) {
    const err = new Error('vault_ids required');
    err.code = 'AGENT_VAULT_IDS_REQUIRED';
    throw err;
  }
  return out;
}

/**
 * @param {Record<string, object>} records
 * @returns {Record<string, object>}
 */
function cloneRecords(records) {
  const out = {};
  if (records && typeof records === 'object') {
    for (const [k, v] of Object.entries(records)) {
      if (v && typeof v === 'object') {
        out[k] = {
          ...v,
          vault_ids: Array.isArray(v.vault_ids) ? [...v.vault_ids] : [],
          scopes: Array.isArray(v.scopes) ? [...v.scopes] : [],
        };
      }
    }
  }
  return out;
}

/**
 * Count non-revoked credentials for a sub.
 * @param {Record<string, object>} records
 * @param {string} sub
 * @returns {number}
 */
export function countActiveForSub(records, sub) {
  let n = 0;
  for (const rec of Object.values(records || {})) {
    if (rec && rec.sub === sub && !rec.revoked) n += 1;
  }
  return n;
}

/**
 * @param {Record<string, object>} records
 * @param {{
 *   sub: string,
 *   name: string,
 *   vault_ids: string[],
 *   scopes: string[],
 *   now?: number,
 *   ttlMs?: number,
 * }} opts
 */
export function mintCredential(records, opts) {
  const sub = typeof opts.sub === 'string' ? opts.sub.trim() : '';
  if (!sub) throw new Error('mintCredential: sub is required');
  const name = String(opts.name || '').trim().slice(0, 128);
  if (!name) {
    const err = new Error('name required');
    err.code = 'AGENT_NAME_REQUIRED';
    throw err;
  }
  const vault_ids = normalizeVaultIds(opts.vault_ids);
  const scopes = normalizeScopes(opts.scopes);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  let ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_CREDENTIAL_TTL_MS;
  if (ttlMs < MIN_CREDENTIAL_TTL_MS) ttlMs = MIN_CREDENTIAL_TTL_MS;
  if (ttlMs > MAX_CREDENTIAL_TTL_MS) ttlMs = MAX_CREDENTIAL_TTL_MS;

  const next = cloneRecords(records);
  if (countActiveForSub(next, sub) >= MAX_CREDENTIALS_PER_SUB) {
    const err = new Error('credential limit');
    err.code = 'AGENT_CREDENTIAL_LIMIT';
    throw err;
  }

  const lookupId = crypto.randomBytes(ID_BYTES).toString('base64url');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const cid = crypto.randomBytes(CID_BYTES).toString('base64url');
  const credential = `${AGENT_CREDENTIAL_PREFIX}${lookupId}.${secret}`;

  next[cid] = {
    sub,
    name,
    lookup_id: lookupId,
    token_hash: hashSecret(secret),
    vault_ids,
    scopes,
    created_at: now,
    expires_at: now + ttlMs,
    last_used_at: null,
    last_failure_code: null,
    last_failure_at: null,
    revoked: false,
    revoked_at: null,
  };

  return { records: next, credential, id: cid, record: next[cid] };
}

/**
 * Persist last-failure health on a known credential id (Lane D §5.2).
 * @param {Record<string, object>} records
 * @param {string} cid
 * @param {'invalid'|'revoked'|'expired'} reason
 * @param {number} [now]
 * @returns {Record<string, object>}
 */
export function recordCredentialFailure(records, cid, reason, now) {
  const allowed = new Set(['invalid', 'revoked', 'expired']);
  if (!allowed.has(reason)) return cloneRecords(records);
  const next = cloneRecords(records);
  if (!next[cid]) return next;
  const ts = Number.isFinite(now) ? now : Date.now();
  next[cid].last_failure_code = reason;
  next[cid].last_failure_at = ts;
  return next;
}

/**
 * @param {Record<string, object>} records
 * @param {string} credential
 * @param {{ now?: number }} [opts]
 */
export function verifyCredential(records, credential, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const parsed = parseAgentCredential(credential);
  if (!parsed) return { ok: false, reason: 'invalid' };

  let found = null;
  let foundId = null;
  for (const [cid, rec] of Object.entries(records || {})) {
    if (rec && rec.lookup_id === parsed.id) {
      found = rec;
      foundId = cid;
      break;
    }
  }
  if (!found || !foundId) return { ok: false, reason: 'invalid' };
  if (!safeEqualHashes(found.token_hash, hashSecret(parsed.secret))) {
    return {
      ok: false,
      reason: 'invalid',
      id: foundId,
      records: recordCredentialFailure(records, foundId, 'invalid', now),
    };
  }
  if (found.revoked) {
    return {
      ok: false,
      reason: 'revoked',
      id: foundId,
      sub: found.sub,
      records: recordCredentialFailure(records, foundId, 'revoked', now),
    };
  }
  if (now >= found.expires_at) {
    return {
      ok: false,
      reason: 'expired',
      id: foundId,
      sub: found.sub,
      records: recordCredentialFailure(records, foundId, 'expired', now),
    };
  }

  const next = cloneRecords(records);
  next[foundId].last_used_at = now;
  return {
    ok: true,
    records: next,
    id: foundId,
    sub: found.sub,
    scopes: [...found.scopes],
    vault_ids: [...found.vault_ids],
    name: found.name,
  };
}

/**
 * @param {Record<string, object>} records
 * @param {string} cid
 * @param {string} sub
 * @param {{ now?: number }} [opts]
 */
export function revokeCredential(records, cid, sub, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const next = cloneRecords(records);
  const rec = next[cid];
  if (!rec || rec.sub !== sub) return { records: next, revoked: false };
  if (!rec.revoked) {
    rec.revoked = true;
    rec.revoked_at = now;
  }
  return { records: next, revoked: true };
}

/**
 * @param {Record<string, object>} records
 * @param {string} cid
 * @param {string} sub
 * @param {{ now?: number }} [opts]
 */
export function rotateCredential(records, cid, sub, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const next = cloneRecords(records);
  const rec = next[cid];
  if (!rec || rec.sub !== sub || rec.revoked) {
    const err = new Error('not found');
    err.code = 'AGENT_CREDENTIAL_NOT_FOUND';
    throw err;
  }
  if (now >= rec.expires_at) {
    const err = new Error('expired');
    err.code = 'AGENT_CREDENTIAL_EXPIRED';
    throw err;
  }
  const lookupId = crypto.randomBytes(ID_BYTES).toString('base64url');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  rec.lookup_id = lookupId;
  rec.token_hash = hashSecret(secret);
  const credential = `${AGENT_CREDENTIAL_PREFIX}${lookupId}.${secret}`;
  return { records: next, credential, id: cid, record: rec };
}

/**
 * @param {Record<string, object>} records
 * @param {string} sub
 */
export function listCredentialsForSub(records, sub) {
  const out = [];
  for (const [cid, rec] of Object.entries(records || {})) {
    if (!rec || rec.sub !== sub) continue;
    out.push({
      id: cid,
      name: rec.name,
      vault_ids: [...(rec.vault_ids || [])],
      scopes: [...(rec.scopes || [])],
      created_at: rec.created_at ?? null,
      expires_at: rec.expires_at ?? null,
      last_used_at: rec.last_used_at ?? null,
      last_failure_code: rec.last_failure_code ?? null,
      last_failure_at: rec.last_failure_at ?? null,
      revoked: Boolean(rec.revoked),
      revoked_at: rec.revoked_at ?? null,
    });
  }
  out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return out;
}

/**
 * Normalize request path for propose allowlist (freeze §7.3).
 * @param {unknown} rawPath
 * @returns {string}
 */
export function normalizeAgentRequestPath(rawPath) {
  let p = String(rawPath || '');
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

const PROPOSE_CREATE_PATHS = new Set([
  'api/v1/proposals',
  'api/v1/tasks/proposals',
  'api/v1/task-loops/proposals',
]);

/**
 * @param {unknown} scopes
 * @param {string} method
 * @param {string} path
 * @returns {boolean}
 */
export function agentScopesPermitMethod(scopes, method, path) {
  const list = Array.isArray(scopes) ? scopes.map(String) : [];
  const m = String(method || 'GET').toUpperCase();
  const np = normalizeAgentRequestPath(path);
  if (np === 'api/v1/automation/ingest-rules' || np.startsWith('api/v1/automation/ingest-rules/')) {
    return false;
  }
  const safe = m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  const hasWrite =
    list.includes('vault:write') || list.includes('vault:admin') || list.includes('admin');
  if (hasWrite) return true;
  if (safe) return list.includes('vault:read');
  if (m === 'POST' && np === 'api/v1/automation/ingest') {
    return list.includes('ingest:automation');
  }
  if (!list.includes('propose')) return false;
  if (m !== 'POST') return false;
  return PROPOSE_CREATE_PATHS.has(np);
}

/**
 * @param {object|null|undefined} payload
 * @param {string} vaultId
 * @returns {boolean}
 */
export function assertAgentVaultAllowed(payload, vaultId) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.type !== AGENT_ACCESS_TYPE) return true;
  const ids = Array.isArray(payload.vault_ids) ? payload.vault_ids.map(String) : [];
  const vid = String(vaultId || 'default').trim() || 'default';
  return ids.includes(vid);
}
