/**
 * SEC-SEAM-1 / L-SEAM — hosted delegation consent propose with session-bound learner JWT.
 *
 * Proves delegate vault-map restriction does not block type:'session' POST
 * /api/v1/delegation/consents on Business (F26 DELEGATION-WRITE smoke path).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('SEC-SEAM delegation hosted consent propose — unit', () => {
  it('delegation-routes passes sessionBound into createDelegationProposalOnCanister', () => {
    const src = readRepo('hub/bridge/delegation-routes.mjs');
    assert.match(src, /function sessionBoundFromReq\(req\)/);
    assert.match(src, /isSessionBoundActor/);
    assert.match(
      src,
      /app\.post\('\/api\/v1\/delegation\/consents'[\s\S]*sessionBound: sessionBoundFromReq\(req\)/,
    );
    assert.match(src, /sessionBound: ctx\.sessionBound === true/);
    assert.match(src, /proposed_by: ctx\.actorUid/);
  });

  it('bridge server expands vault allowlist for session-bound actors', () => {
    const src = readRepo('hub/bridge/server.mjs');
    assert.match(src, /resolveAllowedVaultIdsForSessionBoundActor/);
    assert.match(src, /bridgeSessionBoundFromReq/);
    assert.match(src, /isSessionBoundActor/);
  });

  it('delegation-hosted-proposal augments canister create body (session + pending eval)', () => {
    const src = readRepo('lib/agent/delegation-hosted-proposal.mjs');
    assert.match(src, /augmentProposalCreateRequestBody/);
    assert.match(src, /sessionBound: opts\.sessionBound === true/);
    assert.match(src, /evaluation_status = 'pending'/);
    assert.match(src, /source: DELEGATION_PROPOSAL_SOURCE/);
  });

  it('delegation-routes logs consent propose failures with Hub code', () => {
    const src = readRepo('hub/bridge/delegation-routes.mjs');
    assert.match(src, /POST \/api\/v1\/delegation\/consents/);
    assert.match(src, /vault context denied/);
    assert.match(src, /delegation route error/);
  });
});

describe('SEC-SEAM delegation hosted consent propose — integration (handler)', () => {
  it('consent propose handler succeeds when delegate agent is active in vault', async () => {
    const os = await import('node:os');
    const { writeDelegationPolicy, makeAgentIdentity } = await import('./fixtures/agent/delegation-helpers.mjs');
    const { seedDelegationFixtures, handleDelegationConsentProposeRequest } = await import(
      '../lib/agent/delegation.mjs'
    );

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-sec-seam-delegation-'));
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const identity = makeAgentIdentity({
      agentId: 'agent_l1smoke01',
      kind: 'delegate',
      scopeCeiling: 'personal',
    });
    seedDelegationFixtures(dataDir, 'Business', identity);

    const result = await handleDelegationConsentProposeRequest({
      dataDir,
      vaultId: 'Business',
      userId: 'google:learner-smoke',
      delegateAgentId: 'agent_l1smoke01',
      scope: 'personal',
      createProposal: async (_dir, input) => ({
        proposal_id: 'prop_sec_seam_delegation_01',
        path: input.path,
        status: 'proposed',
        vault_id: input.vault_id,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.payload.intent, 'delegation_consent_create');
    assert.match(String(result.payload.proposal_id), /^prop_/);

    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });
});
