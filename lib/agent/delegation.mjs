/**
 * Agent delegation gate — identity registry, consent proposals, grant mint/revoke,
 * audit append, and delegation chain validation (Phase 7C-6).
 *
 * Canonical records: agent_identity, delegation_consent, delegation_grant,
 * delegation_audit. All gated by `DELEGATION_ENABLED` (default **off**).
 *
 * @see docs/AGENT-DELEGATION-V0-SPEC.md
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import {
  AGENT_IDENTITY_SCHEMA_V1,
  getTrustedCatalogIdentity,
  isReservedCatalogAgentId,
  listTrustedCatalogIdentities,
} from './trusted-external-provider-catalog.mjs';
import {
  DELEGATION_AUTHORITY_UNAVAILABLE,
  getEnvelopeStoredConsent,
  getEnvelopeStoredGrant,
  getEnvelopeStoredIdentity,
  resolveDelegationAuthorityReadModeSync,
} from './delegation-authority-compat.mjs';

export { AGENT_IDENTITY_SCHEMA_V1 } from './trusted-external-provider-catalog.mjs';
export {
  TRUSTED_EXTERNAL_PROVIDER_IDENTITIES,
  getTrustedCatalogIdentity,
  isReservedCatalogAgentId,
  listTrustedCatalogIdentities,
} from './trusted-external-provider-catalog.mjs';
export {
  DELEGATION_AUTHORITY_UNAVAILABLE,
  computeDelegationAuthorityStateHash,
  resolveDelegationAuthorityReadMode,
  resolveDelegationAuthorityReadModeSync,
} from './delegation-authority-compat.mjs';

export const DELEGATION_POLICY_FILE = 'hub_delegation_policy.json';
export const DELEGATION_IDENTITIES_FILE = 'hub_delegation_identities.json';
export const DELEGATION_CONSENTS_FILE = 'hub_delegation_consents.json';
export const DELEGATION_GRANTS_FILE = 'hub_delegation_grants.json';
export const DELEGATION_AUDIT_FILE = 'hub_delegation_audit.json';

export const AGENT_IDENTITY_SCHEMA = 'knowtation.agent_identity/v0';
export const DELEGATION_CONSENT_SCHEMA = 'knowtation.delegation_consent/v0';
export const DELEGATION_GRANT_SCHEMA = 'knowtation.delegation_grant/v0';
export const DELEGATION_AUDIT_SCHEMA = 'knowtation.delegation_audit/v0';
export const DELEGATION_GRANT_MINT_SCHEMA = 'knowtation.delegation_grant_mint/v0';

export const AGENT_ID_PREFIX = 'agent_';
export const CONSENT_ID_PREFIX = 'dcons_';
export const GRANT_ID_PREFIX = 'dgrnt_';
export const AUDIT_ID_PREFIX = 'daud_';
export const GRANT_BEARER_PREFIX = 'dgrnt_bearer_';

export const DEFAULT_TTL_SECONDS = 3600;
export const MAX_TTL_SECONDS = 86400;

export const DELEGATION_PROPOSAL_SOURCE = 'delegation';
export const DELEGATION_REVIEW_QUEUE = 'delegation';

/** @typedef {'personal' | 'project' | 'org'} Scope */
/** @typedef {'user_owned' | 'org_owned' | 'delegate' | 'external_provider'} AgentKind */
/** @typedef {'active' | 'suspended' | 'revoked'} IdentityStatus */
/** @typedef {'advance_step' | 'complete_task' | 'propose_outcome' | 'invoke_tool' | 'mint_subgrant' | 'external_claim' | 'external_complete' | 'external_needs_input' | 'external_boundary_stop' | 'content_unshare' | 'content_delete' | 'content_hard_delete' | 'content_export' | 'content_retention_prune'} AuditAction */
/** @typedef {'local' | 'hosted' | 'hybrid'} ExecutionLocation */

const AGENT_KINDS = new Set(['user_owned', 'org_owned', 'delegate', 'external_provider']);
const IDENTITY_STATUSES = new Set(['active', 'suspended', 'revoked']);
const SCOPES = new Set(['personal', 'project', 'org']);
const AUDIT_ACTIONS = new Set([
  'advance_step',
  'complete_task',
  'propose_outcome',
  'invoke_tool',
  'mint_subgrant',
  'external_claim',
  'external_complete',
  'external_needs_input',
  'external_boundary_stop',
  // DATA-RIGHTS-b-kn — content rights log onto this ledger (U5); do not add a second ledger.
  'content_unshare',
  'content_delete',
  'content_hard_delete',
  'content_export',
  'content_retention_prune',
]);
const EXECUTION_LOCATIONS = new Set(['local', 'hosted', 'hybrid']);

const ID_TOKEN_RE = /^[a-z0-9_]{8,48}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9._-]+)?(\+[a-zA-Z0-9._-]+)?$/;
const DELEGATION_AUTHOR_CHARSET_RE = /^[A-Za-z0-9:_@.\-]+$/;
const UID_HASH_PRINCIPAL_RE = /^uid_hash:[0-9a-f]{64}$/;

/**
 * @param {unknown} v
 * @returns {boolean|null}
 */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * @param {string} dataDir
 * @returns {object}
 */
