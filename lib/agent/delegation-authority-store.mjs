/**
 * Transactional DelegationAuthorityStore (RHF-b-KN1).
 *
 * Hosted writes use Netlify Blobs CAS (`getWithMetadata` + `onlyIfMatch` / `onlyIfNew`).
 * Local/tests use a file-backed CAS adapter with the same semantics.
 *
 * Forbidden: hydrate/mutate/persist blind overwrite for renewal, validate, revoke.
 *
 * @see ~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md §B2–B7
 */

import fs from 'fs';
import path from 'path';
import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

import {
  DELEGATION_AUTHORITY_ENVELOPE_SCHEMA,
  DELEGATION_AUTHORITY_MARKER_SCHEMA,
  DELEGATION_AUTHORITY_UNAVAILABLE,
  computeDelegationAuthorityStateHash,
  delegationAuthorityMarkerBlobKey,
  delegationAuthorityMarkerFileName,
  validateDelegationAuthorityEnvelope,
  validateDelegationAuthorityMarker,
} from './delegation-authority-compat.mjs';
import { getTrustedCatalogIdentity } from './trusted-external-provider-catalog.mjs';
import {
  DELEGATION_CONSENT_SCHEMA,
  DELEGATION_GRANT_SCHEMA,
  DELEGATION_GRANT_MINT_SCHEMA,
  DELEGATION_CONSENTS_FILE,
  DELEGATION_GRANTS_FILE,
  DELEGATION_IDENTITIES_FILE,
  GRANT_BEARER_PREFIX,
  GRANT_ID_PREFIX,
  hashGrantBearer,
  hashPrincipalRef,
  grantForClient,
  loadConsentsStore,
  loadGrantsStore,
  loadIdentitiesStore,
} from './delegation.mjs';

export const DELEGATION_VALIDATION_SCHEMA = 'knowtation.delegation_validation/v1';
export const DELEGATION_ERROR_SCHEMA = 'knowtation.delegation_error/v1';
export const HELPER_ACCESS_SCHEMA = 'knowtation.helper_access/v1';

export const DELEGATION_REQUEST_INVALID = 'DELEGATION_REQUEST_INVALID';
export const DELEGATION_SESSION_REQUIRED = 'DELEGATION_SESSION_REQUIRED';
export const DELEGATION_HELPER_CONSENT_REQUIRED = 'DELEGATION_HELPER_CONSENT_REQUIRED';
export const DELEGATION_HELPER_ACTOR_DENIED = 'DELEGATION_HELPER_ACTOR_DENIED';
export const DELEGATION_AUTHORITY_DENIED = 'DELEGATION_AUTHORITY_DENIED';
export const DELEGATION_AUTHORITY_CONFLICT = 'DELEGATION_AUTHORITY_CONFLICT';
export const DELEGATION_HELPER_RENEW_RATE_LIMITED = 'DELEGATION_HELPER_RENEW_RATE_LIMITED';
export { DELEGATION_AUTHORITY_UNAVAILABLE };
export const DELEGATION_AUTHORITY_CAPACITY = 'DELEGATION_AUTHORITY_CAPACITY';

export const UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export const RETAIL_ACTOR_ID = 'agent_codex_retail';
export const RENEW_TTL_SECONDS = 900;
export const RENEW_MAX_ACTIONS = 64;
export const RENEW_RATE_LIMIT = 12;
export const RENEW_RATE_WINDOW_MS = 5 * 60 * 1000;

export const MAX_CONSENTS = 256;
export const MAX_GRANTS = 3072;
export const MAX_RATE_BUCKETS = 64;
export const MAX_AUDIT_OUTBOX = 128;
export const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
export const CAS_MAX_RETRIES = 3;
export const RATE_BUCKET_CLOSED_PRUNE_MS = 10 * 60 * 1000;

const ENVELOPE_SCHEMA_VERSION = 1;
const MARKER_SCHEMA_VERSION = 1;
const SHA256_PREFIX = 'sha256:';
/** Netlify Blobs read-after-write: always strong for authority (revocation next-RPC). */
const STRONG_GET = Object.freeze({ type: 'text', consistency: 'strong' });
const HKDF_SALT = 'scooling-delegation-authority/v1';
const HKDF_INFO = 'principal-subject-key';

/**
 * @param {string} vaultId
 * @returns {string}
 */
export function delegationAuthorityEnvelopeBlobKey(vaultId) {
  return `delegation/authority/v1/${encodeURIComponent(vaultId)}/envelope`;
}

/**
 * @param {string} vaultId
 * @returns {string}
 */
export function delegationAuthorityCandidateBlobKey(vaultId) {
  return `delegation/authority/v1/${encodeURIComponent(vaultId)}/candidate`;
}

/**
 * @param {string} vaultId
 * @returns {string}
 */
export function delegationAuthorityEnvelopeFileName(vaultId) {
  return `hub_delegation_authority_envelope_${vaultId}.json`;
}

/**
 * @param {string} vaultId
 * @returns {string}
 */
export function delegationAuthorityCandidateFileName(vaultId) {
  return `hub_delegation_authority_candidate_${vaultId}.json`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStrictUtcTimestamp(value) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_RE.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/**
 * Optional empty expiry is allowed (no expiry). Nonempty malformed → invalid.
 *
 * @param {unknown} value
 * @returns {{ ok: true, absent: boolean } | { ok: false }}
 */
export function parseOptionalStrictUtc(value) {
  if (value == null || value === '') return { ok: true, absent: true };
  if (!isStrictUtcTimestamp(value)) return { ok: false };
  return { ok: true, absent: false };
}

/**
 * Active when not revoked and not expired at now >= expires_at.
 *
 * @param {object} consent
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isConsentActiveStrict(consent, nowMs = Date.now()) {
  if (!consent || typeof consent !== 'object') return false;
  if (consent.revoked_at) return false;
  if (consent.expires_at) {
    if (!isStrictUtcTimestamp(consent.expires_at)) return false;
    if (nowMs >= Date.parse(consent.expires_at)) return false;
  }
  return true;
}

/**
 * @param {object} grant
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isGrantActiveStrict(grant, nowMs = Date.now()) {
  if (!grant || typeof grant !== 'object') return false;
  if (grant.revoked_at) return false;
  if (!isStrictUtcTimestamp(grant.expires_at)) return false;
  if (nowMs >= Date.parse(grant.expires_at)) return false;
  const max = typeof grant.max_actions === 'number' ? grant.max_actions : Infinity;
  const count = typeof grant.action_count === 'number' ? grant.action_count : 0;
  if (count >= max) return false;
  return true;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constantTimeEqualHexOrString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * @param {string} principalRef
 * @param {string} actorId
 * @returns {string}
 */
export function principalActorKey(principalRef, actorId) {
  return `${principalRef}\u0000${actorId}`;
}

/**
 * @param {Buffer|string} ikm
 * @returns {Buffer}
 */
export function derivePrincipalSubjectKey(ikm) {
  return Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, 32));
}

/**
 * @param {string} value
 * @returns {Buffer}
 */
function lengthPrefixedUtf8(value) {
  const body = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  return Buffer.concat([len, body]);
}

/**
 * HKDF + HMAC principal-bound subject → 43-char unpadded base64url.
 *
 * @param {{
 *   sessionSecret: string,
 *   sessionSecretPrevious?: string|null,
 *   uid: string,
 *   vaultId: string,
 *   actorId: string,
 * }} input
 * @returns {{ key_id: string, value: string }[]}
 */
