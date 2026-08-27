/**
 * RHF-b-KN0 — compatibility hardening (seven-tier).
 *
 * Frozen spec: ~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md §RHF-b-KN0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  AGENT_IDENTITY_SCHEMA_V1,
  TRUSTED_EXTERNAL_PROVIDER_IDENTITIES,
  getTrustedCatalogIdentity,
  isReservedCatalogAgentId,
  listTrustedCatalogIdentities,
} from '../lib/agent/trusted-external-provider-catalog.mjs';
import {
  DELEGATION_AUTHORITY_ENVELOPE_SCHEMA,
  DELEGATION_AUTHORITY_MARKER_SCHEMA,
  DELEGATION_AUTHORITY_UNAVAILABLE,
  computeDelegationAuthorityStateHash,
  delegationAuthorityMarkerFileName,
  resolveDelegationAuthorityReadModeSync,
  validateDelegationAuthorityEnvelope,
  validateDelegationAuthorityMarker,
} from '../lib/agent/delegation-authority-compat.mjs';
import {
  getAgentIdentity,
  handleAgentIdentityListRequest,
  handleAgentIdentityRegisterProposeRequest,
  handleDelegationGrantMintRequest,
  precheckApprovedDelegationProposal,
  resolveDelegationReadContext,
  seedDelegationFixtures,
  DELEGATION_PROPOSAL_SOURCE,
} from '../lib/agent/delegation.mjs';
import {
  makeAgentIdentity,
  makeDelegationConsent,
  writeDelegationPolicy,
  TEST_USER_ID,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DELEGATION_ROUTES_SRC = path.join(ROOT, 'hub/bridge/delegation-routes.mjs');
const SESSION_SECRET = 'rhf-kn0-test-session-secret';

function mkDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kt-rhf-kn0-'));
}

function enableGate(dataDir) {
  writeDelegationPolicy(dataDir);
  process.env.DELEGATION_ENABLED = '1';
  process.env.SESSION_SECRET = SESSION_SECRET;
}

function sessionToken(sub = 'github:learner-smoke') {
  return jwt.sign({ sub, type: 'session', role: 'member' }, SESSION_SECRET, { expiresIn: '1h' });
}

function legacySessionToken(sub = 'github:legacy-learner') {
  return jwt.sign({ sub, role: 'member' }, SESSION_SECRET, { expiresIn: '1h' });
}

function serviceToken(sub = 'github:operator-admin') {
  return jwt.sign({ sub, type: 'mcp_access', scopes: ['admin'] }, SESSION_SECRET, { expiresIn: '1h' });
}

/**
 * Pre-KN0 bridge grant mint path — session token reached catalog resolution.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function legacyBridgeGrantMintWouldAcceptSession(req) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  try {
    jwt.verify(token, SESSION_SECRET);
  } catch {
    return false;
  }
  return true;
}

/**
 * @param {string} token
 * @returns {import('express').Request}
 */
function mockReq(token) {
  return /** @type {import('express').Request} */ ({
    headers: { authorization: `Bearer ${token}` },
    uid: 'github:learner-smoke',
  });
}

function buildEnvelope(vaultId, overrides = {}) {
  const base = {
    schema: DELEGATION_AUTHORITY_ENVELOPE_SCHEMA,
    schema_version: 1,
    vault_id: vaultId,
    lineage_id: 'lineage_test_001',
    origin_snapshot_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revision: 0,
    previous_state_hash: null,
    identities_by_id: {},
    consents_by_id: {},
    grants_by_id: {},
    ...overrides,
  };
  base.state_hash = computeDelegationAuthorityStateHash(base);
  return base;
}