export function readDelegationPolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, DELEGATION_POLICY_FILE);
  try {
    if (!fs.existsSync(fp)) return {};
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getDelegationEnabled(dataDir) {
  const fromEnv = envTriState(process.env.DELEGATION_ENABLED);
  if (fromEnv !== null) return fromEnv;
  const policy = readDelegationPolicyFile(dataDir);
  const d = policy.delegation;
  if (d && typeof d === 'object' && typeof d.enabled === 'boolean') {
    return d.enabled;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getDelegationPolicyForbidden(dataDir) {
  const fromEnv = envTriState(process.env.DELEGATION_POLICY_FORBIDDEN);
  if (fromEnv !== null) return fromEnv;
  const policy = readDelegationPolicyFile(dataDir);
  const d = policy.delegation;
  if (d && typeof d === 'object' && typeof d.forbidden === 'boolean') {
    return d.forbidden;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {{ defaultTtlSeconds: number, maxTtlSeconds: number }}
 */
export function readVaultDelegationPolicy(dataDir) {
  const policy = readDelegationPolicyFile(dataDir);
  const d = policy.delegation && typeof policy.delegation === 'object' ? policy.delegation : {};
  const defaultTtl =
    typeof d.default_ttl_seconds === 'number' && d.default_ttl_seconds > 0
      ? d.default_ttl_seconds
      : DEFAULT_TTL_SECONDS;
  // SEC-KN-5 / P12: never let a vault policy file raise the ceiling above SD-10's 24h cap.
  const maxTtlRaw =
    typeof d.max_ttl_seconds === 'number' && d.max_ttl_seconds > 0
      ? d.max_ttl_seconds
      : MAX_TTL_SECONDS;
  const maxTtl = Math.min(maxTtlRaw, MAX_TTL_SECONDS);
  return { defaultTtlSeconds: defaultTtl, maxTtlSeconds: maxTtl };
}

/**
 * Derive hashed principal ref from verified session user id — never accept client principal.
 *
 * @param {string} userId
 * @returns {string}
 */
export function hashPrincipalRef(userId) {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';
  const hash = createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return `uid_hash:${hash}`;
}

/**
 * @param {Scope} a
 * @param {Scope} b
 * @returns {Scope|null}
 */
export function intersectScope(a, b) {
  const order = { personal: 0, project: 1, org: 2 };
  const oa = order[a];
  const ob = order[b];
  if (oa === undefined || ob === undefined) return null;
  return oa <= ob ? a : b;
}

/**
 * @param {Scope} ceiling
 * @param {Scope} requested
 * @returns {Scope|null}
 */
export function effectiveScope(ceiling, requested) {
  return intersectScope(ceiling, requested);
}

/**
 * @param {string} bearer
 * @returns {string}
 */
export function hashGrantBearer(bearer) {
  return createHash('sha256').update(bearer, 'utf8').digest('hex');
}

/**
 * @param {string} prefix
 * @param {number} [byteLen]
 * @returns {string}
 */
function randomToken(prefix, byteLen = 16) {
  const token = randomBytes(byteLen)
    .toString('base64url')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 24);
  return prefix + (token.length >= 8 ? token : token.padEnd(8, '0'));
}

/**
 * @param {string} id
 * @param {string} prefix
 * @returns {boolean}
 */
function isValidId(id, prefix) {
  if (typeof id !== 'string' || !id.startsWith(prefix)) return false;
  const token = id.slice(prefix.length);
  return ID_TOKEN_RE.test(token);
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
function isValidOwnerRef(ref) {
  if (typeof ref !== 'string') return false;
  if (ref.startsWith('uid_hash:')) {
    return /^uid_hash:[0-9a-f]{64}$/.test(ref);
  }
  if (ref.startsWith('org_ref:')) {
    return ref.length > 'org_ref:'.length;
  }
  return false;
}

/**
 * @param {object} record
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAgentIdentityRecord(record) {
  if (!record || typeof record !== 'object') return { ok: false, error: 'invalid record' };
  if (record.schema !== AGENT_IDENTITY_SCHEMA && record.schema !== AGENT_IDENTITY_SCHEMA_V1) {
    return { ok: false, error: 'schema mismatch' };
  }
  if (!isValidId(record.agent_id, AGENT_ID_PREFIX)) return { ok: false, error: 'invalid agent_id' };
  if (!AGENT_KINDS.has(record.kind)) return { ok: false, error: 'invalid kind' };
  if (!isValidOwnerRef(record.owner_ref)) return { ok: false, error: 'invalid owner_ref' };
  if (record.schema === AGENT_IDENTITY_SCHEMA_V1) {
    if (record.kind === 'external_provider') {
      if (typeof record.provider !== 'string' || !record.provider.trim()) {
        return { ok: false, error: 'provider required for external_provider' };
      }
      if (record.registry_scope !== 'global' && record.registry_scope !== 'vault') {
        return { ok: false, error: 'invalid registry_scope' };
      }
    } else if (record.provider != null) {
      return { ok: false, error: 'provider forbidden for non-external_provider' };
    }
    if (record.registry_scope === 'global') {
      if (record.vault_id != null) return { ok: false, error: 'global identity vault_id must be null' };
    } else if (typeof record.vault_id !== 'string' || !record.vault_id.trim()) {
      return { ok: false, error: 'invalid vault_id' };
    }
  } else if (typeof record.vault_id !== 'string' || !record.vault_id.trim()) {
    return { ok: false, error: 'invalid vault_id' };
  }
  if (!SCOPES.has(record.scope_ceiling)) return { ok: false, error: 'invalid scope_ceiling' };
  if (!IDENTITY_STATUSES.has(record.status)) return { ok: false, error: 'invalid status' };
  if (typeof record.created !== 'string' || typeof record.updated !== 'string') {
    return { ok: false, error: 'invalid timestamps' };
  }
  return { ok: true };
}

/**
 * @param {object} record
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateConsentRecord(record) {
  if (!record || typeof record !== 'object') return { ok: false, error: 'invalid record' };
  if (record.schema !== DELEGATION_CONSENT_SCHEMA) return { ok: false, error: 'schema mismatch' };
  if (!isValidId(record.consent_id, CONSENT_ID_PREFIX)) return { ok: false, error: 'invalid consent_id' };
  if (!isValidOwnerRef(record.principal_ref)) return { ok: false, error: 'invalid principal_ref' };
  if (!isValidId(record.delegate_agent_id, AGENT_ID_PREFIX)) {
    return { ok: false, error: 'invalid delegate_agent_id' };
  }
  if (!SCOPES.has(record.scope)) return { ok: false, error: 'invalid scope' };
  if (record.scope === 'project' || record.scope === 'org') {
    if (typeof record.workspace_id !== 'string' || !record.workspace_id.trim()) {
      return { ok: false, error: 'workspace_id required for project/org scope' };
    }
  }
  if (record.revoked_at !== null && typeof record.revoked_at !== 'string') {
    return { ok: false, error: 'invalid revoked_at' };
  }
  if (typeof record.evidence_ref !== 'string' || !record.evidence_ref.startsWith('proposal:')) {
    return { ok: false, error: 'invalid evidence_ref' };
  }
  if (typeof record.created !== 'string') return { ok: false, error: 'invalid created' };
  return { ok: true };
}

/**
 * @param {object} record
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateGrantRecord(record) {
  if (!record || typeof record !== 'object') return { ok: false, error: 'invalid record' };
  if (record.schema !== DELEGATION_GRANT_SCHEMA) return { ok: false, error: 'schema mismatch' };
  if (!isValidId(record.grant_id, GRANT_ID_PREFIX)) return { ok: false, error: 'invalid grant_id' };
  if (!isValidId(record.consent_id, CONSENT_ID_PREFIX)) return { ok: false, error: 'invalid consent_id' };
  if (!isValidId(record.actor_agent_id, AGENT_ID_PREFIX)) {
    return { ok: false, error: 'invalid actor_agent_id' };
  }
  if (!isValidOwnerRef(record.principal_ref)) return { ok: false, error: 'invalid principal_ref' };
  if (!SCOPES.has(record.scope)) return { ok: false, error: 'invalid scope' };
  if (record.flow_id && !record.flow_version) return { ok: false, error: 'flow_version required' };
  if (record.flow_version && !SEMVER_RE.test(record.flow_version)) {
    return { ok: false, error: 'invalid flow_version' };
  }
  if (record.revoked_at !== null && typeof record.revoked_at !== 'string') {
    return { ok: false, error: 'invalid revoked_at' };
  }
  if (typeof record.action_count !== 'number' || record.action_count < 0) {
    return { ok: false, error: 'invalid action_count' };
  }
  if (typeof record.expires_at !== 'string' || typeof record.issued_at !== 'string') {
    return { ok: false, error: 'invalid timestamps' };
  }
  return { ok: true };
}

/**
 * @param {object} record
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAuditRecord(record) {
  if (!record || typeof record !== 'object') return { ok: false, error: 'invalid record' };
  if (record.schema !== DELEGATION_AUDIT_SCHEMA) return { ok: false, error: 'schema mismatch' };
  if (!isValidId(record.audit_id, AUDIT_ID_PREFIX)) return { ok: false, error: 'invalid audit_id' };
  // DATA-RIGHTS owner-self sentinels are valid grant/actor ids on this ledger (U5).
  const ownerSelfGrant = record.grant_id === 'dgrnt_owner_self';
  const ownerSelfAgent = record.actor_agent_id === 'agent_owner_self';
  if (!ownerSelfGrant && !isValidId(record.grant_id, GRANT_ID_PREFIX)) {
    return { ok: false, error: 'invalid grant_id' };
  }
  if (!ownerSelfAgent && !isValidId(record.actor_agent_id, AGENT_ID_PREFIX)) {
    return { ok: false, error: 'invalid actor_agent_id' };
  }
  if (!isValidOwnerRef(record.principal_ref)) return { ok: false, error: 'invalid principal_ref' };
  if (!AUDIT_ACTIONS.has(record.action)) return { ok: false, error: 'invalid action' };
  if (!Array.isArray(record.evidence_refs)) return { ok: false, error: 'invalid evidence_refs' };
  if (typeof record.occurred_at !== 'string') return { ok: false, error: 'invalid occurred_at' };
  if (
    record.execution_location != null &&
    !EXECUTION_LOCATIONS.has(record.execution_location)
  ) {
    return { ok: false, error: 'invalid execution_location' };
  }
  return { ok: true };
}

/**
 * @param {object} consent
 * @returns {'active' | 'revoked' | 'expired'}
 */
export function resolveConsentStatus(consent) {
  if (consent.revoked_at) return 'revoked';
  if (consent.expires_at) {
    const exp = Date.parse(consent.expires_at);
    if (Number.isFinite(exp) && Date.now() > exp) return 'expired';
  }
  return 'active';
}

/**
 * @param {object} grant
 * @returns {'active' | 'revoked' | 'expired' | 'exhausted'}
 */
export function resolveGrantStatus(grant) {
  if (grant.revoked_at) return 'revoked';
  const exp = Date.parse(grant.expires_at);
  if (!Number.isFinite(exp) || Date.now() > exp) return 'expired';
  if (
    typeof grant.max_actions === 'number' &&
    grant.max_actions > 0 &&
    grant.action_count >= grant.max_actions
  ) {
    return 'exhausted';
  }
  return 'active';
}

/**
 * Strip internal fields from stored grant for client responses.
 * Omits bearer hash and authority-envelope audit counters — Scooling mint/list
 * schemas are strict and map unrecognized keys to hub_delegation_malformed
 * (false "empty or not readable" on Enable helper / Home Start).
 *
 * @param {object} stored
 * @returns {object}
 */
export function grantForClient(stored) {
  const {
    grant_bearer_hash: _b,
    audit_sequence: _as,
    pending_audit_count: _pac,
    last_materialized_audit_sequence: _lmas,
    ...grant
  } = stored;
  return grant;
}

/**
 * @param {string} dataDir
 * @param {string} filename
 * @returns {{ vaults: Record<string, object> }}
 */
function loadVaultStore(dataDir, filename) {
  const fp = path.join(dataDir, filename);
  if (!fs.existsSync(fp)) return { vaults: {} };
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return { vaults: {} };
    return { vaults: j.vaults && typeof j.vaults === 'object' ? j.vaults : {} };
  } catch {
    return { vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {string} filename
 * @param {{ vaults: Record<string, object> }} store
 */
function saveVaultStore(dataDir, filename, store) {
  const fp = path.join(dataDir, filename);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { identities: object[] }> }}
 */
export function loadIdentitiesStore(dataDir) {
  const raw = loadVaultStore(dataDir, DELEGATION_IDENTITIES_FILE);
  for (const v of Object.values(raw.vaults)) {
    if (!Array.isArray(v.identities)) v.identities = [];
  }
  return /** @type {{ vaults: Record<string, { identities: object[] }> }} */ (raw);
}

/**
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { identities: object[] }> }} store
 */
export function saveIdentitiesStore(dataDir, store) {
  saveVaultStore(dataDir, DELEGATION_IDENTITIES_FILE, store);
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { consents: object[] }> }}
 */
export function loadConsentsStore(dataDir) {
  const raw = loadVaultStore(dataDir, DELEGATION_CONSENTS_FILE);
  for (const v of Object.values(raw.vaults)) {
    if (!Array.isArray(v.consents)) v.consents = [];
  }
  return /** @type {{ vaults: Record<string, { consents: object[] }> }} */ (raw);
}

/**
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { consents: object[] }> }} store
 */
export function saveConsentsStore(dataDir, store) {
  saveVaultStore(dataDir, DELEGATION_CONSENTS_FILE, store);
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { grants: object[] }> }}
 */
export function loadGrantsStore(dataDir) {
  const raw = loadVaultStore(dataDir, DELEGATION_GRANTS_FILE);
  for (const v of Object.values(raw.vaults)) {
    if (!Array.isArray(v.grants)) v.grants = [];
  }
  return /** @type {{ vaults: Record<string, { grants: object[] }> }} */ (raw);
}

/**
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { grants: object[] }> }} store
 */
export function saveGrantsStore(dataDir, store) {
  saveVaultStore(dataDir, DELEGATION_GRANTS_FILE, store);
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { audits: object[] }> }}
 */
export function loadAuditStore(dataDir) {
  const raw = loadVaultStore(dataDir, DELEGATION_AUDIT_FILE);
  for (const v of Object.values(raw.vaults)) {
    if (!Array.isArray(v.audits)) v.audits = [];
  }
  return /** @type {{ vaults: Record<string, { audits: object[] }> }} */ (raw);
}

/**
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { audits: object[] }> }} store
 */
export function saveAuditStore(dataDir, store) {
  saveVaultStore(dataDir, DELEGATION_AUDIT_FILE, store);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {{
 *   ok: true,
 *   mode: 'legacy' | 'envelope',
 *   envelope?: object,
 * } | { ok: false, status: number, code: string, error: string }}
 */
export function resolveDelegationReadContext(dataDir, vaultId) {
  const resolved = resolveDelegationAuthorityReadModeSync({ dataDir, vaultId });
  if (!resolved.ok) {
    return refuse(503, DELEGATION_AUTHORITY_UNAVAILABLE, 'Delegation authority unavailable');
  }
  if (resolved.mode === 'legacy') {
    return { ok: true, mode: 'legacy' };
  }
  return { ok: true, mode: 'envelope', envelope: resolved.envelope };
}

/**
 * Vault-local identity lookup — excludes immutable catalog entries.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} agentId
 * @returns {object|null}
 */
function getVaultLocalAgentIdentity(dataDir, vaultId, agentId) {
  if (isReservedCatalogAgentId(agentId)) return null;
  const readCtx = resolveDelegationReadContext(dataDir, vaultId);
  if (!readCtx.ok) return null;
  if (readCtx.mode === 'envelope') {
    return getEnvelopeStoredIdentity(readCtx.envelope, agentId);
  }
  const store = loadIdentitiesStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;
  return vault.identities.find((i) => i.agent_id === agentId) ?? null;
}

/**
 * Reserved catalog identities resolve globally first; vault records cannot shadow them.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} agentId
 * @returns {object|null}
 */
export function getAgentIdentity(dataDir, vaultId, agentId) {
  const catalog = getTrustedCatalogIdentity(agentId);
  if (catalog) return catalog;

  const readCtx = resolveDelegationReadContext(dataDir, vaultId);
  if (!readCtx.ok) return null;

  if (isReservedCatalogAgentId(agentId)) {
    return null;
  }

  if (readCtx.mode === 'envelope') {
    return getEnvelopeStoredIdentity(readCtx.envelope, agentId);
  }

  const store = loadIdentitiesStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;
  return vault.identities.find((i) => i.agent_id === agentId) ?? null;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} consentId
 * @returns {object|null}
 */
export function getConsent(dataDir, vaultId, consentId) {
  const readCtx = resolveDelegationReadContext(dataDir, vaultId);
  if (!readCtx.ok) return null;
  if (readCtx.mode === 'envelope') {
    return getEnvelopeStoredConsent(readCtx.envelope, consentId);
  }
  const store = loadConsentsStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;
  return vault.consents.find((c) => c.consent_id === consentId) ?? null;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} grantId
 * @returns {object|null}
 */
export function getGrant(dataDir, vaultId, grantId) {
  const readCtx = resolveDelegationReadContext(dataDir, vaultId);
  if (!readCtx.ok) return null;
  if (readCtx.mode === 'envelope') {
    return getEnvelopeStoredGrant(readCtx.envelope, grantId);
  }
  const store = loadGrantsStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;
  return vault.grants.find((g) => g.grant_id === grantId) ?? null;
}

/**
 * @param {object} ctx
 * @returns {{ ok: false, status: number, error: string, code: string }}
 */
function refuse(status, code, error) {
  return { ok: false, status, error, code };
}

/**
 * Gate check shared by mutating handlers.
 *
 * @param {string} dataDir
 * @returns {{ ok: true } | { ok: false, status: number, error: string, code: string }}
 */
function checkDelegationGate(dataDir) {
  if (getDelegationPolicyForbidden(dataDir)) {
    return refuse(403, 'DELEGATION_POLICY_FORBIDDEN', 'Delegation forbidden by policy');
  }
  if (!getDelegationEnabled(dataDir)) {
    return refuse(403, 'DELEGATION_DISABLED', 'Delegation gate is disabled');
  }
  return { ok: true };
}

/**
 * @param {string[]} allowlist
 * @param {string} value
 * @returns {boolean}
 */
function allowlistPermits(allowlist, value) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  return allowlist.includes(value);
}

/**
 * Validate delegation chain reconstructability per spec §2.
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   actorAgentId: string,
 *   principalRef: string,
 *   grantId?: string,
 *   taskRef?: string,
 *   runRef?: string,
 *   flowId?: string,
 *   flowVersion?: string,
 *   requireGrant?: boolean,
 * }} input
 * @returns {{ ok: true, grant?: object, identity: object, consent?: object } | { ok: false, status: number, code: string }}
 */
export function validateChain(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return { ok: false, status: gate.status, code: gate.code };

  const readCtx = resolveDelegationReadContext(input.dataDir, input.vaultId);
  if (!readCtx.ok) return { ok: false, status: readCtx.status, code: readCtx.code };

  const actorId = typeof input.actorAgentId === 'string' ? input.actorAgentId.trim() : '';
  const principalRef =
    typeof input.principalRef === 'string' ? input.principalRef.trim() : '';
  if (!actorId || !principalRef) {
    return { ok: false, status: 403, code: 'DELEGATION_CHAIN_INVALID' };
  }

  const identity = getAgentIdentity(input.dataDir, input.vaultId, actorId);
  if (!identity || identity.status !== 'active') {
    return { ok: false, status: 403, code: 'DELEGATION_IDENTITY_DENIED' };
  }

  const actorIsOwner =
    identity.kind === 'user_owned' && identity.owner_ref === principalRef;
  const grantRequired =
    input.requireGrant === true || (!actorIsOwner && identity.kind !== 'user_owned');

  if (!grantRequired && actorIsOwner) {
    return { ok: true, identity };
  }

  const grantId = typeof input.grantId === 'string' ? input.grantId.trim() : '';
  if (!grantId) {
    return { ok: false, status: 403, code: 'DELEGATION_CONSENT_REQUIRED' };
  }

  const stored = getGrant(input.dataDir, input.vaultId, grantId);
  if (!stored) {
    return { ok: false, status: 404, code: 'unknown_grant' };
  }

  const grantStatus = resolveGrantStatus(stored);
  if (grantStatus === 'revoked') {
    return { ok: false, status: 403, code: 'DELEGATION_GRANT_REVOKED' };
  }
  if (grantStatus === 'expired') {
    return { ok: false, status: 403, code: 'DELEGATION_GRANT_EXPIRED' };
  }
  if (grantStatus === 'exhausted') {
    return { ok: false, status: 403, code: 'DELEGATION_GRANT_EXHAUSTED' };
  }

  if (stored.actor_agent_id !== actorId) {
    return { ok: false, status: 403, code: 'DELEGATION_ACTOR_MISMATCH' };
  }
  if (stored.principal_ref !== principalRef) {
    return { ok: false, status: 403, code: 'DELEGATION_PRINCIPAL_MISMATCH' };
  }

  const consent = getConsent(input.dataDir, input.vaultId, stored.consent_id);
  if (!consent) {
    return { ok: false, status: 403, code: 'DELEGATION_CHAIN_INVALID' };
  }
  const consentStatus = resolveConsentStatus(consent);
  if (consentStatus === 'revoked') {
    return { ok: false, status: 403, code: 'DELEGATION_CONSENT_REVOKED' };
  }
  if (consentStatus === 'expired') {
    return { ok: false, status: 403, code: 'DELEGATION_CONSENT_EXPIRED' };
  }

  const effective = effectiveScope(identity.scope_ceiling, stored.scope);
  if (!effective || effective !== stored.scope) {
    return { ok: false, status: 403, code: 'DELEGATION_IDENTITY_SCOPE_DENIED' };
  }

  if (input.taskRef && stored.task_ref && stored.task_ref !== input.taskRef.trim()) {
    return { ok: false, status: 403, code: 'DELEGATION_TASK_DENIED' };
  }
  if (input.runRef && stored.run_ref && stored.run_ref !== input.runRef.trim()) {
    return { ok: false, status: 403, code: 'DELEGATION_CHAIN_INVALID' };
  }
  if (input.flowId && stored.flow_id && stored.flow_id !== input.flowId.trim()) {
    return { ok: false, status: 403, code: 'DELEGATION_GRANT_FLOW_MISMATCH' };
  }
  if (
    input.flowVersion &&
    stored.flow_version &&
    stored.flow_version !== input.flowVersion.trim()
  ) {
    return { ok: false, status: 403, code: 'DELEGATION_GRANT_FLOW_MISMATCH' };
  }

  return { ok: true, grant: grantForClient(stored), identity, consent };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   userId: string,
 *   kind: AgentKind,
 *   agentId?: string,
 *   label?: string,
 *   scopeCeiling?: Scope,
 *   createProposal: (dataDir: string, input: object) => object | Promise<object>,
 * }} input
 */
export async function handleAgentIdentityRegisterProposeRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const principalRef = hashPrincipalRef(input.userId);
  const kind = input.kind;
  if (!AGENT_KINDS.has(kind)) {
    return refuse(400, 'BAD_REQUEST', 'kind must be user_owned, org_owned, or delegate');
  }

  const agentId =
    typeof input.agentId === 'string' && input.agentId.trim()
      ? input.agentId.trim()
      : randomToken(AGENT_ID_PREFIX);
  if (!isValidId(agentId, AGENT_ID_PREFIX)) {
    return refuse(400, 'BAD_REQUEST', 'agent_id format invalid');
  }
  if (isReservedCatalogAgentId(agentId)) {
    return refuse(409, 'AGENT_IDENTITY_RESERVED', 'Agent id reserved by trusted catalog');
  }

  const scopeCeiling = input.scopeCeiling ?? 'personal';
  if (!SCOPES.has(scopeCeiling)) {
    return refuse(400, 'BAD_REQUEST', 'invalid scope_ceiling');
  }

  const ownerRef = principalRef;
  if (!isValidOwnerRef(ownerRef)) {
    return refuse(400, 'BAD_REQUEST', 'invalid owner_ref');
  }

  const now = new Date().toISOString();
  const identityPayload = {
    schema: AGENT_IDENTITY_SCHEMA,
    agent_id: agentId,
    kind,
    owner_ref: ownerRef,
    vault_id: input.vaultId,
    scope_ceiling: scopeCeiling,
    label: typeof input.label === 'string' ? input.label.slice(0, 256) : undefined,
    status: 'active',
    created: now,
    updated: now,
  };

  const validation = validateAgentIdentityRecord(identityPayload);
  if (!validation.ok) {
    return refuse(400, 'BAD_REQUEST', validation.error);
  }

  const proposal = await Promise.resolve(
    input.createProposal(input.dataDir, {
      path: `meta/agents/${agentId.replace(/^agent_/, '')}.md`,
      body: JSON.stringify(identityPayload, null, 2),
      frontmatter: { agent_id: agentId, kind },
      intent: 'agent_identity_register',
      source: DELEGATION_PROPOSAL_SOURCE,
      vault_id: input.vaultId,
      proposed_by: input.userId?.trim() || undefined,
      review_queue: DELEGATION_REVIEW_QUEUE,
      delegation_meta: { record_kind: 'agent_identity', agent_id: agentId },
    }),
  );

  return {
    ok: true,
    payload: {
      schema: 'knowtation.delegation_proposal/v0',
      proposal_id: proposal.proposal_id,
      intent: 'agent_identity_register',
      agent_id: agentId,
    },
  };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   userId: string,
 *   delegateAgentId: string,
 *   scope: Scope,
 *   workspaceId?: string,
 *   allowedFlowIds?: string[],
 *   allowedTaskKinds?: string[],
 *   allowedTaskIds?: string[],
 *   expiresAt?: string,
 *   createProposal: (dataDir: string, input: object) => object | Promise<object>,
 * }} input
 */
export async function handleDelegationConsentProposeRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const principalRef = hashPrincipalRef(input.userId);
  const delegateAgentId =
    typeof input.delegateAgentId === 'string' ? input.delegateAgentId.trim() : '';
  if (!isValidId(delegateAgentId, AGENT_ID_PREFIX)) {
    return refuse(400, 'BAD_REQUEST', 'delegate_agent_id required');
  }

  const identity = getAgentIdentity(input.dataDir, input.vaultId, delegateAgentId);
  if (!identity || identity.status !== 'active') {
    return refuse(403, 'DELEGATION_IDENTITY_DENIED', 'Delegate agent not found or inactive');
  }

  const scope = input.scope;
  if (!SCOPES.has(scope)) {
    return refuse(400, 'BAD_REQUEST', 'invalid scope');
  }
  const effective = effectiveScope(identity.scope_ceiling, scope);
  if (!effective || effective !== scope) {
    return refuse(403, 'DELEGATION_IDENTITY_SCOPE_DENIED', 'Scope exceeds agent ceiling');
  }

  if ((scope === 'project' || scope === 'org') && !input.workspaceId?.trim()) {
    return refuse(400, 'BAD_REQUEST', 'workspace_id required for project/org scope');
  }

  const consentId = randomToken(CONSENT_ID_PREFIX);
  const now = new Date().toISOString();
  const consentPayload = {
    schema: DELEGATION_CONSENT_SCHEMA,
    consent_id: consentId,
    principal_ref: principalRef,
    delegate_agent_id: delegateAgentId,
    scope,
    workspace_id: input.workspaceId?.trim() || undefined,
    allowed_flow_ids: input.allowedFlowIds?.length ? [...input.allowedFlowIds] : undefined,
    allowed_task_kinds: input.allowedTaskKinds?.length ? [...input.allowedTaskKinds] : undefined,
    allowed_task_ids: input.allowedTaskIds?.length ? [...input.allowedTaskIds] : undefined,
    expires_at: input.expiresAt || undefined,
    revoked_at: null,
    evidence_ref: 'proposal:pending',
    created: now,
  };

  const proposal = await Promise.resolve(
    input.createProposal(input.dataDir, {
      path: `meta/delegation/consents/${consentId.replace(/^dcons_/, '')}.md`,
      body: JSON.stringify(consentPayload, null, 2),
      frontmatter: { consent_id: consentId, delegate_agent_id: delegateAgentId },
      intent: 'delegation_consent_create',
      source: DELEGATION_PROPOSAL_SOURCE,
      vault_id: input.vaultId,
      proposed_by: input.userId?.trim() || undefined,
      review_queue: DELEGATION_REVIEW_QUEUE,
      delegation_meta: { record_kind: 'delegation_consent', consent_id: consentId },
    }),
  );

  consentPayload.evidence_ref = `proposal:${proposal.proposal_id}`;

  return {
    ok: true,
    payload: {
      schema: 'knowtation.delegation_proposal/v0',
      proposal_id: proposal.proposal_id,
      intent: 'delegation_consent_create',
      consent_id: consentId,
      consent_preview: consentPayload,
    },
  };
}