export function buildAuthoritySubjects(input) {
  const subjects = [];
  const make = (secret, keyId) => {
    const key = derivePrincipalSubjectKey(secret);
    const h = createHmac('sha256', key);
    h.update(Buffer.from('v1', 'utf8'));
    h.update(lengthPrefixedUtf8(input.uid));
    h.update(lengthPrefixedUtf8(input.vaultId));
    h.update(lengthPrefixedUtf8(input.actorId));
    subjects.push({ key_id: keyId, value: h.digest('base64url') });
  };
  make(input.sessionSecret, 'current');
  if (typeof input.sessionSecretPrevious === 'string' && input.sessionSecretPrevious.trim()) {
    make(input.sessionSecretPrevious.trim(), 'previous');
  }
  return subjects;
}

/**
 * @param {number} [byteLen]
 * @returns {string}
 */
function randomIdToken(byteLen = 16) {
  return randomBytes(byteLen).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24);
}

/**
 * @param {string} prefix
 * @param {number} [byteLen]
 * @returns {string}
 */
function randomPrefixedId(prefix, byteLen = 16) {
  const token = randomIdToken(byteLen);
  return prefix + (token.length >= 8 ? token : token.padEnd(8, '0'));
}

/**
 * @param {unknown} err
 * @param {number} status
 * @param {string} code
 * @param {string} [message]
 */
function fail(status, code, message) {
  return {
    ok: false,
    status,
    code,
    error: message || code,
    schema: DELEGATION_ERROR_SCHEMA,
  };
}

/**
 * In-memory / file CAS backend compatible with Netlify Blobs conditional writes.
 */
export class MemoryCasBlobStore {
  constructor() {
    /** @type {Map<string, { data: string, etag: string, metadata: object }>} */
    this.map = new Map();
    this._seq = 0;
  }

  /**
   * @param {string} key
   * @param {{ type?: string, etag?: string }} [opts]
   */
  async getWithMetadata(key, opts = {}) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (opts.etag && opts.etag === entry.etag) {
      return { data: null, etag: entry.etag, metadata: entry.metadata };
    }
    return { data: entry.data, etag: entry.etag, metadata: entry.metadata };
  }

  /**
   * @param {string} key
   * @param {{ type?: string, consistency?: string }} [opts]
   */
  async get(key, _opts = {}) {
    const entry = this.map.get(key);
    if (!entry) return null;
    return entry.data;
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {{ onlyIfMatch?: string, onlyIfNew?: boolean }} [opts]
   */
  async set(key, value, opts = {}) {
    const existing = this.map.get(key);
    if (opts.onlyIfNew) {
      if (existing) return { modified: false };
    } else if (opts.onlyIfMatch) {
      if (!existing || existing.etag !== opts.onlyIfMatch) return { modified: false };
    }
    const etag = `etag-${++this._seq}`;
    this.map.set(key, { data: value, etag, metadata: {} });
    return { modified: true, etag };
  }
}

/**
 * File-backed CAS for local DATA_DIR (etag sidecar).
 */
export class FileCasBlobStore {
  /**
   * @param {string} dataDir
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  _pathFor(key) {
    const safe = key.replace(/[/\\]/g, '__');
    return path.join(this.dataDir, `cas_${safe}`);
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  _etagPathFor(key) {
    return `${this._pathFor(key)}.etag`;
  }

  /**
   * @param {string} key
   * @param {{ type?: string, etag?: string }} [opts]
   */
  async getWithMetadata(key, opts = {}) {
    const fp = this._pathFor(key);
    const ep = this._etagPathFor(key);
    if (!fs.existsSync(fp)) return null;
    let data;
    let etag;
    try {
      data = fs.readFileSync(fp, 'utf8');
      etag = fs.existsSync(ep) ? fs.readFileSync(ep, 'utf8').trim() : 'etag-0';
    } catch {
      return null;
    }
    if (opts.etag && opts.etag === etag) {
      return { data: null, etag, metadata: {} };
    }
    return { data, etag, metadata: {} };
  }

  /**
   * @param {string} key
   * @param {{ type?: string }} [opts]
   */
  async get(key, _opts = {}) {
    const got = await this.getWithMetadata(key);
    return got ? got.data : null;
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {{ onlyIfMatch?: string, onlyIfNew?: boolean }} [opts]
   */
  async set(key, value, opts = {}) {
    const fp = this._pathFor(key);
    const ep = this._etagPathFor(key);
    const exists = fs.existsSync(fp);
    let currentEtag = null;
    if (exists) {
      try {
        currentEtag = fs.readFileSync(ep, 'utf8').trim();
      } catch {
        currentEtag = 'etag-0';
      }
    }
    if (opts.onlyIfNew) {
      if (exists) return { modified: false };
    } else if (opts.onlyIfMatch) {
      if (!exists || currentEtag !== opts.onlyIfMatch) return { modified: false };
    }
    const nextEtag = `etag-${Date.now()}-${randomBytes(4).toString('hex')}`;
    fs.writeFileSync(fp, value, 'utf8');
    fs.writeFileSync(ep, nextEtag, 'utf8');
    return { modified: true, etag: nextEtag };
  }
}

/**
 * @param {object|null|undefined} blobStore
 * @param {string} dataDir
 * @returns {{ getWithMetadata: Function, set: Function, get?: Function }}
 */
export function resolveAuthorityCasStore(blobStore, dataDir) {
  if (
    blobStore &&
    typeof blobStore.getWithMetadata === 'function' &&
    typeof blobStore.set === 'function'
  ) {
    return blobStore;
  }
  return new FileCasBlobStore(dataDir);
}

/**
 * @param {object} envelope
 * @returns {object}
 */
export function sealEnvelopeStateHash(envelope) {
  const next = { ...envelope };
  delete next.state_hash;
  next.state_hash = computeDelegationAuthorityStateHash(next);
  return next;
}

/**
 * @param {object} envelope
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateEnvelopeInternalIntegrity(envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'missing' };
  if (envelope.schema !== DELEGATION_AUTHORITY_ENVELOPE_SCHEMA) {
    return { ok: false, reason: 'schema' };
  }
  for (const field of [
    'identities_by_id',
    'consents_by_id',
    'grants_by_id',
    'grant_id_by_bearer_hash',
    'newest_active_consent_id_by_principal_actor',
    'rate_buckets_by_principal_actor',
    'audit_outbox_by_id',
  ]) {
    if (envelope[field] == null) continue;
    if (typeof envelope[field] !== 'object' || Array.isArray(envelope[field])) {
      return { ok: false, reason: field };
    }
  }

  for (const consent of Object.values(envelope.consents_by_id || {})) {
    if (!consent || typeof consent !== 'object') return { ok: false, reason: 'consent' };
    if (!isStrictUtcTimestamp(consent.created)) return { ok: false, reason: 'consent.created' };
    const exp = parseOptionalStrictUtc(consent.expires_at);
    if (!exp.ok) return { ok: false, reason: 'consent.expires_at' };
    if (consent.revoked_at != null && consent.revoked_at !== '') {
      if (!isStrictUtcTimestamp(consent.revoked_at)) return { ok: false, reason: 'consent.revoked_at' };
    }
  }
  for (const grant of Object.values(envelope.grants_by_id || {})) {
    if (!grant || typeof grant !== 'object') return { ok: false, reason: 'grant' };
    for (const field of ['issued_at', 'expires_at']) {
      if (!isStrictUtcTimestamp(grant[field])) return { ok: false, reason: `grant.${field}` };
    }
    if (grant.revoked_at != null && grant.revoked_at !== '') {
      if (!isStrictUtcTimestamp(grant.revoked_at)) return { ok: false, reason: 'grant.revoked_at' };
    }
  }

  const expected = computeDelegationAuthorityStateHash(envelope);
  if (expected !== envelope.state_hash) return { ok: false, reason: 'state_hash' };
  return { ok: true };
}

/**
 * @param {object} envelope
 * @returns {boolean}
 */
function underCapacity(envelope) {
  const consents = Object.keys(envelope.consents_by_id || {}).length;
  const grants = Object.keys(envelope.grants_by_id || {}).length;
  const buckets = Object.keys(envelope.rate_buckets_by_principal_actor || {}).length;
  const outbox = Object.keys(envelope.audit_outbox_by_id || {}).length;
  if (consents > MAX_CONSENTS) return false;
  if (grants > MAX_GRANTS) return false;
  if (buckets > MAX_RATE_BUCKETS) return false;
  if (outbox > MAX_AUDIT_OUTBOX) return false;
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ENVELOPE_BYTES) return false;
  return true;
}