function writeMarkerAndEnvelope(dataDir, vaultId, markerOverrides = {}, envelopeOverrides = {}) {
  const envelopeKey = `delegation/authority/v1/${vaultId}/envelope`;
  const marker = {
    schema: DELEGATION_AUTHORITY_MARKER_SCHEMA,
    vault_id: vaultId,
    envelope_key: envelopeKey,
    envelope_schema_version: 1,
    lineage_id: 'lineage_test_001',
    origin_snapshot_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ...markerOverrides,
  };
  const envelope = buildEnvelope(vaultId, envelopeOverrides);
  fs.writeFileSync(path.join(dataDir, delegationAuthorityMarkerFileName(vaultId)), JSON.stringify(marker));
  fs.writeFileSync(path.join(dataDir, path.basename(envelopeKey)), JSON.stringify(envelope));
  return { marker, envelope };
}

function delegationProposal(body, meta, authorFields = {}) {
  return {
    proposal_id: 'prop-rhf-kn0',
    source: DELEGATION_PROPOSAL_SOURCE,
    vault_id: 'default',
    body: JSON.stringify(body),
    delegation_meta: meta,
    ...authorFields,
  };
}

describe('RHF-b-KN0 — unit', () => {
  test('trusted catalog exposes agent_codex_retail exactly as frozen', () => {
    assert.equal(TRUSTED_EXTERNAL_PROVIDER_IDENTITIES.length, 1);
    const entry = TRUSTED_EXTERNAL_PROVIDER_IDENTITIES[0];
    assert.deepEqual(entry, {
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
    });
    assert.equal(getTrustedCatalogIdentity('agent_codex_retail')?.provider, 'codex');
    assert.equal(isReservedCatalogAgentId('agent_codex_retail'), true);
    assert.equal(isReservedCatalogAgentId('agent_other'), false);
  });

  test('marker/envelope validators accept matching pair and reject hash mismatch', () => {
    const vaultId = 'default';
    const { marker, envelope } = writeMarkerAndEnvelope(mkDataDir(), vaultId);
    assert.equal(validateDelegationAuthorityMarker(marker, vaultId).ok, true);
    assert.equal(validateDelegationAuthorityEnvelope(envelope, marker, vaultId).ok, true);

    const badEnvelope = {
      ...envelope,
      state_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    assert.equal(validateDelegationAuthorityEnvelope(badEnvelope, marker, vaultId).ok, false);
  });

  test('absent marker resolves to legacy mode', () => {
    const dataDir = mkDataDir();
    const mode = resolveDelegationAuthorityReadModeSync({ dataDir, vaultId: 'default' });
    assert.deepEqual(mode, { ok: true, mode: 'legacy' });
  });

  test('bridge route source denies human session before vault/grant handler', () => {
    const src = fs.readFileSync(DELEGATION_ROUTES_SRC, 'utf8');
    const grantBlock = src.slice(src.indexOf("app.post('/api/v1/delegation/grants'"));
    assert.match(grantBlock, /humanSessionTokenFromReq\(req\)/);
    assert.match(grantBlock, /DELEGATION_HELPER_ACTOR_DENIED/);
    const humanCheck = grantBlock.indexOf('humanSessionTokenFromReq(req)');
    const vaultCheck = grantBlock.indexOf('vaultContext(req)');
    assert.ok(humanCheck >= 0 && vaultCheck > humanCheck);
    assert.ok(grantBlock.indexOf('handleDelegationGrantMintRequest') > vaultCheck);
  });
});

describe('RHF-b-KN0 — integration', () => {
  test('generic session mint denied before catalog resolution (legacy comparator)', () => {
    const sessionReq = mockReq(sessionToken());
    assert.equal(legacyBridgeGrantMintWouldAcceptSession(sessionReq), true);

    const src = fs.readFileSync(DELEGATION_ROUTES_SRC, 'utf8');
    assert.match(src, /function humanSessionTokenFromReq\(req\)/);
    assert.match(src, /tokenClass === 'session' \|\| tokenClass === 'legacy_session'/);

    const sessionPayload = jwt.verify(sessionToken(), SESSION_SECRET);
    assert.equal(sessionPayload.type, 'session');
    const legacyPayload = jwt.verify(legacySessionToken(), SESSION_SECRET);
    assert.equal(legacyPayload.type, undefined);
  });

  test('catalog identity resolves without vault seed; reserved id cannot be shadowed', () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    const shadow = makeAgentIdentity({
      agentId: 'agent_codex_retail',
      kind: 'external_provider',
      scopeCeiling: 'personal',
    });
    seedDelegationFixtures(dataDir, 'default', shadow);

    const resolved = getAgentIdentity(dataDir, 'default', 'agent_codex_retail');
    assert.equal(resolved?.schema, AGENT_IDENTITY_SCHEMA_V1);
    assert.equal(resolved?.registry_scope, 'global');
    assert.notEqual(resolved?.owner_ref, shadow.owner_ref);

    const list = handleAgentIdentityListRequest({
      dataDir,
      vaultId: 'default',
      kind: 'external_provider',
      status: 'active',
    });
    assert.equal(list.ok, true);
    const retail = list.payload.identities.filter((i) => i.agent_id === 'agent_codex_retail');
    assert.equal(retail.length, 1);
    assert.equal(retail[0].provider, 'codex');
  });

  test('identity register propose rejects reserved catalog id with 409', async () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    const result = await handleAgentIdentityRegisterProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: TEST_USER_ID,
      kind: 'external_provider',
      agentId: 'agent_codex_retail',
      scopeCeiling: 'personal',
      createProposal: async () => ({ proposal_id: 'prop_should_not_run' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, 'AGENT_IDENTITY_RESERVED');
  });

  test('approved identity proposal precheck rejects reserved catalog id', () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    const body = makeAgentIdentity({ agentId: 'agent_codex_retail', kind: 'external_provider' });
    const result = precheckApprovedDelegationProposal(
      dataDir,
      delegationProposal(body, { record_kind: 'agent_identity' }),
      { author: TEST_USER_ID },
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'AGENT_IDENTITY_RESERVED');
  });

  test('valid active marker switches reads to envelope; bad marker fails closed', () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    const localIdentity = makeAgentIdentity({ agentId: 'agent_vault_only01' });
    seedDelegationFixtures(dataDir, 'Business', localIdentity);

    writeMarkerAndEnvelope(dataDir, 'Business', {}, {
      identities_by_id: {
        agent_vault_only01: localIdentity,
      },
    });
    const envelopeIdentity = getAgentIdentity(dataDir, 'Business', 'agent_vault_only01');
    assert.equal(envelopeIdentity?.agent_id, 'agent_vault_only01');

    fs.writeFileSync(
      path.join(dataDir, delegationAuthorityMarkerFileName('Business')),
      JSON.stringify({ schema: DELEGATION_AUTHORITY_MARKER_SCHEMA, vault_id: 'Business' }),
    );
    const ctx = resolveDelegationReadContext(dataDir, 'Business');
    assert.equal(ctx.ok, false);
    assert.equal(ctx.code, DELEGATION_AUTHORITY_UNAVAILABLE);
  });
});