/**
 * @param {string} dataDir
 * @param {object} proposal
 * @param {{ author: string }} context — server-recorded proposal author; REQUIRED
 * @returns {{ ok: true, vaultId: string, recordKind: string, record: object } | { ok: false, status: number, error: string, code: string }}
 */
export function precheckApprovedDelegationProposal(dataDir, proposal, context) {
  const gate = checkDelegationGate(dataDir);
  if (!gate.ok) return gate;

  if (proposal.source !== DELEGATION_PROPOSAL_SOURCE) {
    return refuse(400, 'BAD_REQUEST', 'Not a delegation proposal');
  }
  const meta = proposal.delegation_meta;
  if (!meta || typeof meta !== 'object' || typeof meta.record_kind !== 'string') {
    return refuse(400, 'BAD_REQUEST', 'Missing delegation_meta');
  }

  let record;
  try {
    record = JSON.parse(proposal.body ?? '{}');
  } catch {
    return refuse(400, 'BAD_REQUEST', 'Proposal body is not valid JSON');
  }

  const vaultId =
    typeof proposal.vault_id === 'string' && proposal.vault_id.trim()
      ? proposal.vault_id.trim()
      : 'default';

  if (!context || typeof context !== 'object') {
    return refuse(403, 'DELEGATION_AUTHOR_UNVERIFIED', 'Proposal author unverified');
  }
  if (proposal._knowtation_backup_json_unparseable) {
    return refuse(403, 'DELEGATION_AUTHOR_UNVERIFIED', 'Proposal author unverified');
  }
  const author = typeof context.author === 'string' ? context.author.trim() : '';
  if (!author) {
    return refuse(403, 'DELEGATION_AUTHOR_UNVERIFIED', 'Proposal author unverified');
  }
  if (author.length > 128) {
    return refuse(403, 'DELEGATION_AUTHOR_UNVERIFIED', 'Proposal author unverified');
  }
  if (!DELEGATION_AUTHOR_CHARSET_RE.test(author)) {
    return refuse(403, 'DELEGATION_AUTHOR_UNVERIFIED', 'Proposal author unverified');
  }

  const derived = hashPrincipalRef(author);

  const bodyPrincipalRef =
    typeof record.principal_ref === 'string' ? record.principal_ref.trim() : '';
  const bodyOwnerRef = typeof record.owner_ref === 'string' ? record.owner_ref.trim() : '';
  // R5 is checked on both refs for every record kind, matching the frozen wording
  // ("the body's principal_ref or owner_ref"). Scoping each ref to its own kind would
  // be behaviourally equivalent today only because the per-kind validators ignore the
  // other field; checking both keeps the refusal independent of that coupling.
  if (bodyPrincipalRef.startsWith('org_ref:') || bodyOwnerRef.startsWith('org_ref:')) {
    return refuse(403, 'DELEGATION_ORG_REF_UNSUPPORTED', 'org_ref authority refs not supported in v0');
  }

  if (meta.record_kind === 'delegation_consent') {
    if (bodyPrincipalRef && bodyPrincipalRef !== derived) {
      return refuse(
        403,
        'DELEGATION_PRINCIPAL_REBIND_MISMATCH',
        'principal_ref does not match proposal author',
      );
    }
    record.principal_ref = derived;
  } else if (meta.record_kind === 'agent_identity') {
    if (bodyOwnerRef && bodyOwnerRef !== derived) {
      return refuse(
        403,
        'DELEGATION_OWNER_REBIND_MISMATCH',
        'owner_ref does not match proposal author',
      );
    }
    record.owner_ref = derived;
  }

  if (meta.record_kind === 'agent_identity') {
    if (isReservedCatalogAgentId(record.agent_id)) {
      return refuse(409, 'AGENT_IDENTITY_RESERVED', 'Agent id reserved by trusted catalog');
    }
    const v = validateAgentIdentityRecord(record);
    if (!v.ok) return refuse(400, 'BAD_REQUEST', v.error);
    const existing = getVaultLocalAgentIdentity(dataDir, vaultId, record.agent_id);
    if (existing) {
      return refuse(409, 'CONFLICT', 'Agent identity already registered');
    }
  } else if (meta.record_kind === 'delegation_consent') {
    const v = validateConsentRecord(record);
    if (!v.ok) return refuse(400, 'BAD_REQUEST', v.error);
    record.evidence_ref = `proposal:${proposal.proposal_id}`;
    const identity = getAgentIdentity(dataDir, vaultId, record.delegate_agent_id);
    if (!identity || identity.status !== 'active') {
      return refuse(403, 'DELEGATION_IDENTITY_DENIED', 'Delegate agent not active');
    }
  } else {
    return refuse(400, 'BAD_REQUEST', 'Unknown delegation record kind');
  }

  return { ok: true, vaultId, recordKind: meta.record_kind, record };
}

