/**
 * Tier 3 — E2E: seed identity/consent → mint → audit → revoke; consent expiry path.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDelegationGrantMintRequest,
  handleDelegationGrantRevokeRequest,
  handleDelegationAuditAppendRequest,
  precheckApprovedDelegationProposal,
  applyDelegationProposalToIndex,
  seedDelegationFixtures,
  DELEGATION_PROPOSAL_SOURCE,
} from '../lib/agent/delegation.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_USER_ID,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-e2e');

describe('Agent delegation — e2e', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('proposal approve → mint grant → append audit → revoke denies audit', () => {
    const identity = makeAgentIdentity({ agentId: 'agent_e2e_test01' });
    const consentBody = makeDelegationConsent({
      consentId: 'dcons_e2e_test01',
      agentId: identity.agent_id,
    });
    const proposal = createProposal(dataDir, {
      path: 'meta/delegation/consents/e2e.md',
      body: JSON.stringify(consentBody),
      intent: 'delegation_consent_create',
      source: DELEGATION_PROPOSAL_SOURCE,
      vault_id: vaultId,
      proposed_by: TEST_USER_ID,
      delegation_meta: { record_kind: 'delegation_consent', consent_id: consentBody.consent_id },
    });
    seedDelegationFixtures(dataDir, vaultId, identity);
    const precheck = precheckApprovedDelegationProposal(dataDir, proposal, { author: TEST_USER_ID });
    assert.equal(precheck.ok, true);
    applyDelegationProposalToIndex(dataDir, precheck);

    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consentBody.consent_id,
      actorAgentId: identity.agent_id,
      taskRef: 'task_hw_week3',
      runRef: 'run_2026w25',
    });
    assert.equal(mint.ok, true);

    const audit = handleDelegationAuditAppendRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
      actorAgentId: identity.agent_id,
      principalRef: TEST_PRINCIPAL_REF,
      action: 'advance_step',
      evidenceRefs: ['proposal:prop_e2e'],
      taskRef: 'task_hw_week3',
      runRef: 'run_2026w25',
    });
    assert.equal(audit.ok, true);
    assert.equal(audit.payload.task_ref, 'task_hw_week3');
    assert.equal(audit.payload.run_ref, 'run_2026w25');

    const revoke = handleDelegationGrantRevokeRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
    });
    assert.equal(revoke.ok, true);

    const auditAfter = handleDelegationAuditAppendRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
      actorAgentId: identity.agent_id,
      principalRef: TEST_PRINCIPAL_REF,
      action: 'advance_step',
      evidenceRefs: ['proposal:prop_e2e2'],
    });
    assert.equal(auditAfter.ok, false);
    assert.equal(auditAfter.code, 'DELEGATION_GRANT_REVOKED');
  });

  it('expired consent ⇒ mint fails', () => {
    const identity = makeAgentIdentity();
    const consent = makeDelegationConsent({ taskIds: [], flowIds: [] });
    consent.expires_at = '2020-01-01T00:00:00Z';
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: identity.agent_id,
    });
    assert.equal(mint.ok, false);
    assert.equal(mint.code, 'DELEGATION_CONSENT_EXPIRED');
  });
});