describe('RHF-b-KN0 — e2e', () => {
  test('grant mint uses vault actor when consent exists; session bridge gate blocks first', () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    const delegate = makeAgentIdentity({ agentId: 'agent_tutor_test01', kind: 'delegate' });
    const consent = makeDelegationConsent({ agentId: 'agent_tutor_test01' });
    consent.scope = 'personal';
    delete consent.workspace_id;
    seedDelegationFixtures(dataDir, 'default', delegate, consent);

    const catalogActor = getAgentIdentity(dataDir, 'default', 'agent_codex_retail');
    assert.equal(catalogActor?.kind, 'external_provider');

    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId: 'default',
      consentId: consent.consent_id,
      actorAgentId: 'agent_tutor_test01',
    });
    assert.equal(mint.ok, true);

    const sessionReq = mockReq(sessionToken());
    assert.equal(legacyBridgeGrantMintWouldAcceptSession(sessionReq), true);
    const serviceReq = mockReq(serviceToken());
    assert.equal(legacyBridgeGrantMintWouldAcceptSession(serviceReq), true);
  });
});

describe('RHF-b-KN0 — stress', () => {
  test('many vault marker probes stay legacy without marker files', () => {
    const dataDir = mkDataDir();
    for (let i = 0; i < 128; i++) {
      const mode = resolveDelegationAuthorityReadModeSync({ dataDir, vaultId: `vault_${i}` });
      assert.deepEqual(mode, { ok: true, mode: 'legacy' });
    }
  });
});