/**
 * @param {string} dataDir
 * @param {{ vaultId: string, recordKind: string, record: object }} apply
 */
export function applyDelegationProposalToIndex(dataDir, apply) {
  if (apply.recordKind === 'agent_identity') {
    const store = loadIdentitiesStore(dataDir);
    if (!store.vaults[apply.vaultId]) store.vaults[apply.vaultId] = { identities: [] };
    store.vaults[apply.vaultId].identities.push(apply.record);
    saveIdentitiesStore(dataDir, store);
    return;
  }
  if (apply.recordKind === 'delegation_consent') {
    const store = loadConsentsStore(dataDir);
    if (!store.vaults[apply.vaultId]) store.vaults[apply.vaultId] = { consents: [] };
    store.vaults[apply.vaultId].consents.push(apply.record);
    saveConsentsStore(dataDir, store);
  }
}

/**
 * @param {{ dataDir: string, vaultId: string, kind?: AgentKind, status?: IdentityStatus }} input
 */
export function handleAgentIdentityListRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const readCtx = resolveDelegationReadContext(input.dataDir, input.vaultId);
  if (!readCtx.ok) return readCtx;

  let identities = [];
  if (readCtx.mode === 'envelope') {
    const map = readCtx.envelope?.identities_by_id;
    identities =
      map && typeof map === 'object' ? Object.values(map).filter((i) => i && typeof i === 'object') : [];
  } else {
    const store = loadIdentitiesStore(input.dataDir);
    const vault = store.vaults[input.vaultId];
    identities = vault && Array.isArray(vault.identities) ? [...vault.identities] : [];
  }

  const catalogMatches = listTrustedCatalogIdentities().filter((entry) => {
    if (input.kind && AGENT_KINDS.has(input.kind) && entry.kind !== input.kind) return false;
    if (input.status && IDENTITY_STATUSES.has(input.status) && entry.status !== input.status) {
      return false;
    }
    return true;
  });
  const reservedIds = new Set(catalogMatches.map((entry) => entry.agent_id));
  identities = [
    ...catalogMatches,
    ...identities.filter((entry) => !reservedIds.has(entry.agent_id)),
  ];

  if (input.kind && AGENT_KINDS.has(input.kind)) {
    identities = identities.filter((i) => i.kind === input.kind);
  }
  if (input.status && IDENTITY_STATUSES.has(input.status)) {
    identities = identities.filter((i) => i.status === input.status);
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.agent_identity_list/v0',
      vault_id: input.vaultId,
      identities,
    },
  };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   consentId: string,
 *   actorAgentId: string,
 *   taskRef?: string,
 *   runRef?: string,
 *   flowId?: string,
 *   flowVersion?: string,
 *   ttlSeconds?: number,
 *   maxActions?: number,
 * }} input
 */
