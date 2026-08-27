/**
 * Immutable reserved external-provider identities (RHF-b-KN0).
 *
 * Global catalog entries are source-controlled — never stored in per-vault envelopes or
 * mutable identity blobs. Identity resolution checks this catalog first.
 *
 * @see ~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md §B1
 */

export const AGENT_IDENTITY_SCHEMA_V1 = 'knowtation.agent_identity/v1';

/** @type {ReadonlyArray<object>} */
export const TRUSTED_EXTERNAL_PROVIDER_IDENTITIES = Object.freeze([
  Object.freeze({
    schema: AGENT_IDENTITY_SCHEMA_V1,
    agent_id: 'agent_codex_retail',
    kind: 'external_provider',
    provider: 'codex',
    owner_ref: 'org_ref:scooling',
    registry_scope: 'global',
    vault_id: null,
    scope_ceiling: 'personal',
    status: 'active',
    created: '2026-08-27T00:00:00.000Z',
    updated: '2026-08-27T00:00:00.000Z',
  }),
]);

/** @type {ReadonlySet<string>} */
const RESERVED_CATALOG_IDS = Object.freeze(
  new Set(TRUSTED_EXTERNAL_PROVIDER_IDENTITIES.map((entry) => entry.agent_id)),
);

/** @type {ReadonlyMap<string, object>} */
const CATALOG_BY_ID = Object.freeze(
  new Map(TRUSTED_EXTERNAL_PROVIDER_IDENTITIES.map((entry) => [entry.agent_id, entry])),
);

/**
 * @param {string} agentId
 * @returns {boolean}
 */
export function isReservedCatalogAgentId(agentId) {
  return typeof agentId === 'string' && RESERVED_CATALOG_IDS.has(agentId.trim());
}

/**
 * @param {string} agentId
 * @returns {object|null}
 */
export function getTrustedCatalogIdentity(agentId) {
  if (typeof agentId !== 'string') return null;
  const entry = CATALOG_BY_ID.get(agentId.trim());
  if (!entry) return null;
  return { ...entry };
}

/**
 * @returns {object[]}
 */
export function listTrustedCatalogIdentities() {
  return TRUSTED_EXTERNAL_PROVIDER_IDENTITIES.map((entry) => ({ ...entry }));
}
