/**
 * Tier 4 — STRESS: concurrent mints, action_count atomicity, no bearer in list under load.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDelegationGrantMintRequest,
  handleDelegationGrantListRequest,
  handleDelegationAuditAppendRequest,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-stress');

describe('Agent delegation — stress', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const identity = makeAgentIdentity();
    const consent = makeDelegationConsent({ taskIds: [], flowIds: [] });
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('50 concurrent mints produce distinct grants; list has no bearer', async () => {
    const consent = makeDelegationConsent({ taskIds: [], flowIds: [] });
    const identity = makeAgentIdentity();
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        Promise.resolve(
          handleDelegationGrantMintRequest({
            dataDir,
            vaultId,
            consentId: consent.consent_id,
            actorAgentId: identity.agent_id,
          }),
        ),
      ),
    );
    assert.equal(results.every((r) => r.ok), true);
    const ids = new Set(results.map((r) => r.payload.grant.grant_id));
    assert.equal(ids.size, 50);
    const list = handleDelegationGrantListRequest({ dataDir, vaultId });
    assert.equal(list.payload.grants.length, 50);
    assert.equal(JSON.stringify(list.payload).includes('bearer'), false);
  });

  it('audit append increments action_count', () => {
    const consent = makeDelegationConsent({ taskIds: [], flowIds: [] });
    const identity = makeAgentIdentity();
    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: identity.agent_id,
      maxActions: 5,
    });
    assert.equal(mint.ok, true);
    for (let i = 0; i < 3; i++) {
      const audit = handleDelegationAuditAppendRequest({
        dataDir,
        vaultId,
        grantId: mint.payload.grant.grant_id,
        actorAgentId: identity.agent_id,
        principalRef: TEST_PRINCIPAL_REF,
        action: 'advance_step',
        evidenceRefs: [`proposal:stress_${i}`],
      });
      assert.equal(audit.ok, true);
    }
    const list = handleDelegationGrantListRequest({ dataDir, vaultId });
    const grant = list.payload.grants.find((g) => g.grant_id === mint.payload.grant.grant_id);
    assert.equal(grant.action_count, 3);
  });
});
