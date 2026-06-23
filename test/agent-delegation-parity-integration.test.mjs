/**
 * Tier 2 — INTEGRATION: Hub = CLI handler parity; gate off ⇒ DELEGATION_DISABLED.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDelegationGrantMintRequest,
  handleDelegationGrantListRequest,
  DELEGATION_POLICY_FILE,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-parity');

function stripVolatileMint(payload) {
  const copy = structuredClone(payload);
  delete copy.bearer;
  if (copy.grant) {
    delete copy.grant.grant_id;
    delete copy.grant.expires_at;
    delete copy.grant.issued_at;
  }
  delete copy.expires_at;
  return copy;
}

describe('Agent delegation — parity integration', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const identity = makeAgentIdentity();
    const consent = makeDelegationConsent({ agentId: identity.agent_id });
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('mint parity across Hub-style and CLI-style handler calls', () => {
    const consent = makeDelegationConsent();
    const hub = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: consent.delegate_agent_id,
      taskRef: 'task_hw_week3',
    });
    const cli = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: consent.delegate_agent_id,
      taskRef: 'task_hw_week3',
    });
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.deepEqual(stripVolatileMint(hub.payload), stripVolatileMint(cli.payload));
    assert.ok(hub.payload.bearer.startsWith('dgrnt_bearer_'));
  });

  it('gate off ⇒ identical DELEGATION_DISABLED', () => {
    delete process.env.DELEGATION_ENABLED;
    fs.rmSync(path.join(dataDir, DELEGATION_POLICY_FILE));
    const hub = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: 'dcons_test',
      actorAgentId: 'agent_tutor_test01',
    });
    const cli = handleDelegationGrantListRequest({ dataDir, vaultId });
    assert.equal(hub.ok, false);
    assert.equal(cli.ok, false);
    assert.equal(hub.code, 'DELEGATION_DISABLED');
    assert.equal(cli.code, 'DELEGATION_DISABLED');
  });

  it('list returns grants without bearer', () => {
    const consent = makeDelegationConsent();
    handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: consent.consent_id,
      actorAgentId: consent.delegate_agent_id,
    });
    const list = handleDelegationGrantListRequest({ dataDir, vaultId });
    assert.equal(list.ok, true);
    assert.equal(list.payload.grants.length, 1);
    assert.equal(JSON.stringify(list.payload).includes('bearer'), false);
  });
});
