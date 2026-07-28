/**
 * Tier 3 — Live gate smoke (Phase 7C-L1): env and policy flips enable delegation handlers.
 *
 * Proves DELEGATION_ENABLED posture OFF by default, ON via env or policy file,
 * and fail-closed when flipped back off mid-session.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getDelegationEnabled,
  handleDelegationGrantMintRequest,
  handleDelegationGrantListRequest,
  handleDelegationGrantRevokeRequest,
  handleDelegationAuditAppendRequest,
  precheckApprovedDelegationProposal,
  applyDelegationProposalToIndex,
  seedDelegationFixtures,
  DELEGATION_PROPOSAL_SOURCE,
  DELEGATION_POLICY_FILE,
} from '../lib/agent/delegation.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_USER_ID,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-live-gate');

describe('Agent delegation — live gate (7C-L1)', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.DELEGATION_ENABLED;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('defaults off with no env and no policy file', () => {
    assert.equal(getDelegationEnabled(dataDir), false);
    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: 'dcons_missing',
      actorAgentId: 'agent_tutor_test01',
    });
    assert.equal(mint.ok, false);
    assert.equal(mint.code, 'DELEGATION_DISABLED');
  });

  it('env DELEGATION_ENABLED=1 enables full consent → grant → audit → revoke chain', () => {
    process.env.DELEGATION_ENABLED = '1';
    assert.equal(getDelegationEnabled(dataDir), true);

    const identity = makeAgentIdentity({ agentId: 'agent_live_gate01' });
    const consentBody = makeDelegationConsent({
      consentId: 'dcons_live_gate01',
      agentId: identity.agent_id,
    });
    seedDelegationFixtures(dataDir, vaultId, identity);
    const proposal = createProposal(dataDir, {
      path: 'meta/delegation/consents/live-gate.md',
      body: JSON.stringify(consentBody),
      intent: 'delegation_consent_create',
      source: DELEGATION_PROPOSAL_SOURCE,
      vault_id: vaultId,
      proposed_by: TEST_USER_ID,
      delegation_meta: { record_kind: 'delegation_consent', consent_id: consentBody.consent_id },
    });
    const precheck = precheckApprovedDelegationProposal(dataDir, proposal, { author: TEST_USER_ID });
    assert.equal(precheck.ok, true);
    applyDelegationProposalToIndex(dataDir, precheck);

    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consentBody.consent_id,
      actorAgentId: identity.agent_id,
      taskRef: 'task_hw_week3',
    });
    assert.equal(mint.ok, true);
    assert.ok(mint.payload.bearer?.startsWith('dgrnt_bearer_'));

    const audit = handleDelegationAuditAppendRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
      actorAgentId: identity.agent_id,
      principalRef: consentBody.principal_ref,
      action: 'advance_step',
      evidenceRefs: ['proposal:prop_live_gate'],
      taskRef: 'task_hw_week3',
    });
    assert.equal(audit.ok, true);

    const list = handleDelegationGrantListRequest({ dataDir, vaultId });
    assert.equal(list.ok, true);
    assert.equal(JSON.stringify(list.payload).includes('bearer'), false);

    const revoke = handleDelegationGrantRevokeRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
    });
    assert.equal(revoke.ok, true);

    const auditAfterRevoke = handleDelegationAuditAppendRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
      actorAgentId: identity.agent_id,
      principalRef: consentBody.principal_ref,
      action: 'advance_step',
    });
    assert.equal(auditAfterRevoke.ok, false);
  });

  it('policy file enabled:true enables when env unset', () => {
    writeDelegationPolicy(dataDir);
    assert.equal(getDelegationEnabled(dataDir), true);
  });

  it('env DELEGATION_ENABLED=0 overrides policy file enabled:true', () => {
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '0';
    assert.equal(getDelegationEnabled(dataDir), false);
  });

  it('flip env off after seed denies new mints', () => {
    writeDelegationPolicy(dataDir);
    const identity = makeAgentIdentity({ agentId: 'agent_flip_off01' });
    const consent = makeDelegationConsent({
      consentId: 'dcons_flip_off01',
      agentId: identity.agent_id,
    });
    seedDelegationFixtures(dataDir, vaultId, identity, consent);

    process.env.DELEGATION_ENABLED = '0';
    fs.rmSync(path.join(dataDir, DELEGATION_POLICY_FILE));
    assert.equal(getDelegationEnabled(dataDir), false);

    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: identity.agent_id,
    });
    assert.equal(mint.code, 'DELEGATION_DISABLED');
  });
});