/**
 * @param {object} entry
 * @returns {string}
 */
function hashAuditEvent(entry) {
  const body = JSON.stringify({
    operation_id: entry.operation_id,
    record_kind: entry.record_kind,
    record_id: entry.record_id,
    sequence: entry.sequence,
    prior_audit_event_hash: entry.prior_audit_event_hash ?? null,
  });
  return `${SHA256_PREFIX}${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/**
 * Contiguous materializer: only last_materialized + 1 is eligible (freeze §B2).
 * Writes external audit key with onlyIfNew; advances last_materialized on success.
 *
 * @param {object} envelope
 * @param {{ getWithMetadata?: Function, set?: Function, get?: Function }} cas
 * @returns {Promise<object>}
 */
export async function materializeAuditOutbox(envelope, cas) {
  let next = { ...envelope, audit_outbox_by_id: { ...(envelope.audit_outbox_by_id || {}) } };
  const chainHeads = { ...(next.event_chain_heads_by_record || {}) };

  const records = [
    ...Object.values(next.consents_by_id || {}).map((r) => ({ kind: 'consent', record: r })),
    ...Object.values(next.grants_by_id || {}).map((r) => ({ kind: 'grant', record: r })),
  ];

  for (const { kind, record } of records) {
    if (!record) continue;
    const lastMat = record.last_materialized_audit_sequence || 0;
    const targetSeq = lastMat + 1;
    if ((record.audit_sequence || 0) < targetSeq) continue;

    const entry = Object.values(next.audit_outbox_by_id).find(
      (e) =>
        e &&
        e.record_kind === kind &&
        e.record_id === record[kind === 'consent' ? 'consent_id' : 'grant_id'] &&
        e.sequence === targetSeq,
    );
    if (!entry) continue; // out-of-order later entries remain pending

    const auditKey = `delegation/audit/v1/${entry.operation_id}`;
    const eventHash = hashAuditEvent(entry);
    const payload = JSON.stringify({
      schema: 'knowtation.delegation_audit_event/v1',
      ...entry,
      event_hash: eventHash,
    });

    if (cas && typeof cas.set === 'function') {
      const existing = await cas.get(auditKey, STRONG_GET).catch(() => null);
      if (typeof existing === 'string' && existing.trim()) {
        if (existing.trim() !== payload) {
          // mismatched content blocks materialization for this record
          continue;
        }
      } else {
        const write = await cas.set(auditKey, payload, { onlyIfNew: true });
        if (write && write.modified === false) {
          const again = await cas.get(auditKey, STRONG_GET).catch(() => null);
          if (typeof again !== 'string' || again.trim() !== payload) continue;
        }
      }
    }

    const recordKey = kind === 'consent' ? 'consent_id' : 'grant_id';
    const id = record[recordKey];
    if (kind === 'grant') {
      next.grants_by_id = {
        ...next.grants_by_id,
        [id]: {
          ...record,
          last_materialized_audit_sequence: targetSeq,
          pending_audit_count: Math.max(0, (record.pending_audit_count || 1) - 1),
        },
      };
    } else {
      next.consents_by_id = {
        ...next.consents_by_id,
        [id]: {
          ...record,
          last_materialized_audit_sequence: targetSeq,
          pending_audit_count: Math.max(0, (record.pending_audit_count || 1) - 1),
        },
      };
    }
    chainHeads[`${kind}:${id}`] = eventHash;
    const outbox = { ...next.audit_outbox_by_id };
    delete outbox[entry.operation_id];
    next.audit_outbox_by_id = outbox;
  }

  next.event_chain_heads_by_record = chainHeads;
  return next;
}

/**
 * @param {object} record
 * @param {string} operationId
 * @param {string|null} priorHash
 * @returns {{ record: object, outboxEntry: object }}
 */
function bumpRecordAudit(record, operationId, priorHash) {
  const audit_sequence = (record.audit_sequence || 0) + 1;
  const pending_audit_count = (record.pending_audit_count || 0) + 1;
  const last_materialized_audit_sequence =
    typeof record.last_materialized_audit_sequence === 'number'
      ? record.last_materialized_audit_sequence
      : 0;
  return {
    record: {
      ...record,
      audit_sequence,
      pending_audit_count,
      last_materialized_audit_sequence,
    },
    outboxEntry: {
      operation_id: operationId,
      sequence: audit_sequence,
      prior_audit_event_hash: priorHash,
    },
  };
}

/**
 * Prune closed rate buckets older than 10 minutes; prune expired grants only when audit-complete.
 *
 * @param {object} envelope
 * @param {number} nowMs
 * @returns {object}
 */
export function pruneAuthorityEnvelope(envelope, nowMs = Date.now()) {
  const next = structuredClone(envelope);
  const buckets = { ...(next.rate_buckets_by_principal_actor || {}) };
  for (const [key, bucket] of Object.entries(buckets)) {
    const stamps = Array.isArray(bucket?.renew_at_ms) ? bucket.renew_at_ms : [];
    const live = stamps.filter((t) => nowMs - t < RENEW_RATE_WINDOW_MS);
    if (live.length === 0) {
      const closedAt = typeof bucket?.closed_at_ms === 'number' ? bucket.closed_at_ms : nowMs;
      if (nowMs - closedAt >= RATE_BUCKET_CLOSED_PRUNE_MS) {
        delete buckets[key];
        continue;
      }
      buckets[key] = { renew_at_ms: [], closed_at_ms: closedAt };
    } else {
      buckets[key] = { renew_at_ms: live };
    }
  }
  next.rate_buckets_by_principal_actor = buckets;

  const grants = { ...(next.grants_by_id || {}) };
  const byHash = { ...(next.grant_id_by_bearer_hash || {}) };
  const outbox = next.audit_outbox_by_id || {};
  for (const [grantId, grant] of Object.entries(grants)) {
    if (isGrantActiveStrict(grant, nowMs)) continue;
    const pending = grant.pending_audit_count || 0;
    const lastMat = grant.last_materialized_audit_sequence || 0;
    const seq = grant.audit_sequence || 0;
    if (pending !== 0) continue;
    if (lastMat !== seq) continue;
    const referenced = Object.values(outbox).some(
      (e) => e && e.record_kind === 'grant' && e.record_id === grantId,
    );
    if (referenced) continue;
    const hash = grant.grant_bearer_hash;
    delete grants[grantId];
    if (hash && byHash[hash] === grantId) delete byHash[hash];
  }
  next.grants_by_id = grants;
  next.grant_id_by_bearer_hash = byHash;
  return next;
}

/**
 * Rebuild newest-active consent index.
 *
 * @param {object} envelope
 * @param {number} [nowMs]
 * @returns {object}
 */
export function rebuildNewestActiveConsentIndex(envelope, nowMs = Date.now()) {
  /** @type {Record<string, string>} */
  const index = {};
  /** @type {Record<string, object[]>} */
  const groups = {};
  for (const consent of Object.values(envelope.consents_by_id || {})) {
    if (!isConsentActiveStrict(consent, nowMs)) continue;
    if (consent.scope !== 'personal') continue;
    const key = principalActorKey(consent.principal_ref, consent.delegate_agent_id);
    if (!groups[key]) groups[key] = [];
    groups[key].push(consent);
  }
  for (const [key, list] of Object.entries(groups)) {
    list.sort((a, b) => {
      const ca = Date.parse(a.created);
      const cb = Date.parse(b.created);
      if (cb !== ca) return cb - ca;
      return String(a.consent_id).localeCompare(String(b.consent_id));
    });
    index[key] = list[0].consent_id;
  }
  return { ...envelope, newest_active_consent_id_by_principal_actor: index };
}

/**
 * Select active personal consent for principal+actor (newest created, then consent_id asc).
 *
 * @param {object} envelope
 * @param {string} principalRef
 * @param {string} actorId
 * @param {number} [nowMs]
 * @returns {object|null}
 */
export function selectActivePersonalConsent(envelope, principalRef, actorId, nowMs = Date.now()) {
  const key = principalActorKey(principalRef, actorId);
  const indexedId = envelope.newest_active_consent_id_by_principal_actor?.[key];
  if (indexedId) {
    const c = envelope.consents_by_id?.[indexedId];
    if (c && isConsentActiveStrict(c, nowMs) && c.scope === 'personal') return c;
  }
  const candidates = Object.values(envelope.consents_by_id || {}).filter(
    (c) =>
      c &&
      c.principal_ref === principalRef &&
      c.delegate_agent_id === actorId &&
      c.scope === 'personal' &&
      isConsentActiveStrict(c, nowMs),
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ca = Date.parse(a.created);
    const cb = Date.parse(b.created);
    if (cb !== ca) return cb - ca;
    return String(a.consent_id).localeCompare(String(b.consent_id));
  });
  return candidates[0];
}

/**
 * @param {object} catalogIdentity
 * @returns {boolean}
 */
export function isRetailCodexIdentity(catalogIdentity) {
  return Boolean(
    catalogIdentity &&
      catalogIdentity.agent_id === RETAIL_ACTOR_ID &&
      catalogIdentity.kind === 'external_provider' &&
      catalogIdentity.provider === 'codex' &&
      catalogIdentity.scope_ceiling === 'personal' &&
      catalogIdentity.status === 'active',
  );
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   blobStore?: object|null,
 *   nowMs?: number,
 *   sessionSecret?: string,
 *   sessionSecretPrevious?: string|null,
 *   operatorAuthorizedMarker?: boolean,
 * }} opts
 */
export function createDelegationAuthorityStore(opts) {
  const dataDir = opts.dataDir;
  const vaultId = opts.vaultId;
  const cas = resolveAuthorityCasStore(opts.blobStore ?? null, dataDir);
  const envelopeKey = delegationAuthorityEnvelopeBlobKey(vaultId);
  const candidateKey = delegationAuthorityCandidateBlobKey(vaultId);
  const markerKey = delegationAuthorityMarkerBlobKey(vaultId);
  const hostedBlob = Boolean(opts.blobStore);

  /**
   * @returns {Promise<
   *   | { ok: true, envelope: object, etag: string|null, mode: 'envelope' }
   *   | { ok: false, status: number, code: string, error: string, schema: string }
   * >}
   */
  async function readActiveEnvelope() {
    let markerRaw;
    try {
      markerRaw = await cas.get(markerKey, STRONG_GET);
    } catch {
      // Fail closed — never fall back to a stale local mirror (BV-1).
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority marker read error');
    }
    if (!markerRaw || (typeof markerRaw === 'string' && !markerRaw.trim())) {
      // Local-only FileCas path may still read marker files. Hosted blob: absent = inactive.
      if (hostedBlob) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope not active');
      }
      const localMarker = path.join(dataDir, delegationAuthorityMarkerFileName(vaultId));
      if (!fs.existsSync(localMarker)) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope not active');
      }
      let marker;
      try {
        marker = JSON.parse(fs.readFileSync(localMarker, 'utf8'));
      } catch {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority marker unreadable');
      }
      const mv = validateDelegationAuthorityMarker(marker, vaultId);
      if (!mv.ok) return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, mv.reason);
      const localEnvPath = path.join(
        dataDir,
        path.basename(marker.envelope_key) || delegationAuthorityEnvelopeFileName(vaultId),
      );
      if (!fs.existsSync(localEnvPath)) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope missing');
      }
      let envelope;
      try {
        envelope = JSON.parse(fs.readFileSync(localEnvPath, 'utf8'));
      } catch {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope unreadable');
      }
      const ev = validateDelegationAuthorityEnvelope(envelope, marker, vaultId);
      if (!ev.ok) return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, ev.reason);
      const iv = validateEnvelopeInternalIntegrity(envelope);
      if (!iv.ok) return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, iv.reason);
      // Promote into CAS so subsequent writes always have an etag (no etag:null mutate).
      const seeded = await cas.set(envelopeKey, JSON.stringify(envelope), { onlyIfNew: true });
      const got = await cas.getWithMetadata(envelopeKey, STRONG_GET).catch(() => null);
      return {
        ok: true,
        envelope,
        etag: got?.etag || seeded?.etag || null,
        mode: 'envelope',
      };
    }

    let marker;
    try {
      marker = typeof markerRaw === 'string' ? JSON.parse(markerRaw) : markerRaw;
    } catch {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority marker parse error');
    }
    const mv = validateDelegationAuthorityMarker(marker, vaultId);
    if (!mv.ok) return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, mv.reason);

    let got;
    try {
      got = await cas.getWithMetadata(marker.envelope_key || envelopeKey, STRONG_GET);
    } catch {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope read error');
    }
    if (!got || got.data == null) {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope missing');
    }
    let envelope;
    try {
      envelope = typeof got.data === 'string' ? JSON.parse(got.data) : got.data;
    } catch {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope parse error');
    }
    const ev = validateDelegationAuthorityEnvelope(envelope, marker, vaultId);
    if (!ev.ok) return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, ev.reason);
    const iv = validateEnvelopeInternalIntegrity(envelope);
    if (!iv.ok) return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, iv.reason);
    return { ok: true, envelope, etag: got.etag ?? null, mode: 'envelope' };
  }

  /**
   * @param {(envelope: object) =>
   *   | { ok: true, envelope: object, result: object }
   *   | { ok: false, status: number, code: string, error?: string }
   * } transform
   */
  async function mutateEnvelope(transform) {
    let attempt = 0;
    while (attempt < CAS_MAX_RETRIES) {
      attempt += 1;
      const loaded = await readActiveEnvelope();
      if (!loaded.ok) return loaded;

      let working = pruneAuthorityEnvelope(loaded.envelope, opts.nowMs ?? Date.now());
      working = rebuildNewestActiveConsentIndex(working, opts.nowMs ?? Date.now());

      const transformed = transform(working);
      if (!transformed.ok) {
        return fail(transformed.status, transformed.code, transformed.error || transformed.code);
      }

      let next = transformed.envelope;
      if (!underCapacity(next)) {
        return fail(507, DELEGATION_AUTHORITY_CAPACITY, 'Authority envelope at capacity');
      }

      const priorHash = loaded.envelope.state_hash;
      next = {
        ...next,
        revision: (loaded.envelope.revision || 0) + 1,
        previous_state_hash: priorHash,
      };
      next = sealEnvelopeStateHash(next);

      const iv = validateEnvelopeInternalIntegrity(next);
      if (!iv.ok) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, `Envelope invalid after transform: ${iv.reason}`);
      }

      const payload = JSON.stringify(next);
      if (Buffer.byteLength(payload, 'utf8') > MAX_ENVELOPE_BYTES) {
        return fail(507, DELEGATION_AUTHORITY_CAPACITY, 'Authority envelope exceeds size limit');
      }

      try {
        let etag = loaded.etag;
        if (!etag) {
          // Recover etag via strong read — never blind-overwrite.
          const fresh = await cas.getWithMetadata(envelopeKey, STRONG_GET).catch(() => null);
          if (fresh && fresh.etag) {
            etag = fresh.etag;
          } else {
            const created = await cas.set(envelopeKey, payload, { onlyIfNew: true });
            if (!created || created.modified === false) {
              const jitter = 5 + Math.floor(Math.random() * 20) * attempt;
              await new Promise((r) => setTimeout(r, jitter));
              continue;
            }
            let drained = await materializeAuditOutbox(next, cas);
            drained = {
              ...drained,
              revision: (next.revision || 0) + 1,
              previous_state_hash: next.state_hash,
            };
            drained = sealEnvelopeStateHash(drained);
            if (created.etag) {
              await cas.set(envelopeKey, JSON.stringify(drained), { onlyIfMatch: created.etag });
            }
            next = drained;
            if (!hostedBlob) {
              const localPath = path.join(dataDir, path.basename(envelopeKey));
              fs.writeFileSync(localPath, JSON.stringify(next), 'utf8');
            }
            return { ok: true, ...transformed.result, envelope: next };
          }
        }
        const write = await cas.set(envelopeKey, payload, { onlyIfMatch: etag });
        if (!write || write.modified === false) {
          const jitter = 5 + Math.floor(Math.random() * 20) * attempt;
          await new Promise((r) => setTimeout(r, jitter));
          continue;
        }
        // Materialize only AFTER authority CAS (crash before CAS => no external audit).
        let drained = await materializeAuditOutbox(next, cas);
        drained = {
          ...drained,
          revision: (next.revision || 0) + 1,
          previous_state_hash: next.state_hash,
        };
        drained = sealEnvelopeStateHash(drained);
        const drainPayload = JSON.stringify(drained);
        const drainEtag = write.etag;
        if (drainEtag) {
          const drainWrite = await cas.set(envelopeKey, drainPayload, { onlyIfMatch: drainEtag });
          if (drainWrite && drainWrite.modified !== false) {
            next = drained;
          }
          // If drain CAS conflicts, pending outbox remains — resumable next mutation.
        } else {
          next = drained;
          await cas.set(envelopeKey, drainPayload).catch(() => {});
        }
        if (!hostedBlob) {
          const localPath = path.join(dataDir, path.basename(envelopeKey));
          fs.writeFileSync(localPath, JSON.stringify(next), 'utf8');
        }
      } catch {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Authority envelope write error');
      }

      return { ok: true, ...transformed.result, envelope: next };
    }
    return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Authority envelope conflict');
  }

  /**
   * @param {string} uid
   * @param {string} actorId
   */
  async function readHelperAccess(uid, actorId) {
    const actor = typeof actorId === 'string' ? actorId.trim() : '';
    if (actor !== RETAIL_ACTOR_ID) {
      return fail(403, DELEGATION_HELPER_ACTOR_DENIED, 'Helper actor denied');
    }
    const catalog = getTrustedCatalogIdentity(RETAIL_ACTOR_ID);
    if (!isRetailCodexIdentity(catalog)) {
      return fail(403, DELEGATION_HELPER_ACTOR_DENIED, 'Helper actor denied');
    }
    const loaded = await readActiveEnvelope();
    if (!loaded.ok) return loaded;
    const principal = hashPrincipalRef(uid);
    const nowMs = opts.nowMs ?? Date.now();
    const consent = selectActivePersonalConsent(loaded.envelope, principal, actor, nowMs);
    if (!consent) {
      return {
        ok: true,
        payload: {
          schema: HELPER_ACCESS_SCHEMA,
          actor_agent_id: RETAIL_ACTOR_ID,
          state: 'consent_required',
        },
      };
    }
    const gKey = principalActorKey(principal, actor);
    const indexedGrantId = loaded.envelope.active_grant_id_by_principal_actor?.[gKey];
    let activeGrant = indexedGrantId ? loaded.envelope.grants_by_id?.[indexedGrantId] : null;
    if (!activeGrant || !isGrantActiveStrict(activeGrant, nowMs) || activeGrant.principal_ref !== principal) {
      activeGrant = null;
    }
    return {
      ok: true,
      payload: {
        schema: HELPER_ACCESS_SCHEMA,
        actor_agent_id: RETAIL_ACTOR_ID,
        state: activeGrant ? 'ready' : 'renewable',
      },
    };
  }

  /**
   * @param {string} uid
   * @param {string} actorId
   */
  async function renewPersonal(uid, actorId) {
    const actor = typeof actorId === 'string' ? actorId.trim() : '';
    if (actor !== RETAIL_ACTOR_ID) {
      return fail(403, DELEGATION_HELPER_ACTOR_DENIED, 'Helper actor denied');
    }
    const catalog = getTrustedCatalogIdentity(RETAIL_ACTOR_ID);
    if (!isRetailCodexIdentity(catalog)) {
      return fail(403, DELEGATION_HELPER_ACTOR_DENIED, 'Helper actor denied');
    }
    const principal = hashPrincipalRef(uid);
    const nowMs = opts.nowMs ?? Date.now();

    return mutateEnvelope((envelope) => {
      const consent = selectActivePersonalConsent(envelope, principal, actor, nowMs);
      if (!consent) {
        return {
          ok: false,
          status: 403,
          code: DELEGATION_HELPER_CONSENT_REQUIRED,
          error: 'Helper consent required',
        };
      }

      const bucketKey = principalActorKey(principal, actor);
      const buckets = { ...(envelope.rate_buckets_by_principal_actor || {}) };
      const bucket = buckets[bucketKey] || { renew_at_ms: [] };
      const recent = (bucket.renew_at_ms || []).filter((t) => nowMs - t < RENEW_RATE_WINDOW_MS);
      if (recent.length >= RENEW_RATE_LIMIT) {
        return {
          ok: false,
          status: 429,
          code: DELEGATION_HELPER_RENEW_RATE_LIMITED,
          error: 'Helper renew rate limited',
        };
      }
      if (
        Object.keys(buckets).length >= MAX_RATE_BUCKETS &&
        !buckets[bucketKey]
      ) {
        return {
          ok: false,
          status: 507,
          code: DELEGATION_AUTHORITY_CAPACITY,
          error: 'Rate bucket capacity',
        };
      }

      if (Object.keys(envelope.grants_by_id || {}).length >= MAX_GRANTS) {
        return {
          ok: false,
          status: 507,
          code: DELEGATION_AUTHORITY_CAPACITY,
          error: 'Grant capacity',
        };
      }

      const issuedAt = new Date(nowMs).toISOString();
      if (!isStrictUtcTimestamp(issuedAt)) {
        return {
          ok: false,
          status: 503,
          code: DELEGATION_AUTHORITY_UNAVAILABLE,
          error: 'Clock unavailable',
        };
      }
      const expiresAt = new Date(nowMs + RENEW_TTL_SECONDS * 1000).toISOString();
      const grantId = randomPrefixedId(GRANT_ID_PREFIX);
      const bearer = randomPrefixedId(GRANT_BEARER_PREFIX, 24);
      const bearerHash = hashGrantBearer(bearer);
      const operationId = randomBytes(16).toString('hex');
      const chainKey = `grant:${grantId}`;
      const priorHash = envelope.event_chain_heads_by_record?.[chainKey] ?? null;

      let grant = {
        schema: DELEGATION_GRANT_SCHEMA,
        grant_id: grantId,
        consent_id: consent.consent_id,
        actor_agent_id: actor,
        principal_ref: principal,
        scope: 'personal',
        expires_at: expiresAt,
        revoked_at: null,
        max_actions: RENEW_MAX_ACTIONS,
        action_count: 0,
        issued_at: issuedAt,
        grant_bearer_hash: bearerHash,
        audit_sequence: 0,
        last_materialized_audit_sequence: 0,
        pending_audit_count: 0,
      };

      const bumped = bumpRecordAudit(grant, operationId, priorHash);
      grant = bumped.record;

      if (Object.keys(envelope.audit_outbox_by_id || {}).length >= MAX_AUDIT_OUTBOX) {
        return {
          ok: false,
          status: 507,
          code: DELEGATION_AUTHORITY_CAPACITY,
          error: 'Audit outbox full',
        };
      }

      const grants_by_id = { ...(envelope.grants_by_id || {}), [grantId]: grant };
      const grant_id_by_bearer_hash = {
        ...(envelope.grant_id_by_bearer_hash || {}),
        [bearerHash]: grantId,
      };
      const active_grant_id_by_principal_actor = {
        ...(envelope.active_grant_id_by_principal_actor || {}),
        [bucketKey]: grantId,
      };
      const audit_outbox_by_id = {
        ...(envelope.audit_outbox_by_id || {}),
        [operationId]: {
          operation_id: operationId,
          record_kind: 'grant',
          record_id: grantId,
          sequence: bumped.outboxEntry.sequence,
          prior_audit_event_hash: priorHash,
          created_at: issuedAt,
        },
      };
      buckets[bucketKey] = { renew_at_ms: [...recent, nowMs] };

      const next = {
        ...envelope,
        grants_by_id,
        grant_id_by_bearer_hash,
        active_grant_id_by_principal_actor,
        audit_outbox_by_id,
        rate_buckets_by_principal_actor: buckets,
      };

      return {
        ok: true,
        envelope: next,
        result: {
          payload: {
            schema: DELEGATION_GRANT_MINT_SCHEMA,
            grant: grantForClient(grant),
            bearer,
            expires_at: expiresAt,
          },
        },
      };
    });
  }

  /**
   * @param {{
   *   uid: string,
   *   bearer: string,
   *   actorId: string,
   *   visitHandle: string,
   * }} input
   */
  async function validateAndConsume(input) {
    const actor = typeof input.actorId === 'string' ? input.actorId.trim() : '';
    const bearer = typeof input.bearer === 'string' ? input.bearer.trim() : '';
    const visitHandle = typeof input.visitHandle === 'string' ? input.visitHandle.trim() : '';
    if (!bearer || !actor || !visitHandle) {
      return fail(400, DELEGATION_REQUEST_INVALID, 'Invalid validation request');
    }
    if (actor !== RETAIL_ACTOR_ID) {
      return fail(403, DELEGATION_AUTHORITY_DENIED, 'Authority denied');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(visitHandle)) {
      return fail(400, DELEGATION_REQUEST_INVALID, 'Invalid visit handle');
    }
    const catalog = getTrustedCatalogIdentity(RETAIL_ACTOR_ID);
    if (!isRetailCodexIdentity(catalog)) {
      return fail(403, DELEGATION_AUTHORITY_DENIED, 'Authority denied');
    }
    if (!opts.sessionSecret) {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Session secret unavailable');
    }

    const principal = hashPrincipalRef(input.uid);
    const bearerHash = hashGrantBearer(bearer);
    const nowMs = opts.nowMs ?? Date.now();

    const mutated = await mutateEnvelope((envelope) => {
      const grantId = envelope.grant_id_by_bearer_hash?.[bearerHash];
      if (!grantId) {
        return { ok: false, status: 403, code: DELEGATION_AUTHORITY_DENIED, error: 'Authority denied' };
      }
      const grant = envelope.grants_by_id?.[grantId];
      if (!grant || !constantTimeEqualHexOrString(grant.grant_bearer_hash, bearerHash)) {
        return { ok: false, status: 403, code: DELEGATION_AUTHORITY_DENIED, error: 'Authority denied' };
      }
      if (
        grant.principal_ref !== principal ||
        grant.actor_agent_id !== actor ||
        grant.scope !== 'personal' ||
        !isGrantActiveStrict(grant, nowMs)
      ) {
        return { ok: false, status: 403, code: DELEGATION_AUTHORITY_DENIED, error: 'Authority denied' };
      }
      const consent = envelope.consents_by_id?.[grant.consent_id];
      if (
        !consent ||
        !isConsentActiveStrict(consent, nowMs) ||
        consent.principal_ref !== principal ||
        consent.delegate_agent_id !== actor ||
        consent.scope !== 'personal'
      ) {
        return { ok: false, status: 403, code: DELEGATION_AUTHORITY_DENIED, error: 'Authority denied' };
      }

      const operationId = randomBytes(16).toString('hex');
      const issuedAt = new Date(nowMs).toISOString();
      const chainKey = `grant:${grantId}`;
      const priorHash = envelope.event_chain_heads_by_record?.[chainKey] ?? null;
      let nextGrant = {
        ...grant,
        action_count: (grant.action_count || 0) + 1,
      };
      const bumped = bumpRecordAudit(nextGrant, operationId, priorHash);
      nextGrant = bumped.record;

      if (Object.keys(envelope.audit_outbox_by_id || {}).length >= MAX_AUDIT_OUTBOX) {
        return {
          ok: false,
          status: 507,
          code: DELEGATION_AUTHORITY_CAPACITY,
          error: 'Audit outbox full',
        };
      }

      const grants_by_id = { ...(envelope.grants_by_id || {}), [grantId]: nextGrant };
      const audit_outbox_by_id = {
        ...(envelope.audit_outbox_by_id || {}),
        [operationId]: {
          operation_id: operationId,
          record_kind: 'grant',
          record_id: grantId,
          sequence: bumped.outboxEntry.sequence,
          prior_audit_event_hash: priorHash,
          created_at: issuedAt,
        },
      };

      return {
        ok: true,
        envelope: { ...envelope, grants_by_id, audit_outbox_by_id },
        result: { consumed: true },
      };
    });

    if (!mutated.ok) return mutated;

    const subjects = buildAuthoritySubjects({
      sessionSecret: opts.sessionSecret,
      sessionSecretPrevious: opts.sessionSecretPrevious ?? null,
      uid: input.uid,
      vaultId,
      actorId: actor,
    });

    return {
      ok: true,
      payload: {
        schema: DELEGATION_VALIDATION_SCHEMA,
        authority_subjects: subjects,
      },
    };
  }

  /**
   * @param {string} uid
   * @param {string} consentId
   */
  async function revokeConsent(uid, consentId) {
    const id = typeof consentId === 'string' ? consentId.trim() : '';
    if (!id) return fail(400, DELEGATION_REQUEST_INVALID, 'consent_id required');
    const principal = hashPrincipalRef(uid);
    const nowMs = opts.nowMs ?? Date.now();
    const issuedAt = new Date(nowMs).toISOString();
    return mutateEnvelope((envelope) => {
      const consent = envelope.consents_by_id?.[id];
      if (!consent) return { ok: false, status: 404, code: DELEGATION_REQUEST_INVALID, error: 'unknown consent' };
      if (consent.principal_ref !== principal) {
        return { ok: false, status: 403, code: DELEGATION_HELPER_ACTOR_DENIED, error: 'Consent principal mismatch' };
      }
      if (consent.revoked_at) {
        return { ok: true, envelope, result: { payload: { schema: DELEGATION_ERROR_SCHEMA, code: 'already_revoked' } } };
      }
      const operationId = randomBytes(16).toString('hex');
      const priorHash = envelope.event_chain_heads_by_record?.[`consent:${id}`] ?? null;
      const bumped = bumpRecordAudit(
        { ...consent, revoked_at: issuedAt },
        operationId,
        priorHash,
      );
      if (Object.keys(envelope.audit_outbox_by_id || {}).length >= MAX_AUDIT_OUTBOX) {
        return { ok: false, status: 507, code: DELEGATION_AUTHORITY_CAPACITY, error: 'Audit outbox full' };
      }
      const consents_by_id = { ...envelope.consents_by_id, [id]: bumped.record };
      const audit_outbox_by_id = {
        ...(envelope.audit_outbox_by_id || {}),
        [operationId]: {
          operation_id: operationId,
          record_kind: 'consent',
          record_id: id,
          sequence: bumped.outboxEntry.sequence,
          prior_audit_event_hash: priorHash,
          created_at: issuedAt,
        },
      };
      return {
        ok: true,
        envelope: rebuildNewestActiveConsentIndex({ ...envelope, consents_by_id, audit_outbox_by_id }, nowMs),
        result: { payload: { revoked: true, consent_id: id } },
      };
    });
  }

  /**
   * Privileged grant revoke (operator / admin path).
   *
   * @param {string} _privilegedActor
   * @param {string} grantId
   */
  async function revokeGrant(_privilegedActor, grantId) {
    const id = typeof grantId === 'string' ? grantId.trim() : '';
    if (!id) return fail(400, DELEGATION_REQUEST_INVALID, 'grant_id required');
    const nowMs = opts.nowMs ?? Date.now();
    const issuedAt = new Date(nowMs).toISOString();
    return mutateEnvelope((envelope) => {
      const grant = envelope.grants_by_id?.[id];
      if (!grant) return { ok: false, status: 404, code: DELEGATION_REQUEST_INVALID, error: 'unknown grant' };
      if (grant.revoked_at) {
        return { ok: true, envelope, result: { payload: { revoked: true, grant_id: id } } };
      }
      const operationId = randomBytes(16).toString('hex');
      const priorHash = envelope.event_chain_heads_by_record?.[`grant:${id}`] ?? null;
      const bumped = bumpRecordAudit(
        { ...grant, revoked_at: issuedAt },
        operationId,
        priorHash,
      );
      if (Object.keys(envelope.audit_outbox_by_id || {}).length >= MAX_AUDIT_OUTBOX) {
        return { ok: false, status: 507, code: DELEGATION_AUTHORITY_CAPACITY, error: 'Audit outbox full' };
      }
      const grants_by_id = { ...envelope.grants_by_id, [id]: bumped.record };
      const audit_outbox_by_id = {
        ...(envelope.audit_outbox_by_id || {}),
        [operationId]: {
          operation_id: operationId,
          record_kind: 'grant',
          record_id: id,
          sequence: bumped.outboxEntry.sequence,
          prior_audit_event_hash: priorHash,
          created_at: issuedAt,
        },
      };
      const active = { ...(envelope.active_grant_id_by_principal_actor || {}) };
      const gKey = principalActorKey(grant.principal_ref, grant.actor_agent_id);
      if (active[gKey] === id) delete active[gKey];
      return {
        ok: true,
        envelope: {
          ...envelope,
          grants_by_id,
          audit_outbox_by_id,
          active_grant_id_by_principal_actor: active,
        },
        result: { payload: { revoked: true, grant_id: id } },
      };
    });
  }

  /**
   * Snapshot legacy stores into a candidate envelope (ignored until marker).
   * Does not activate production reads.
   *
   * @returns {Promise<object>}
   */
  async function createOrVerifyCandidate() {
    const existingRaw = await cas.get(candidateKey, { type: 'text' }).catch(() => null);
    if (typeof existingRaw === 'string' && existingRaw.trim()) {
      let existing;
      try {
        existing = JSON.parse(existingRaw);
      } catch {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Candidate parse error');
      }
      const iv = validateEnvelopeInternalIntegrity(existing);
      if (!iv.ok) {
        return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Mismatched candidate envelope');
      }
      return {
        ok: true,
        state: 'candidate_verified',
        lineage_id: existing.lineage_id,
        origin_snapshot_hash: existing.origin_snapshot_hash,
      };
    }

    const identities = loadIdentitiesStore(dataDir);
    const consents = loadConsentsStore(dataDir);
    const grants = loadGrantsStore(dataDir);
    const vaultIdentities = identities.vaults?.[vaultId]?.identities || [];
    const vaultConsents = consents.vaults?.[vaultId]?.consents || [];
    const vaultGrants = grants.vaults?.[vaultId]?.grants || [];

    /** @type {Record<string, object>} */
    const identities_by_id = {};
    for (const id of vaultIdentities) {
      if (!id || typeof id !== 'object') {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Malformed identity in snapshot');
      }
      if (id.agent_id === RETAIL_ACTOR_ID) {
        return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Reserved catalog id collision');
      }
      identities_by_id[id.agent_id] = { ...id };
    }

    /** @type {Record<string, object>} */
    const consents_by_id = {};
    for (const c of vaultConsents) {
      if (!c || typeof c !== 'object') {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Malformed consent in snapshot');
      }
      if (!isStrictUtcTimestamp(c.created)) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Malformed consent timestamp');
      }
      const exp = parseOptionalStrictUtc(c.expires_at);
      if (!exp.ok) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Malformed consent expiry');
      }
      consents_by_id[c.consent_id] = {
        ...c,
        audit_sequence: 0,
        last_materialized_audit_sequence: 0,
        pending_audit_count: 0,
      };
    }

    /** @type {Record<string, object>} */
    const grants_by_id = {};
    /** @type {Record<string, string>} */
    const grant_id_by_bearer_hash = {};
    /** @type {Record<string, string>} */
    const active_grant_id_by_principal_actor = {};
    const nowMs = opts.nowMs ?? Date.now();
    for (const g of vaultGrants) {
      if (!g || typeof g !== 'object') {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Malformed grant in snapshot');
      }
      if (!isStrictUtcTimestamp(g.issued_at) || !isStrictUtcTimestamp(g.expires_at)) {
        return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Malformed grant timestamp');
      }
      grants_by_id[g.grant_id] = {
        ...g,
        audit_sequence: 0,
        last_materialized_audit_sequence: 0,
        pending_audit_count: 0,
      };
      if (typeof g.grant_bearer_hash === 'string') {
        grant_id_by_bearer_hash[g.grant_bearer_hash] = g.grant_id;
      }
      if (isGrantActiveStrict(g, nowMs) && g.scope === 'personal') {
        const gKey = principalActorKey(g.principal_ref, g.actor_agent_id);
        const existingId = active_grant_id_by_principal_actor[gKey];
        if (!existingId) {
          active_grant_id_by_principal_actor[gKey] = g.grant_id;
        } else {
          const existing = grants_by_id[existingId];
          const a = Date.parse(existing?.issued_at || '') || 0;
          const b = Date.parse(g.issued_at) || 0;
          if (b >= a) active_grant_id_by_principal_actor[gKey] = g.grant_id;
        }
      }
    }

    const snapshotBody = JSON.stringify({
      identities: vaultIdentities,
      consents: vaultConsents,
      grants: vaultGrants,
    });
    const origin_snapshot_hash = `${SHA256_PREFIX}${createHash('sha256').update(snapshotBody, 'utf8').digest('hex')}`;
    const lineage_id = `lineage_${randomIdToken(12)}`;

    let envelope = {
      schema: DELEGATION_AUTHORITY_ENVELOPE_SCHEMA,
      schema_version: ENVELOPE_SCHEMA_VERSION,
      vault_id: vaultId,
      lineage_id,
      origin_snapshot_hash,
      revision: 0,
      previous_state_hash: null,
      identities_by_id,
      consents_by_id,
      newest_active_consent_id_by_principal_actor: {},
      grants_by_id,
      grant_id_by_bearer_hash,
      active_grant_id_by_principal_actor,
      rate_buckets_by_principal_actor: {},
      audit_outbox_by_id: {},
      event_chain_heads_by_record: {},
    };
    envelope = rebuildNewestActiveConsentIndex(envelope, opts.nowMs ?? Date.now());
    envelope = sealEnvelopeStateHash(envelope);

    const iv = validateEnvelopeInternalIntegrity(envelope);
    if (!iv.ok) {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, `Candidate invalid: ${iv.reason}`);
    }

    const payload = JSON.stringify(envelope);
    const write = await cas.set(candidateKey, payload, { onlyIfNew: true });
    if (!write || write.modified === false) {
      // Race: re-read and verify
      return createOrVerifyCandidate();
    }

    // Mirror candidate to local file for inspectability (still ignored by readers).
    try {
      fs.writeFileSync(
        path.join(dataDir, delegationAuthorityCandidateFileName(vaultId)),
        payload,
        'utf8',
      );
    } catch {
      /* non-fatal */
    }

    const readBack = await cas.get(candidateKey, { type: 'text' });
    if (typeof readBack !== 'string' || !readBack.trim()) {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Candidate read-back failed');
    }
    let verified;
    try {
      verified = JSON.parse(readBack);
    } catch {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Candidate read-back parse failed');
    }
    if (
      verified.origin_snapshot_hash !== origin_snapshot_hash ||
      verified.state_hash !== envelope.state_hash
    ) {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Candidate hash verification failed');
    }

    return {
      ok: true,
      state: 'candidate_created',
      lineage_id,
      origin_snapshot_hash,
      envelope_key: envelopeKey,
    };
  }

  /**
   * Activate candidate via immutable marker. Requires explicit operator authorization.
   *
   * @param {{ operatorAuthorized: boolean }} auth
   */
  async function activateMarker(auth) {
    if (!auth || auth.operatorAuthorized !== true) {
      return fail(403, DELEGATION_HELPER_ACTOR_DENIED, 'Marker activation requires operator authorization');
    }
    // Dual gate: call-site operatorAuthorized AND store option or env after Tier-3.
    // Production must never set these without explicit operator authorization.
    const storeAuthorized = opts.operatorAuthorizedMarker === true;
    const envAuthorized = process.env.RHF_AUTHORITY_MARKER_AUTHORIZED === '1';
    if (!storeAuthorized && !envAuthorized) {
      return fail(
        403,
        DELEGATION_HELPER_ACTOR_DENIED,
        'Marker activation blocked — Tier-3 authorization required (operatorAuthorizedMarker or RHF_AUTHORITY_MARKER_AUTHORIZED)',
      );
    }

    const existingMarker = await cas.get(markerKey, { type: 'text' }).catch(() => null);
    if (typeof existingMarker === 'string' && existingMarker.trim()) {
      let marker;
      try {
        marker = JSON.parse(existingMarker);
      } catch {
        return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Mismatched marker');
      }
      const mv = validateDelegationAuthorityMarker(marker, vaultId);
      if (!mv.ok) return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Mismatched marker');
      return { ok: true, state: 'marker_already_active', marker };
    }

    const candidateResult = await createOrVerifyCandidate();
    if (!candidateResult.ok) return candidateResult;

    const candidateRaw = await cas.get(candidateKey, { type: 'text' });
    if (typeof candidateRaw !== 'string' || !candidateRaw.trim()) {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Candidate missing for activation');
    }
    let candidate;
    try {
      candidate = JSON.parse(candidateRaw);
    } catch {
      return fail(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Candidate unreadable');
    }

    // Promote candidate → envelope key (onlyIfNew), then marker.
    const envWrite = await cas.set(envelopeKey, candidateRaw, { onlyIfNew: true });
    if (envWrite && envWrite.modified === false) {
      const existingEnv = await cas.get(envelopeKey, { type: 'text' });
      if (typeof existingEnv === 'string' && existingEnv.trim()) {
        let existing;
        try {
          existing = JSON.parse(existingEnv);
        } catch {
          return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Envelope conflict');
        }
        if (
          existing.lineage_id !== candidate.lineage_id ||
          existing.origin_snapshot_hash !== candidate.origin_snapshot_hash
        ) {
          return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Envelope conflict');
        }
      }
    }

    const marker = {
      schema: DELEGATION_AUTHORITY_MARKER_SCHEMA,
      vault_id: vaultId,
      envelope_key: envelopeKey,
      envelope_schema_version: MARKER_SCHEMA_VERSION,
      lineage_id: candidate.lineage_id,
      origin_snapshot_hash: candidate.origin_snapshot_hash,
    };
    const markerWrite = await cas.set(markerKey, JSON.stringify(marker), { onlyIfNew: true });
    if (!markerWrite || markerWrite.modified === false) {
      const again = await cas.get(markerKey, { type: 'text' });
      if (typeof again === 'string' && again.trim()) {
        try {
          const m = JSON.parse(again);
          if (
            m.lineage_id === marker.lineage_id &&
            m.origin_snapshot_hash === marker.origin_snapshot_hash
          ) {
            return { ok: true, state: 'marker_already_active', marker: m };
          }
        } catch {
          /* fall through */
        }
      }
      return fail(409, DELEGATION_AUTHORITY_CONFLICT, 'Marker conflict');
    }

    try {
      fs.writeFileSync(
        path.join(dataDir, delegationAuthorityMarkerFileName(vaultId)),
        JSON.stringify(marker),
        'utf8',
      );
      fs.writeFileSync(
        path.join(dataDir, path.basename(envelopeKey)),
        candidateRaw,
        'utf8',
      );
    } catch {
      /* CAS is authoritative when available */
    }

    return { ok: true, state: 'marker_activated', marker };
  }

  return {
    readHelperAccess,
    renewPersonal,
    validateAndConsume,
    revokeConsent,
    revokeGrant,
    createOrVerifyCandidate,
    activateMarker,
    readActiveEnvelope,
    mutateEnvelope,
    cas,
    envelopeKey,
    candidateKey,
    markerKey,
  };
}

/**
 * Test helper: write marker + sealed envelope into a CAS store and local files.
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   cas?: MemoryCasBlobStore,
 *   envelopeOverrides?: object,
 * }} input
 */
export async function seedActiveAuthorityEnvelope(input) {
  const cas = input.cas || new MemoryCasBlobStore();
  const vaultId = input.vaultId;
  let envelope = {
    schema: DELEGATION_AUTHORITY_ENVELOPE_SCHEMA,
    schema_version: 1,
    vault_id: vaultId,
    lineage_id: 'lineage_test_kn1',
    origin_snapshot_hash:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revision: 0,
    previous_state_hash: null,
    identities_by_id: {},
    consents_by_id: {},
    newest_active_consent_id_by_principal_actor: {},
    grants_by_id: {},
    grant_id_by_bearer_hash: {},
    active_grant_id_by_principal_actor: {},
    rate_buckets_by_principal_actor: {},
    audit_outbox_by_id: {},
    event_chain_heads_by_record: {},
    ...(input.envelopeOverrides || {}),
  };
  envelope = rebuildNewestActiveConsentIndex(envelope);
  envelope = sealEnvelopeStateHash(envelope);

  const envelopeKey = delegationAuthorityEnvelopeBlobKey(vaultId);
  const markerKey = delegationAuthorityMarkerBlobKey(vaultId);
  await cas.set(envelopeKey, JSON.stringify(envelope));
  const marker = {
    schema: DELEGATION_AUTHORITY_MARKER_SCHEMA,
    vault_id: vaultId,
    envelope_key: envelopeKey,
    envelope_schema_version: 1,
    lineage_id: envelope.lineage_id,
    origin_snapshot_hash: envelope.origin_snapshot_hash,
  };
  await cas.set(markerKey, JSON.stringify(marker));
  fs.mkdirSync(input.dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(input.dataDir, delegationAuthorityMarkerFileName(vaultId)),
    JSON.stringify(marker),
  );
  fs.writeFileSync(path.join(input.dataDir, path.basename(envelopeKey)), JSON.stringify(envelope));
  return { cas, envelope, marker };
}
