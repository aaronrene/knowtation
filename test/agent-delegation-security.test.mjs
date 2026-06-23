/**
 * Tier 7 — SECURITY: scope denial, no existence leak, injection inert, SD-5 separation.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDelegationGrantMintRequest,
  handleDelegationGrantListRequest,
  handleDelegationConsentRevokeRequest,
  getDelegationPolicyForbidden,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import { getFlowExternalAgentEnabled } from '../lib/flow/external-agent.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_USER_ID,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-security');

describe('Agent delegation — security', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const identity = makeAgentIdentity();
    identity.label = '<script>alert(1)</script> untrusted label';
    const consent = makeDelegationConsent();
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
    delete process.env.DELEGATION_POLICY_FORBIDDEN;
  });

  it('unknown_consent for missing consent — opaque code', () => {
    const result = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: 'dcons_nonexistent_xyz',
      actorAgentId: 'agent_tutor_test01',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unknown_consent');
    assert.equal(JSON.stringify(result).includes(vaultId), false);
  });

  it('task not on allowlist ⇒ DELEGATION_TASK_DENIED', () => {
    const consent = makeDelegationConsent();
    const identity = makeAgentIdentity();
    const result = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: identity.agent_id,
      taskRef: 'task_not_allowed',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DELEGATION_TASK_DENIED');
  });

  it('list/audit responses contain no bearer or secrets', () => {
    const consent = makeDelegationConsent({ taskIds: [], flowIds: [] });
    const identity = makeAgentIdentity();
    handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: identity.agent_id,
    });
    const list = handleDelegationGrantListRequest({ dataDir, vaultId });
    const serialized = JSON.stringify(list.payload);
    assert.equal(serialized.includes('bearer'), false);
    assert.equal(serialized.includes('grant_bearer_hash'), false);
  });

  it('principal mismatch on consent revoke', () => {
    const consent = makeDelegationConsent();
    const result = handleDelegationConsentRevokeRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      userId: 'other-user-id',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DELEGATION_PRINCIPAL_MISMATCH');
  });

  it('SD-5 external-agent gate independent of delegation gate', () => {
    assert.equal(getFlowExternalAgentEnabled(dataDir), false);
    assert.equal(getDelegationPolicyForbidden(dataDir), false);
    process.env.DELEGATION_POLICY_FORBIDDEN = '1';
    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: makeDelegationConsent().consent_id,
      actorAgentId: makeAgentIdentity().agent_id,
    });
    assert.equal(mint.ok, false);
    assert.equal(mint.code, 'DELEGATION_POLICY_FORBIDDEN');
  });

  it('label injection stored as data only in identity list', async () => {
    const { handleAgentIdentityListRequest } = await import('../lib/agent/delegation.mjs');
    const list = handleAgentIdentityListRequest({ dataDir, vaultId });
    assert.equal(list.ok, true);
    assert.equal(list.payload.identities[0].label.includes('<script>'), true);
  });
});
