/**
 * Phase 7C-L1b — hosted delegation proposal parity (canister propose + bridge apply).
 *
 * Tiers: unit, integration, e2e, stress, data-integrity, performance, security.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeDelegationFrontmatter,
  normalizeCanisterProposalForDelegationPrecheck,
  isDelegationProposalIntent,
  createDelegationProposalOnCanister,
  applyApprovedDelegationProposalFromCanister,
  FM_PROPOSAL_SOURCE,
  FM_RECORD_KIND,
} from '../lib/agent/delegation-hosted-proposal.mjs';
import {
  DELEGATION_PROPOSAL_SOURCE,
  precheckApprovedDelegationProposal,
  applyDelegationProposalToIndex,
  handleDelegationGrantMintRequest,
  getAgentIdentity,
  getConsent,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import { writeDelegationPolicy, makeAgentIdentity, makeDelegationConsent, TEST_USER_ID } from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-delegation-l1b');

describe('7C-L1b delegation hosted proposal — unit', () => {
  it('isDelegationProposalIntent recognizes delegation intents', () => {
    assert.equal(isDelegationProposalIntent('agent_identity_register'), true);
    assert.equal(isDelegationProposalIntent('delegation_consent_create'), true);
    assert.equal(isDelegationProposalIntent('flow_edit'), false);
  });

  it('mergeDelegationFrontmatter embeds source and record kind', () => {
    const fm = mergeDelegationFrontmatter({ agent_id: 'agent_x' }, { record_kind: 'agent_identity', agent_id: 'agent_x' });
    assert.equal(fm[FM_PROPOSAL_SOURCE], DELEGATION_PROPOSAL_SOURCE);
    assert.equal(fm[FM_RECORD_KIND], 'agent_identity');
    assert.equal(fm.agent_id, 'agent_x');
  });

  it('normalizeCanisterProposalForDelegationPrecheck maps frontmatter to delegation_meta', () => {
    const fm = mergeDelegationFrontmatter({}, { record_kind: 'delegation_consent', consent_id: 'dcons_abc' });
    const normalized = normalizeCanisterProposalForDelegationPrecheck({
      proposal_id: 'prop-1',
      intent: 'delegation_consent_create',
      status: 'approved',
      vault_id: 'Business',
      body: '{}',
      frontmatter: JSON.stringify(fm),
    });
    assert.ok(normalized);
    assert.equal(normalized.source, DELEGATION_PROPOSAL_SOURCE);
    assert.equal(normalized.delegation_meta.record_kind, 'delegation_consent');
    assert.equal(normalized.delegation_meta.consent_id, 'dcons_abc');
  });
});

describe('7C-L1b delegation hosted proposal — integration', () => {
  const dataDir = path.join(tmpRoot, 'integration', 'data');
  const vaultId = 'Business';

  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, 'integration'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.DELEGATION_ENABLED;
  });

  it('createDelegationProposalOnCanister POSTs frontmatter to canister', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ proposal_id: 'prop-canister-1', path: 'meta/agents/smoke.md', status: 'proposed' }),
      };
    };
    try {
      const proposal = await createDelegationProposalOnCanister({
        canisterUrl: 'https://canister.test',
        dataDir,
        sessionBound: true,
        headers: { 'X-User-Id': 'owner', 'X-Vault-Id': vaultId },
        input: {
          path: 'meta/agents/smoke.md',
          body: '{"schema":"knowtation.agent_identity/v0"}',
          intent: 'agent_identity_register',
          vault_id: vaultId,
          review_queue: 'delegation',
          proposed_by: 'google:owner-smoke',
          delegation_meta: { record_kind: 'agent_identity', agent_id: 'agent_smoke01' },
        },
      });
      assert.equal(proposal.proposal_id, 'prop-canister-1');
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/api\/v1\/proposals$/);
      const sent = JSON.parse(String(calls[0].init.body));
      assert.equal(sent.intent, 'agent_identity_register');
      assert.equal(sent.source, DELEGATION_PROPOSAL_SOURCE);
      assert.equal(sent.evaluation_status, 'pending');
      assert.equal(sent.frontmatter[FM_PROPOSAL_SOURCE], DELEGATION_PROPOSAL_SOURCE);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('createDelegationProposalOnCanister forwards canister error code', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({ error: 'Gateway authentication required', code: 'GATEWAY_AUTH_REQUIRED' }),
    });
    try {
      await assert.rejects(
        () =>
          createDelegationProposalOnCanister({
            canisterUrl: 'https://canister.test',
            dataDir,
            headers: { 'X-User-Id': 'owner', 'X-Vault-Id': vaultId },
            input: {
              path: 'meta/delegation/consents/x.md',
              body: '{}',
              intent: 'delegation_consent_create',
              review_queue: 'delegation',
              proposed_by: 'google:learner',
              delegation_meta: { record_kind: 'delegation_consent', consent_id: 'dcons_x' },
            },
          }),
        (err) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'GATEWAY_AUTH_REQUIRED');
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('applyApprovedDelegationProposalFromCanister updates bridge index after canister approve', async () => {
    const identity = makeAgentIdentity({ agentId: 'agent_l1b_smoke01' });
    const body = JSON.stringify(identity);
    const fm = mergeDelegationFrontmatter(
      { agent_id: identity.agent_id },
      { record_kind: 'agent_identity', agent_id: identity.agent_id },
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          proposal_id: 'prop-l1b-identity',
          path: 'meta/agents/l1b01.md',
          status: 'approved',
          vault_id: vaultId,
          intent: 'agent_identity_register',
          created_by: TEST_USER_ID,
          body,
          frontmatter: JSON.stringify(fm),
        }),
    });
    try {
      const result = await applyApprovedDelegationProposalFromCanister({
        dataDir,
        canisterUrl: 'https://canister.test',
        headers: { 'X-User-Id': 'owner', 'X-Vault-Id': vaultId },
        proposalId: 'prop-l1b-identity',
      });
      assert.equal(result.ok, true);
      assert.equal(result.payload.applied, true);
      const stored = getAgentIdentity(dataDir, vaultId, identity.agent_id);
      assert.ok(stored);
      assert.equal(stored.agent_id, identity.agent_id);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('7C-L1b delegation hosted proposal — e2e', () => {
  const dataDir = path.join(tmpRoot, 'e2e', 'data');
  const vaultId = 'Business';

  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, 'e2e'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.DELEGATION_ENABLED;
  });

  it('identity approve apply → consent approve apply → grant mint', async () => {
    const identity = makeAgentIdentity({ agentId: 'agent_l1b_e2e01' });
    const consentBody = makeDelegationConsent({
      consentId: 'dcons_l1b_e2e01',
      agentId: identity.agent_id,
    });

    const identityProposal = {
      proposal_id: 'prop-id-e2e',
      path: 'meta/agents/l1b_e2e.md',
      status: 'approved',
      vault_id: vaultId,
      intent: 'agent_identity_register',
      created_by: TEST_USER_ID,
      body: JSON.stringify(identity),
      frontmatter: JSON.stringify(
        mergeDelegationFrontmatter({}, { record_kind: 'agent_identity', agent_id: identity.agent_id }),
      ),
    };
    const consentProposal = {
      proposal_id: 'prop-consent-e2e',
      path: 'meta/delegation/consents/l1b_e2e.md',
      status: 'approved',
      vault_id: vaultId,
      intent: 'delegation_consent_create',
      created_by: TEST_USER_ID,
      body: JSON.stringify(consentBody),
      frontmatter: JSON.stringify(
        mergeDelegationFrontmatter({}, { record_kind: 'delegation_consent', consent_id: consentBody.consent_id }),
      ),
    };

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount += 1;
      const payload = fetchCount === 1 ? identityProposal : consentProposal;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    };

    try {
      const idApply = await applyApprovedDelegationProposalFromCanister({
        dataDir,
        canisterUrl: 'https://canister.test',
        headers: { 'X-User-Id': 'owner', 'X-Vault-Id': vaultId },
        proposalId: identityProposal.proposal_id,
      });
      assert.equal(idApply.ok, true);

      const consentApply = await applyApprovedDelegationProposalFromCanister({
        dataDir,
        canisterUrl: 'https://canister.test',
        headers: { 'X-User-Id': 'owner', 'X-Vault-Id': vaultId },
        proposalId: consentProposal.proposal_id,
      });
      assert.equal(consentApply.ok, true);

      const mint = handleDelegationGrantMintRequest({
        dataDir,
        vaultId,
        consentId: consentBody.consent_id,
        actorAgentId: identity.agent_id,
        taskRef: 'task_hw_week3',
      });
      assert.equal(mint.ok, true);
      assert.match(mint.payload.bearer, /^dgrnt_bearer_/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('7C-L1b delegation hosted proposal — stress', () => {
  it('normalize 200 canister rows without throwing', () => {
    for (let i = 0; i < 200; i += 1) {
      const fm = mergeDelegationFrontmatter({}, { record_kind: 'agent_identity', agent_id: `agent_st_${i}` });
      const out = normalizeCanisterProposalForDelegationPrecheck({
        proposal_id: `prop-${i}`,
        intent: 'agent_identity_register',
        frontmatter: JSON.stringify(fm),
        body: '{}',
      });
      assert.ok(out);
    }
  });
});

describe('7C-L1b delegation hosted proposal — data-integrity', () => {
  const dataDir = path.join(tmpRoot, 'di', 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, 'di'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.DELEGATION_ENABLED;
  });

  it('precheck + apply preserves consent evidence_ref with proposal id', () => {
    const identity = makeAgentIdentity({ agentId: 'agent_di_test01' });
    seedDelegationFixtures(dataDir, vaultId, identity);
    const consentBody = makeDelegationConsent({ consentId: 'dcons_di_test01', agentId: identity.agent_id });
    const proposal = normalizeCanisterProposalForDelegationPrecheck({
      proposal_id: 'prop-di-consent',
      status: 'approved',
      vault_id: vaultId,
      intent: 'delegation_consent_create',
      created_by: TEST_USER_ID,
      body: JSON.stringify(consentBody),
      frontmatter: JSON.stringify(
        mergeDelegationFrontmatter({}, { record_kind: 'delegation_consent', consent_id: consentBody.consent_id }),
      ),
    });
    assert.ok(proposal);
    const pre = precheckApprovedDelegationProposal(dataDir, proposal, { author: TEST_USER_ID });
    assert.equal(pre.ok, true);
    applyDelegationProposalToIndex(dataDir, pre);
    const stored = getConsent(dataDir, vaultId, consentBody.consent_id);
    assert.equal(stored.evidence_ref, 'proposal:prop-di-consent');
  });
});

describe('7C-L1b delegation hosted proposal — performance', () => {
  it('normalizeCanisterProposalForDelegationPrecheck completes 1000 rows under 500ms', () => {
    const fm = mergeDelegationFrontmatter({}, { record_kind: 'agent_identity', agent_id: 'agent_perf' });
    const row = {
      proposal_id: 'prop-perf',
      intent: 'agent_identity_register',
      frontmatter: JSON.stringify(fm),
      body: '{}',
    };
    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      normalizeCanisterProposalForDelegationPrecheck(row);
    }
    assert.ok(performance.now() - start < 500);
  });
});

describe('7C-L1b delegation hosted proposal — security', () => {
  const dataDir = path.join(tmpRoot, 'sec', 'data');

  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, 'sec'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.DELEGATION_ENABLED;
  });

  it('apply rejects non-delegation canister proposals', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          proposal_id: 'prop-script',
          path: 'projects/x/script-proposal.md',
          status: 'approved',
          intent: 'script_proposal',
          body: 'hello',
          frontmatter: '{}',
        }),
    });
    try {
      const result = await applyApprovedDelegationProposalFromCanister({
        dataDir,
        canisterUrl: 'https://canister.test',
        headers: { 'X-User-Id': 'owner', 'X-Vault-Id': 'default' },
        proposalId: 'prop-script',
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'BAD_REQUEST');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('apply rejects unapproved delegation proposals', async () => {
    const fm = mergeDelegationFrontmatter({}, { record_kind: 'agent_identity', agent_id: 'agent_sec01' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          proposal_id: 'prop-pending',
          status: 'proposed',
          intent: 'agent_identity_register',
          body: '{}',
          frontmatter: JSON.stringify(fm),
        }),
    });
    try {
      const result = await applyApprovedDelegationProposalFromCanister({
        dataDir,
        canisterUrl: 'https://canister.test',
        headers: { 'X-User-Id': 'owner', 'X-Vault-Id': 'default' },
        proposalId: 'prop-pending',
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'CONFLICT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