export function handleDelegationGrantMintRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const readCtx = resolveDelegationReadContext(input.dataDir, input.vaultId);
  if (!readCtx.ok) return readCtx;

  const consentId = typeof input.consentId === 'string' ? input.consentId.trim() : '';
  const actorAgentId =
    typeof input.actorAgentId === 'string' ? input.actorAgentId.trim() : '';
  if (!isValidId(consentId, CONSENT_ID_PREFIX) || !isValidId(actorAgentId, AGENT_ID_PREFIX)) {
    return refuse(400, 'BAD_REQUEST', 'consent_id and actor_agent_id required');
  }

  const consent = getConsent(input.dataDir, input.vaultId, consentId);
  if (!consent) {
    return refuse(404, 'unknown_consent', 'unknown_consent');
  }

  const consentStatus = resolveConsentStatus(consent);
  if (consentStatus === 'revoked') {
    return refuse(403, 'DELEGATION_CONSENT_REVOKED', 'Consent revoked');
  }
  if (consentStatus === 'expired') {
    return refuse(403, 'DELEGATION_CONSENT_EXPIRED', 'Consent expired');
  }

  if (!UID_HASH_PRINCIPAL_RE.test(consent.principal_ref)) {
    return refuse(403, 'DELEGATION_CONSENT_PRINCIPAL_INVALID', 'Consent principal invalid');
  }

  if (consent.delegate_agent_id !== actorAgentId) {
    return refuse(403, 'DELEGATION_ACTOR_MISMATCH', 'Actor does not match consent');
  }

  const identity = getAgentIdentity(input.dataDir, input.vaultId, actorAgentId);
  if (!identity || identity.status !== 'active') {
    return refuse(403, 'DELEGATION_IDENTITY_DENIED', 'Actor identity denied');
  }

  const scope = effectiveScope(identity.scope_ceiling, consent.scope);
  if (!scope || scope !== consent.scope) {
    return refuse(403, 'DELEGATION_IDENTITY_SCOPE_DENIED', 'Scope denied');
  }

  const taskRef = typeof input.taskRef === 'string' ? input.taskRef.trim() : '';
  if (taskRef && !allowlistPermits(consent.allowed_task_ids, taskRef)) {
    return refuse(403, 'DELEGATION_TASK_DENIED', 'Task not on consent allowlist');
  }

  const flowId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
  const flowVersion = typeof input.flowVersion === 'string' ? input.flowVersion.trim() : '';
  if (flowId && !flowVersion) {
    return refuse(400, 'BAD_REQUEST', 'flow_version required when flow_id set');
  }
  if (flowId && !allowlistPermits(consent.allowed_flow_ids, flowId)) {
    return refuse(403, 'DELEGATION_FLOW_DENIED', 'Flow not on consent allowlist');
  }

  const runRef = typeof input.runRef === 'string' ? input.runRef.trim() : '';

  const vaultPolicy = readVaultDelegationPolicy(input.dataDir);
  const ttlRequested =
    typeof input.ttlSeconds === 'number' && input.ttlSeconds > 0
      ? Math.min(input.ttlSeconds, vaultPolicy.maxTtlSeconds)
      : vaultPolicy.defaultTtlSeconds;
  const ttl = Math.min(ttlRequested, vaultPolicy.maxTtlSeconds);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

  const grantId = randomToken(GRANT_ID_PREFIX);
  const bearer = randomToken(GRANT_BEARER_PREFIX, 24);

  const grant = {
    schema: DELEGATION_GRANT_SCHEMA,
    grant_id: grantId,
    consent_id: consentId,
    actor_agent_id: actorAgentId,
    principal_ref: consent.principal_ref,
    scope: consent.scope,
    workspace_id: consent.workspace_id,
    task_ref: taskRef || undefined,
    run_ref: runRef || undefined,
    flow_id: flowId || undefined,
    flow_version: flowVersion || undefined,
    expires_at: expiresAt,
    revoked_at: null,
    max_actions:
      typeof input.maxActions === 'number' && input.maxActions >= 0 ? input.maxActions : undefined,
    action_count: 0,
    issued_at: now.toISOString(),
  };

  const store = loadGrantsStore(input.dataDir);
  if (!store.vaults[input.vaultId]) store.vaults[input.vaultId] = { grants: [] };
  store.vaults[input.vaultId].grants.push({
    ...grant,
    grant_bearer_hash: hashGrantBearer(bearer),
  });
  saveGrantsStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: DELEGATION_GRANT_MINT_SCHEMA,
      grant: grantForClient(grant),
      bearer,
      expires_at: expiresAt,
    },
  };
}

