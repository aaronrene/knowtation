/**
 * Tier 1 — UNIT: delegation schemas, scope math, validateChain, bearer stripping.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getDelegationEnabled,
  validateAgentIdentityRecord,
  validateConsentRecord,
  validateGrantRecord,
  validateAuditRecord,
  intersectScope,
  effectiveScope,
  grantForClient,
  hashGrantBearer,
  validateChain,
  resolveConsentStatus,
  resolveGrantStatus,
  seedDelegationFixtures,
  AGENT_IDENTITY_SCHEMA,
  DELEGATION_GRANT_SCHEMA,
} from '../lib/agent/delegation.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-unit');

describe('Agent delegation — unit', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    delete process.env.DELEGATION_ENABLED;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('gate defaults off; policy file can enable', () => {
    const dataDir = path.join(tmpRoot, 'off');
    fs.mkdirSync(dataDir);
    assert.equal(getDelegationEnabled(dataDir), false);
    writeDelegationPolicy(dataDir);
    assert.equal(getDelegationEnabled(dataDir), true);
  });

  it('four schemas validate fixture records', () => {
    const identity = makeAgentIdentity();
    const consent = makeDelegationConsent();
    const grant = {
      schema: DELEGATION_GRANT_SCHEMA,
      grant_id: 'dgrnt_unit_test01',
      consent_id: consent.consent_id,
      actor_agent_id: identity.agent_id,
      principal_ref: TEST_PRINCIPAL_REF,
      scope: 'project',
      workspace_id: 'ws_class_101',
      expires_at: '2026-06-22T00:00:00Z',
      revoked_at: null,
      action_count: 0,
      issued_at: '2026-06-21T00:00:00Z',
    };
    const audit = {
      schema: 'knowtation.delegation_audit/v0',
      audit_id: 'daud_unit_test01',
      grant_id: grant.grant_id,
      actor_agent_id: identity.agent_id,
      principal_ref: TEST_PRINCIPAL_REF,
      action: 'advance_step',
      evidence_refs: ['proposal:prop_xyz'],
      occurred_at: '2026-06-21T00:00:00Z',
    };
    assert.equal(validateAgentIdentityRecord(identity).ok, true);
    assert.equal(validateConsentRecord(consent).ok, true);
    assert.equal(validateGrantRecord(grant).ok, true);
    assert.equal(validateAuditRecord(audit).ok, true);
  });

  it('grantForClient never includes bearer hash', () => {
    const stored = {
      schema: DELEGATION_GRANT_SCHEMA,
      grant_id: 'dgrnt_test',
      grant_bearer_hash: hashGrantBearer('dgrnt_bearer_secret'),
    };
    const client = grantForClient(stored);
    assert.equal(client.grant_bearer_hash, undefined);
    assert.equal(JSON.stringify(client).includes('bearer'), false);
  });

  it('scope intersection is deterministic', () => {
    assert.equal(intersectScope('personal', 'org'), 'personal');
    assert.equal(effectiveScope('project', 'org'), 'project');
    assert.equal(effectiveScope('personal', 'org'), 'personal');
  });

  it('validateChain rejects delegate without grant', () => {
    const dataDir = path.join(tmpRoot, 'chain');
    fs.mkdirSync(dataDir);
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const vaultId = 'default';
    const identity = makeAgentIdentity({ kind: 'delegate' });
    seedDelegationFixtures(dataDir, vaultId, identity);

    const result = validateChain({
      dataDir,
      vaultId,
      actorAgentId: identity.agent_id,
      principalRef: TEST_PRINCIPAL_REF,
      requireGrant: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DELEGATION_CONSENT_REQUIRED');
  });

  it('consent/grant status derivation', () => {
    const consent = makeDelegationConsent();
    assert.equal(resolveConsentStatus(consent), 'active');
    assert.equal(resolveConsentStatus({ ...consent, revoked_at: '2026-06-21T01:00:00Z' }), 'revoked');
    const grant = {
      expires_at: '2099-01-01T00:00:00Z',
      revoked_at: null,
      max_actions: 2,
      action_count: 2,
    };
    assert.equal(resolveGrantStatus(grant), 'exhausted');
  });
});
