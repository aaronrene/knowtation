/**
 * RHF-b-KN1 — DelegationAuthorityStore retail routes (seven-tier).
 *
 * Frozen spec: ~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md §B2–B7
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

import {
  DELEGATION_CONSENT_SCHEMA,
  hashPrincipalRef,
  hashGrantBearer,
} from '../lib/agent/delegation.mjs';
import {
  MemoryCasBlobStore,
  createDelegationAuthorityStore,
  seedActiveAuthorityEnvelope,
  isConsentActiveStrict,
  isGrantActiveStrict,
  isStrictUtcTimestamp,
  selectActivePersonalConsent,
  buildAuthoritySubjects,
  sealEnvelopeStateHash,
  validateEnvelopeInternalIntegrity,
  pruneAuthorityEnvelope,
  principalActorKey,
  authorityBlobGetOpts,
  RETAIL_ACTOR_ID,
  RENEW_RATE_LIMIT,
  RENEW_RATE_WINDOW_MS,
  MAX_GRANTS,
  MAX_RATE_BUCKETS,
  DELEGATION_HELPER_CONSENT_REQUIRED,
  DELEGATION_HELPER_RENEW_RATE_LIMITED,
  DELEGATION_AUTHORITY_DENIED,
  DELEGATION_AUTHORITY_CONFLICT,
  DELEGATION_VALIDATION_SCHEMA,
  HELPER_ACCESS_SCHEMA,
  UTC_TIMESTAMP_RE,
} from '../lib/agent/delegation-authority-store.mjs';
import { computeDelegationAuthorityStateHash } from '../lib/agent/delegation-authority-compat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ROUTES_SRC = path.join(ROOT, 'hub/bridge/delegation-routes.mjs');
const GATEWAY_SRC = path.join(ROOT, 'hub/gateway/server.mjs');

const TEST_UID = 'github:kn1-learner';
const PRINCIPAL = hashPrincipalRef(TEST_UID);
const SESSION_SECRET = 'rhf-kn1-session-secret-for-tests';
const NOW = Date.parse('2026-08-27T12:00:00.000Z');

function mkDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kt-rhf-kn1-'));
}

function personalConsent(overrides = {}) {
  return {
    schema: DELEGATION_CONSENT_SCHEMA,
    consent_id: overrides.consent_id || 'dcons_kn1retail01',
    principal_ref: PRINCIPAL,
    delegate_agent_id: RETAIL_ACTOR_ID,
    scope: 'personal',
    expires_at: '2026-12-31T23:59:59.000Z',
    revoked_at: null,
    evidence_ref: 'proposal:prop_kn1',
    created: '2026-08-01T00:00:00.000Z',
    audit_sequence: 0,
    last_materialized_audit_sequence: 0,
    pending_audit_count: 0,
    ...overrides,
  };
}

async function seededStore(envelopeOverrides = {}, storeOpts = {}) {
  const dataDir = mkDataDir();
  const cas = new MemoryCasBlobStore();
  const { envelope } = await seedActiveAuthorityEnvelope({
    dataDir,
    vaultId: 'Business',
    cas,
    envelopeOverrides: {
      consents_by_id: {
        dcons_kn1retail01: personalConsent(),
      },
      ...envelopeOverrides,
    },
  });
  const store = createDelegationAuthorityStore({
    dataDir,
    vaultId: 'Business',
    blobStore: cas,
    sessionSecret: SESSION_SECRET,
    nowMs: NOW,
    operatorAuthorizedMarker: storeOpts.operatorAuthorizedMarker === true,
    ...storeOpts,
  });
  return { store, cas, dataDir, envelope };
}

describe('RHF-b-KN1 — unit', () => {
  test('strict UTC regex + equal-to-expiry is expired', () => {
    assert.equal(UTC_TIMESTAMP_RE.test('2026-08-27T12:00:00.000Z'), true);
    assert.equal(isStrictUtcTimestamp('2026-08-27T12:00:00Z'), true);
    assert.equal(isStrictUtcTimestamp('2026-08-27 12:00:00Z'), false);
    const consent = personalConsent({ expires_at: '2026-08-27T12:00:00.000Z' });
    assert.equal(isConsentActiveStrict(consent, NOW), false);
    assert.equal(isConsentActiveStrict(consent, NOW - 1), true);
  });

  test('consent selection: newest created then consent_id ascending', () => {
    const envelope = {
      consents_by_id: {
        dcons_b: personalConsent({
          consent_id: 'dcons_b',
          created: '2026-08-02T00:00:00.000Z',
        }),
        dcons_a: personalConsent({
          consent_id: 'dcons_a',
          created: '2026-08-02T00:00:00.000Z',
        }),
        dcons_old: personalConsent({
          consent_id: 'dcons_old',
          created: '2026-08-01T00:00:00.000Z',
        }),
      },
      newest_active_consent_id_by_principal_actor: {},
    };
    const selected = selectActivePersonalConsent(envelope, PRINCIPAL, RETAIL_ACTOR_ID, NOW);
    assert.equal(selected.consent_id, 'dcons_a');
  });

  test('authority subjects are 43-char base64url and rotate previous', () => {
    const subjects = buildAuthoritySubjects({
      sessionSecret: SESSION_SECRET,
      sessionSecretPrevious: 'previous-secret-kn1',
      uid: TEST_UID,
      vaultId: 'Business',
      actorId: RETAIL_ACTOR_ID,
    });
    assert.equal(subjects.length, 2);
    assert.equal(subjects[0].key_id, 'current');
    assert.equal(subjects[1].key_id, 'previous');
    assert.equal(subjects[0].value.length, 43);
    assert.match(subjects[0].value, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(subjects[0].value, subjects[1].value);
  });

  test('state hash seals and detects tamper', () => {
    let envelope = {
      schema: 'knowtation.delegation_authority_envelope/v1',
      schema_version: 1,
      vault_id: 'Business',
      lineage_id: 'lineage_x',
      origin_snapshot_hash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      revision: 0,
      previous_state_hash: null,
      identities_by_id: {},
      consents_by_id: {},
      grants_by_id: {},
      grant_id_by_bearer_hash: {},
      newest_active_consent_id_by_principal_actor: {},
      rate_buckets_by_principal_actor: {},
      audit_outbox_by_id: {},
    };
    envelope = sealEnvelopeStateHash(envelope);
    assert.equal(validateEnvelopeInternalIntegrity(envelope).ok, true);
    const tampered = { ...envelope, revision: 99 };
    tampered.state_hash = envelope.state_hash;
    assert.equal(validateEnvelopeInternalIntegrity(tampered).ok, false);
    assert.equal(computeDelegationAuthorityStateHash(envelope), envelope.state_hash);
  });

  test('bridge + gateway source register renew/validate/helper-access', () => {
    const routes = fs.readFileSync(ROUTES_SRC, 'utf8');
    assert.match(routes, /grants\/renew-personal/);
    assert.match(routes, /grants\/validate/);
    assert.match(routes, /helper-access/);
    assert.match(routes, /requireStrictSessionToken/);
    const gateway = fs.readFileSync(GATEWAY_SRC, 'utf8');
    assert.match(gateway, /grants\/renew-personal/);
    assert.match(gateway, /grants\/validate/);
    assert.match(gateway, /helper-access/);
    assert.match(gateway, /x-delegation-actor/);
    assert.match(gateway, /x-retail-visit/);
  });

  test('authorityBlobGetOpts omits strong consistency on Lambda-compat', () => {
    const prevNetlify = process.env.NETLIFY;
    const prevLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
    try {
      delete process.env.NETLIFY;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      assert.equal(authorityBlobGetOpts().consistency, 'strong');

      process.env.NETLIFY = 'true';
      assert.equal(authorityBlobGetOpts().consistency, undefined);
      assert.equal(authorityBlobGetOpts().type, 'text');

      delete process.env.NETLIFY;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'bridge';
      assert.equal(authorityBlobGetOpts().consistency, undefined);
    } finally {
      if (prevNetlify === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = prevNetlify;
      if (prevLambda === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      else process.env.AWS_LAMBDA_FUNCTION_NAME = prevLambda;
    }
  });
});

describe('RHF-b-KN1 — integration', () => {
  test('helper-access states: consent_required → renewable → ready', async () => {
    const { store } = await seededStore({ consents_by_id: {} });
    const none = await store.readHelperAccess(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(none.ok, true);
    assert.equal(none.payload.state, 'consent_required');

    const { store: store2 } = await seededStore();
    const renewable = await store2.readHelperAccess(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(renewable.payload.schema, HELPER_ACCESS_SCHEMA);
    assert.equal(renewable.payload.state, 'renewable');

    const mint = await store2.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(mint.ok, true);
    assert.equal(mint.payload.schema, 'knowtation.delegation_grant_mint/v0');
    assert.ok(mint.payload.bearer);
    const ready = await store2.readHelperAccess(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(ready.payload.state, 'ready');
  });

  test('helper-access survives Lambda-compat BlobsConsistencyError on strong gets', async () => {
    /**
     * Netlify connectLambda store: strong consistency throws; eventual succeeds.
     * Pre-fix STRONG_GET always passed consistency:strong → 503 while grants worked.
     */
    class LambdaCompatCasStore extends MemoryCasBlobStore {
      async get(key, opts = {}) {
        if (opts.consistency === 'strong') {
          throw new Error('BlobsConsistencyError: strong consistency is not available');
        }
        return super.get(key, opts);
      }
      async getWithMetadata(key, opts = {}) {
        if (opts.consistency === 'strong') {
          throw new Error('BlobsConsistencyError: strong consistency is not available');
        }
        return super.getWithMetadata(key, opts);
      }
    }

    const prevNetlify = process.env.NETLIFY;
    process.env.NETLIFY = 'true';
    try {
      const dataDir = mkDataDir();
      const cas = new LambdaCompatCasStore();
      await seedActiveAuthorityEnvelope({
        dataDir,
        vaultId: 'Business',
        cas,
        envelopeOverrides: {
          consents_by_id: {
            dcons_kn1retail01: personalConsent(),
          },
          newest_active_consent_id_by_principal_actor: {
            [principalActorKey(PRINCIPAL, RETAIL_ACTOR_ID)]: 'dcons_kn1retail01',
          },
        },
      });
      const store = createDelegationAuthorityStore({
        dataDir,
        vaultId: 'Business',
        blobStore: cas,
        sessionSecret: SESSION_SECRET,
        nowMs: NOW,
      });
      const access = await store.readHelperAccess(TEST_UID, RETAIL_ACTOR_ID);
      assert.equal(access.ok, true);
      assert.equal(access.payload.state, 'renewable');
    } finally {
      if (prevNetlify === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = prevNetlify;
    }
  });

  test('renew without consent fails closed; validate consumes action_count', async () => {
    const { store } = await seededStore({ consents_by_id: {} });
    const denied = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, DELEGATION_HELPER_CONSENT_REQUIRED);

    const { store: store2 } = await seededStore();
    const mint = await store2.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(mint.ok, true);
    const visit = randomBytes(32).toString('base64url');
    const validated = await store2.validateAndConsume({
      uid: TEST_UID,
      bearer: mint.payload.bearer,
      actorId: RETAIL_ACTOR_ID,
      visitHandle: visit,
    });
    assert.equal(validated.ok, true);
    assert.equal(validated.payload.schema, DELEGATION_VALIDATION_SCHEMA);
    assert.equal(validated.payload.authority_subjects[0].value.length, 43);

    const grantId = mint.payload.grant.grant_id;
    const after = await store2.readActiveEnvelope();
    assert.equal(after.envelope.grants_by_id[grantId].action_count, 1);
    assert.equal(after.envelope.grants_by_id[grantId].last_materialized_audit_sequence >= 1, true);
  });

  test('wrong bearer / actor / principal denied', async () => {
    const { store } = await seededStore();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    const visit = randomBytes(32).toString('base64url');
    const badBearer = await store.validateAndConsume({
      uid: TEST_UID,
      bearer: 'dgrnt_bearer_notreal00000000',
      actorId: RETAIL_ACTOR_ID,
      visitHandle: visit,
    });
    assert.equal(badBearer.code, DELEGATION_AUTHORITY_DENIED);

    const badPrincipal = await store.validateAndConsume({
      uid: 'github:other-user',
      bearer: mint.payload.bearer,
      actorId: RETAIL_ACTOR_ID,
      visitHandle: visit,
    });
    assert.equal(badPrincipal.code, DELEGATION_AUTHORITY_DENIED);
  });

  test('candidate create is ignored until authorized marker; unauthorized activate blocked', async () => {
    const dataDir = mkDataDir();
    const cas = new MemoryCasBlobStore();
    // seed empty legacy stores
    fs.writeFileSync(
      path.join(dataDir, 'hub_delegation_identities.json'),
      JSON.stringify({ vaults: { Business: { identities: [] } } }),
    );
    fs.writeFileSync(
      path.join(dataDir, 'hub_delegation_consents.json'),
      JSON.stringify({
        vaults: {
          Business: {
            consents: [personalConsent()],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(dataDir, 'hub_delegation_grants.json'),
      JSON.stringify({ vaults: { Business: { grants: [] } } }),
    );

    const blocked = createDelegationAuthorityStore({
      dataDir,
      vaultId: 'Business',
      blobStore: cas,
      sessionSecret: SESSION_SECRET,
      operatorAuthorizedMarker: false,
    });
    const candidate = await blocked.createOrVerifyCandidate();
    assert.equal(candidate.ok, true);
    assert.ok(candidate.lineage_id);
    // Readers still inactive without marker
    const inactive = await blocked.readActiveEnvelope();
    assert.equal(inactive.ok, false);

    const noAuth = await blocked.activateMarker({ operatorAuthorized: true });
    assert.equal(noAuth.ok, false);

    const authorized = createDelegationAuthorityStore({
      dataDir,
      vaultId: 'Business',
      blobStore: cas,
      sessionSecret: SESSION_SECRET,
      operatorAuthorizedMarker: true,
    });
    const activated = await authorized.activateMarker({ operatorAuthorized: true });
    assert.equal(activated.ok, true);
    const active = await authorized.readActiveEnvelope();
    assert.equal(active.ok, true);
    assert.ok(active.envelope.consents_by_id.dcons_kn1retail01);
  });
});

describe('RHF-b-KN1 — e2e (store protocol)', () => {
  test('renew → helper ready → validate → second validate increments', async () => {
    const { store } = await seededStore();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    const visit = randomBytes(32).toString('base64url');
    await store.validateAndConsume({
      uid: TEST_UID,
      bearer: mint.payload.bearer,
      actorId: RETAIL_ACTOR_ID,
      visitHandle: visit,
    });
    await store.validateAndConsume({
      uid: TEST_UID,
      bearer: mint.payload.bearer,
      actorId: RETAIL_ACTOR_ID,
      visitHandle: visit,
    });
    const after = await store.readActiveEnvelope();
    assert.equal(after.envelope.grants_by_id[mint.payload.grant.grant_id].action_count, 2);
    assert.equal(after.envelope.revision >= 3, true);
  });
});

describe('RHF-b-KN1 — stress', () => {
  test('rate limit 12 renewals / 5 minutes', async () => {
    const { store } = await seededStore();
    for (let i = 0; i < RENEW_RATE_LIMIT; i += 1) {
      const r = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
      assert.equal(r.ok, true, `renew ${i}`);
    }
    const limited = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(limited.ok, false);
    assert.equal(limited.code, DELEGATION_HELPER_RENEW_RATE_LIMITED);
    assert.equal(RENEW_RATE_WINDOW_MS, 5 * 60 * 1000);
  });

  test('CAS conflict returns 409 after retries', async () => {
    const dataDir = mkDataDir();
    const cas = new MemoryCasBlobStore();
    await seedActiveAuthorityEnvelope({
      dataDir,
      vaultId: 'Business',
      cas,
      envelopeOverrides: {
        consents_by_id: { dcons_kn1retail01: personalConsent() },
      },
    });
    // Wrap set to always fail onlyIfMatch
    const origSet = cas.set.bind(cas);
    cas.set = async (key, value, opts = {}) => {
      if (opts.onlyIfMatch) return { modified: false };
      return origSet(key, value, opts);
    };
    const store = createDelegationAuthorityStore({
      dataDir,
      vaultId: 'Business',
      blobStore: cas,
      sessionSecret: SESSION_SECRET,
      nowMs: NOW,
    });
    const result = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(result.ok, false);
    assert.equal(result.code, DELEGATION_AUTHORITY_CONFLICT);
  });
});

describe('RHF-b-KN1 — data-integrity', () => {
  test('mutation advances revision and previous_state_hash chain', async () => {
    const { store } = await seededStore();
    const before = await store.readActiveEnvelope();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(mint.ok, true);
    const after = await store.readActiveEnvelope();
    // Authority CAS + post-CAS materialize drain each bump revision.
    assert.ok(after.envelope.revision >= before.envelope.revision + 1);
    assert.notEqual(after.envelope.state_hash, before.envelope.state_hash);
    assert.equal(validateEnvelopeInternalIntegrity(after.envelope).ok, true);
  });

  test('outbox materializes contiguously in same CAS as grant mint', async () => {
    const { store } = await seededStore();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    const after = await store.readActiveEnvelope();
    const grant = after.envelope.grants_by_id[mint.payload.grant.grant_id];
    assert.equal(grant.audit_sequence, 1);
    assert.equal(grant.last_materialized_audit_sequence, 1);
    assert.equal(grant.pending_audit_count, 0);
    assert.equal(Object.keys(after.envelope.audit_outbox_by_id).length, 0);
    assert.ok(after.envelope.event_chain_heads_by_record[`grant:${grant.grant_id}`]);
  });

  test('prune refuses active grants and keeps consent forever', async () => {
    const { store } = await seededStore();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    const env = (await store.readActiveEnvelope()).envelope;
    const pruned = pruneAuthorityEnvelope(env, NOW);
    assert.ok(pruned.grants_by_id[mint.payload.grant.grant_id]);
    assert.ok(pruned.consents_by_id.dcons_kn1retail01);
  });
});

describe('RHF-b-KN1 — performance', () => {
  test('O(1) bearer index lookup and transform p95 budget on large envelope', async () => {
    /** @type {Record<string, object>} */
    const grants_by_id = {};
    /** @type {Record<string, string>} */
    const grant_id_by_bearer_hash = {};
    for (let i = 0; i < 200; i += 1) {
      const id = `dgrnt_perf${String(i).padStart(8, '0')}`;
      const bearer = `dgrnt_bearer_perf${String(i).padStart(8, '0')}`;
      const hash = hashGrantBearer(bearer);
      grants_by_id[id] = {
        schema: 'knowtation.delegation_grant/v0',
        grant_id: id,
        consent_id: 'dcons_kn1retail01',
        actor_agent_id: RETAIL_ACTOR_ID,
        principal_ref: PRINCIPAL,
        scope: 'personal',
        expires_at: '2026-12-31T23:59:59.000Z',
        revoked_at: null,
        max_actions: 64,
        action_count: 0,
        issued_at: '2026-08-27T11:00:00.000Z',
        grant_bearer_hash: hash,
        audit_sequence: 0,
        last_materialized_audit_sequence: 0,
        pending_audit_count: 0,
      };
      grant_id_by_bearer_hash[hash] = id;
    }
    const dataDir = mkDataDir();
    const cas = new MemoryCasBlobStore();
    await seedActiveAuthorityEnvelope({
      dataDir,
      vaultId: 'Business',
      cas,
      envelopeOverrides: {
        consents_by_id: { dcons_kn1retail01: personalConsent() },
        grants_by_id,
        grant_id_by_bearer_hash,
      },
    });

    const samples = [];
    for (let i = 0; i < 40; i += 1) {
      // Space renewals outside the 5-minute window so the rate limit never trips.
      const store = createDelegationAuthorityStore({
        dataDir,
        vaultId: 'Business',
        blobStore: cas,
        sessionSecret: SESSION_SECRET,
        nowMs: NOW + i * (RENEW_RATE_WINDOW_MS + 1000),
      });
      const t0 = performance.now();
      const r = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
      samples.push(performance.now() - t0);
      assert.equal(r.ok, true, `renew ${i}: ${r.code || ''}`);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    assert.ok(p95 <= 250, `transform+CAS p95 ${p95}ms exceeds 250ms`);
    assert.ok(MAX_GRANTS >= 3072);
    assert.ok(MAX_RATE_BUCKETS === 64);
  });
});

describe('RHF-b-KN1 — security', () => {
  test('marker activation without operatorAuthorized is denied', async () => {
    const { store } = await seededStore({}, { operatorAuthorizedMarker: true });
    const denied = await store.activateMarker({ operatorAuthorized: false });
    assert.equal(denied.ok, false);
  });

  test('malformed timestamps invalidate envelope integrity', () => {
    const envelope = sealEnvelopeStateHash({
      schema: 'knowtation.delegation_authority_envelope/v1',
      schema_version: 1,
      vault_id: 'Business',
      lineage_id: 'lineage_x',
      origin_snapshot_hash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      revision: 0,
      previous_state_hash: null,
      identities_by_id: {},
      consents_by_id: {
        dcons_bad: personalConsent({ created: 'not-a-timestamp' }),
      },
      grants_by_id: {},
      grant_id_by_bearer_hash: {},
      newest_active_consent_id_by_principal_actor: {},
      rate_buckets_by_principal_actor: {},
      audit_outbox_by_id: {},
    });
    assert.equal(validateEnvelopeInternalIntegrity(envelope).ok, false);
  });

  test('bearer hash index is used (no array scan required for lookup)', async () => {
    const { store } = await seededStore();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    const after = await store.readActiveEnvelope();
    const hash = hashGrantBearer(mint.payload.bearer);
    assert.equal(after.envelope.grant_id_by_bearer_hash[hash], mint.payload.grant.grant_id);
    assert.equal(principalActorKey(PRINCIPAL, RETAIL_ACTOR_ID).includes('\u0000'), true);
  });

  test('routes use requireRetailSession (session-first allowlisted 401)', () => {
    const src = fs.readFileSync(ROUTES_SRC, 'utf8');
    const renew = src.slice(src.indexOf("app.post('/api/v1/delegation/grants/renew-personal'"));
    assert.match(renew, /requireRetailSession/);
    assert.doesNotMatch(renew.slice(0, 200), /requireBridgeAuth/);
  });

  test('revokeGrant removes active index; revokeConsent refuses other principal', async () => {
    const { store } = await seededStore();
    const mint = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    const revoked = await store.revokeGrant('admin', mint.payload.grant.grant_id);
    assert.equal(revoked.ok, true);
    const access = await store.readHelperAccess(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(access.payload.state, 'renewable');
    const denied = await store.revokeConsent('github:other', 'dcons_kn1retail01');
    assert.equal(denied.ok, false);
  });

  test('blob marker read errors fail closed (no stale local fallback)', async () => {
    const dataDir = mkDataDir();
    const cas = new MemoryCasBlobStore();
    await seedActiveAuthorityEnvelope({
      dataDir,
      vaultId: 'Business',
      cas,
      envelopeOverrides: {
        consents_by_id: { dcons_kn1retail01: personalConsent() },
      },
    });
    const store = createDelegationAuthorityStore({
      dataDir,
      vaultId: 'Business',
      blobStore: cas,
      sessionSecret: SESSION_SECRET,
      nowMs: NOW,
    });
    const origGet = cas.get.bind(cas);
    cas.get = async (key, opts) => {
      if (String(key).includes('/marker')) throw new Error('blob unavailable');
      return origGet(key, opts);
    };
    const result = await store.readActiveEnvelope();
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  });

  test('CAS conflict leaves zero external audit events for uncommitted mint', async () => {
    const dataDir = mkDataDir();
    const cas = new MemoryCasBlobStore();
    await seedActiveAuthorityEnvelope({
      dataDir,
      vaultId: 'Business',
      cas,
      envelopeOverrides: {
        consents_by_id: { dcons_kn1retail01: personalConsent() },
      },
    });
    const auditKeys = [];
    const origSet = cas.set.bind(cas);
    cas.set = async (key, value, opts = {}) => {
      if (String(key).startsWith('delegation/audit/')) auditKeys.push(key);
      if (opts.onlyIfMatch && String(key).includes('/envelope')) {
        return { modified: false };
      }
      return origSet(key, value, opts);
    };
    const store = createDelegationAuthorityStore({
      dataDir,
      vaultId: 'Business',
      blobStore: cas,
      sessionSecret: SESSION_SECRET,
      nowMs: NOW,
    });
    const result = await store.renewPersonal(TEST_UID, RETAIL_ACTOR_ID);
    assert.equal(result.code, DELEGATION_AUTHORITY_CONFLICT);
    assert.equal(auditKeys.length, 0);
  });
});