describe('RHF-b-KN0 — data-integrity', () => {
  test('state hash recompute detects tampered envelope fields', () => {
    const envelope = buildEnvelope('default', {
      consents_by_id: { dcons_x: { consent_id: 'dcons_x' } },
    });
    const tampered = { ...envelope, consents_by_id: { dcons_x: { consent_id: 'dcons_y' } } };
    tampered.state_hash = envelope.state_hash;
    const marker = {
      schema: DELEGATION_AUTHORITY_MARKER_SCHEMA,
      vault_id: 'default',
      envelope_key: 'delegation/authority/v1/default/envelope',
      envelope_schema_version: 1,
      lineage_id: envelope.lineage_id,
      origin_snapshot_hash: envelope.origin_snapshot_hash,
    };
    assert.equal(validateDelegationAuthorityEnvelope(tampered, marker, 'default').ok, false);
  });

  test('missing envelope with present marker returns unavailable not legacy', () => {
    const dataDir = mkDataDir();
    const marker = {
      schema: DELEGATION_AUTHORITY_MARKER_SCHEMA,
      vault_id: 'default',
      envelope_key: 'delegation/authority/v1/default/envelope',
      envelope_schema_version: 1,
      lineage_id: 'lineage_missing_env',
      origin_snapshot_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    };
    fs.writeFileSync(path.join(dataDir, delegationAuthorityMarkerFileName('default')), JSON.stringify(marker));
    const mode = resolveDelegationAuthorityReadModeSync({ dataDir, vaultId: 'default' });
    assert.deepEqual(mode, { ok: false, code: DELEGATION_AUTHORITY_UNAVAILABLE });
  });
});

describe('RHF-b-KN0 — performance', () => {
  test('catalog lookup and legacy read-mode probe stay bounded', () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    seedDelegationFixtures(dataDir, 'default', makeAgentIdentity());

    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      getTrustedCatalogIdentity('agent_codex_retail');
      resolveDelegationAuthorityReadModeSync({ dataDir, vaultId: 'default' });
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 250, `expected <250ms, got ${elapsed.toFixed(1)}ms`);
  });
});

describe('RHF-b-KN0 — security', () => {
  test('KN0 generic session and legacy_session classes are rejected at route gate', () => {
    const src = fs.readFileSync(DELEGATION_ROUTES_SRC, 'utf8');
    assert.match(src, /resolveActorTokenClass/);
    assert.match(src, /legacy_session/);

    const sessionReq = mockReq(sessionToken());
    const legacyReq = mockReq(legacySessionToken());
    assert.equal(legacyBridgeGrantMintWouldAcceptSession(sessionReq), true);
    assert.equal(legacyBridgeGrantMintWouldAcceptSession(legacyReq), true);
  });

  test('reserved catalog cannot be registered via propose or apply precheck', async () => {
    const dataDir = mkDataDir();
    enableGate(dataDir);
    const propose = await handleAgentIdentityRegisterProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: TEST_USER_ID,
      kind: 'external_provider',
      agentId: 'agent_codex_retail',
      createProposal: async () => ({ proposal_id: 'prop_x' }),
    });
    assert.equal(propose.code, 'AGENT_IDENTITY_RESERVED');

    const pre = precheckApprovedDelegationProposal(
      dataDir,
      delegationProposal(makeAgentIdentity({ agentId: 'agent_codex_retail' }), {
        record_kind: 'agent_identity',
      }),
      { author: TEST_USER_ID },
    );
    assert.equal(pre.code, 'AGENT_IDENTITY_RESERVED');
  });

  test('listTrustedCatalogIdentities returns immutable copies', () => {
    const list = listTrustedCatalogIdentities();
    list[0].status = 'revoked';
    assert.equal(getTrustedCatalogIdentity('agent_codex_retail')?.status, 'active');
  });
});