/**
 * @param {{ dataDir: string, vaultId: string, grantId: string }} input
 */
export function handleDelegationGrantRevokeRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const grantId = typeof input.grantId === 'string' ? input.grantId.trim() : '';
  if (!isValidId(grantId, GRANT_ID_PREFIX)) {
    return refuse(400, 'BAD_REQUEST', 'grant_id required');
  }

  const store = loadGrantsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  if (!vault || !Array.isArray(vault.grants)) {
    return refuse(404, 'unknown_grant', 'unknown_grant');
  }

  const idx = vault.grants.findIndex((g) => g.grant_id === grantId);
  if (idx < 0) {
    return refuse(404, 'unknown_grant', 'unknown_grant');
  }

  vault.grants[idx] = {
    ...vault.grants[idx],
    revoked_at: new Date().toISOString(),
  };
  saveGrantsStore(input.dataDir, store);

  return { ok: true, payload: grantForClient(vault.grants[idx]) };
}

/**
 * @param {{ dataDir: string, vaultId: string, actorAgentId?: string }} input
 */
export function handleDelegationGrantListRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const store = loadGrantsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  let grants = vault && Array.isArray(vault.grants) ? vault.grants : [];

  const actorFilter =
    typeof input.actorAgentId === 'string' ? input.actorAgentId.trim() : '';
  if (actorFilter) {
    grants = grants.filter((g) => g.actor_agent_id === actorFilter);
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.delegation_grant_list/v0',
      vault_id: input.vaultId,
      grants: grants.map(grantForClient),
    },
  };
}

