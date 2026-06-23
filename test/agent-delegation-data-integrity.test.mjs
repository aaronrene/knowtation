/**
 * Tier 5 — DATA-INTEGRITY: consent→grant field copy, audit pins, schema round-trip.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDelegationGrantMintRequest,
  handleDelegationAuditAppendRequest,
  validateGrantRecord,
  validateAuditRecord,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-data-integrity');

describe('Agent delegation — data integrity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const identity = makeAgentIdentity();
    const consent = makeDelegationConsent();
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('grant copies principal/scope from consent; audit preserves pins', () => {
    const consent = makeDelegationConsent();
    const identity = makeAgentIdentity();
    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: identity.agent_id,
      taskRef: 'task_hw_week3',
      runRef: 'run_2026w25',
      flowId: 'flow_weekly_review',
      flowVersion: '1.4.0',
    });
    assert.equal(mint.ok, true);
    assert.equal(mint.payload.grant.principal_ref, consent.principal_ref);
    assert.equal(mint.payload.grant.scope, consent.scope);
    assert.equal(validateGrantRecord(mint.payload.grant).ok, true);

    const audit = handleDelegationAuditAppendRequest({
      dataDir,
      vaultId,
      grantId: mint.payload.grant.grant_id,
      actorAgentId: identity.agent_id,
      principalRef: TEST_PRINCIPAL_REF,
      action: 'advance_step',
      evidenceRefs: ['proposal:integrity'],
      taskRef: 'task_hw_week3',
      runRef: 'run_2026w25',
      flowId: 'flow_weekly_review',
      flowVersion: '1.4.0',
      stepId: 'flow_weekly_review#1',
    });
    assert.equal(audit.ok, true);
    assert.equal(validateAuditRecord(audit.payload).ok, true);
    const roundTrip = JSON.parse(JSON.stringify(audit.payload));
    assert.equal(roundTrip.schema, 'knowtation.delegation_audit/v0');
    assert.deepEqual(roundTrip.evidence_refs, ['proposal:integrity']);
  });
});