/**
 * @param {{ dataDir: string, vaultId: string, consentId: string, userId: string }} input
 */
export function handleDelegationConsentRevokeRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const consentId = typeof input.consentId === 'string' ? input.consentId.trim() : '';
  if (!isValidId(consentId, CONSENT_ID_PREFIX)) {
    return refuse(400, 'BAD_REQUEST', 'consent_id required');
  }

  const store = loadConsentsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  if (!vault || !Array.isArray(vault.consents)) {
    return refuse(404, 'unknown_consent', 'unknown_consent');
  }

  const idx = vault.consents.findIndex((c) => c.consent_id === consentId);
  if (idx < 0) {
    return refuse(404, 'unknown_consent', 'unknown_consent');
  }

  const principalRef = hashPrincipalRef(input.userId);
  if (vault.consents[idx].principal_ref !== principalRef) {
    return refuse(403, 'DELEGATION_PRINCIPAL_MISMATCH', 'Principal mismatch');
  }

  vault.consents[idx] = {
    ...vault.consents[idx],
    revoked_at: new Date().toISOString(),
  };
  saveConsentsStore(input.dataDir, store);

  return { ok: true, payload: vault.consents[idx] };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   grantId: string,
 *   actorAgentId: string,
 *   principalRef: string,
 *   action: AuditAction,
 *   evidenceRefs: string[],
 *   taskRef?: string,
 *   runRef?: string,
 *   flowId?: string,
 *   flowVersion?: string,
 *   stepId?: string,
 *   executionLocation?: ExecutionLocation,
 * }} input
 */
export function handleDelegationAuditAppendRequest(input) {
  const gate = checkDelegationGate(input.dataDir);
  if (!gate.ok) return gate;

  const chain = validateChain({
    dataDir: input.dataDir,
    vaultId: input.vaultId,
    actorAgentId: input.actorAgentId,
    principalRef: input.principalRef,
    grantId: input.grantId,
    taskRef: input.taskRef,
    runRef: input.runRef,
    flowId: input.flowId,
    flowVersion: input.flowVersion,
    requireGrant: true,
  });
  if (!chain.ok) {
    return refuse(chain.status, chain.code, chain.code);
  }

  const action = input.action;
  if (!AUDIT_ACTIONS.has(action)) {
    return refuse(400, 'BAD_REQUEST', 'invalid action');
  }

  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? input.evidenceRefs.filter((r) => typeof r === 'string' && r.trim()).slice(0, 32)
    : [];
  if (evidenceRefs.length === 0) {
    return refuse(400, 'BAD_REQUEST', 'evidence_refs required');
  }

  const auditId = randomToken(AUDIT_ID_PREFIX);
  const audit = {
    schema: DELEGATION_AUDIT_SCHEMA,
    audit_id: auditId,
    grant_id: input.grantId,
    actor_agent_id: input.actorAgentId,
    principal_ref: input.principalRef,
    task_ref: input.taskRef?.trim() || undefined,
    run_ref: input.runRef?.trim() || undefined,
    flow_id: input.flowId?.trim() || undefined,
    flow_version: input.flowVersion?.trim() || undefined,
    step_id: input.stepId?.trim() || undefined,
    action,
    evidence_refs: evidenceRefs,
    occurred_at: new Date().toISOString(),
    execution_location: input.executionLocation,
  };

  const validation = validateAuditRecord(audit);
  if (!validation.ok) {
    return refuse(400, 'BAD_REQUEST', validation.error);
  }

  const grantStore = loadGrantsStore(input.dataDir);
  const vault = grantStore.vaults[input.vaultId];
  const grantIdx = vault?.grants?.findIndex((g) => g.grant_id === input.grantId) ?? -1;
  if (grantIdx >= 0) {
    vault.grants[grantIdx].action_count = (vault.grants[grantIdx].action_count ?? 0) + 1;
    saveGrantsStore(input.dataDir, grantStore);
  }

  const auditStore = loadAuditStore(input.dataDir);
  if (!auditStore.vaults[input.vaultId]) auditStore.vaults[input.vaultId] = { audits: [] };
  auditStore.vaults[input.vaultId].audits.push(audit);
  saveAuditStore(input.dataDir, auditStore);

  return { ok: true, payload: audit };
}

/**
 * Seed identity + consent directly for tests (bypasses proposal when gate on in test fixtures).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {object} identity
 * @param {object} [consent]
 */
export function seedDelegationFixtures(dataDir, vaultId, identity, consent) {
  const idStore = loadIdentitiesStore(dataDir);
  if (!idStore.vaults[vaultId]) idStore.vaults[vaultId] = { identities: [] };
  idStore.vaults[vaultId].identities.push(identity);
  saveIdentitiesStore(dataDir, idStore);
  if (consent) {
    const cStore = loadConsentsStore(dataDir);
    if (!cStore.vaults[vaultId]) cStore.vaults[vaultId] = { consents: [] };
    cStore.vaults[vaultId].consents.push(consent);
    saveConsentsStore(dataDir, cStore);
  }
}
