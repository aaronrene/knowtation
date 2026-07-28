/**
 * SEC-KN-4 — seven-tier coverage for delegation principal binding at apply + authorship.
 *
 * Frozen spec: docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md (R1–R9)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import {
  hashPrincipalRef,
  precheckApprovedDelegationProposal,
  applyDelegationProposalToIndex,
  handleDelegationGrantMintRequest,
  handleAgentIdentityRegisterProposeRequest,
  seedDelegationFixtures,
  getConsent,
  getAgentIdentity,
  DELEGATION_PROPOSAL_SOURCE,
  DELEGATION_CONSENTS_FILE,
  DELEGATION_IDENTITIES_FILE,
  DELEGATION_POLICY_FILE,
  validateAgentIdentityRecord,
  validateConsentRecord,
} from '../lib/agent/delegation.mjs';
import {
  applyApprovedDelegationProposalFromCanister,
  mergeDelegationFrontmatter,
  normalizeCanisterProposalForDelegationPrecheck,
} from '../lib/agent/delegation-hosted-proposal.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { matchesScoolingReviewTrayFingerprint } from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_USER_ID,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIGRATION_MO = path.join(ROOT, 'hub/icp/src/hub/Migration.mo');
const MAIN_MO = path.join(ROOT, 'hub/icp/src/hub/main.mo');
const DELEGATION_ROUTES = path.join(ROOT, 'hub/bridge/delegation-routes.mjs');
const HOSTED_PROPOSAL_SRC = path.join(ROOT, 'lib/agent/delegation-hosted-proposal.mjs');
const SERVER_SRC = path.join(ROOT, 'hub/server.mjs');

const ATTACKER_USER = 'attacker-user-id';
const VICTIM_USER = 'victim-user-id';
const ATTACKER_PRINCIPAL = hashPrincipalRef(ATTACKER_USER);
const VICTIM_PRINCIPAL = hashPrincipalRef(VICTIM_USER);
const PARTITION_OWNER = 'workspace-owner-uid';

function mkDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kt-sec-kn-4-'));
}

function enableGate(dataDir) {
  writeDelegationPolicy(dataDir);
  process.env.DELEGATION_ENABLED = '1';
}

function delegationProposal(dataDir, body, meta, authorFields = {}) {
  return {
    proposal_id: 'prop-sec-kn-4',
    source: DELEGATION_PROPOSAL_SOURCE,
    vault_id: 'default',
    body: JSON.stringify(body),
    delegation_meta: meta,
    ...authorFields,
  };
}

/**
 * Pre-fix apply path (body-trusted) — replica of delegation.mjs:846-877 before SEC-KN-4.
 *
 * @param {string} dataDir
 * @param {object} proposal
 */
function precheckLegacyBodyTrusted(dataDir, proposal) {
  if (proposal.source !== DELEGATION_PROPOSAL_SOURCE) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Not a delegation proposal' };
  }
  const meta = proposal.delegation_meta;
  if (!meta || typeof meta !== 'object' || typeof meta.record_kind !== 'string') {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Missing delegation_meta' };
  }
  let record;
  try {
    record = JSON.parse(proposal.body ?? '{}');
  } catch {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Proposal body is not valid JSON' };
  }
  const vaultId =
    typeof proposal.vault_id === 'string' && proposal.vault_id.trim()
      ? proposal.vault_id.trim()
      : 'default';
  if (meta.record_kind === 'agent_identity') {
    const v = validateAgentIdentityRecord(record);
    if (!v.ok) return { ok: false, status: 400, code: 'BAD_REQUEST', error: v.error };
    const existing = getAgentIdentity(dataDir, vaultId, record.agent_id);
    if (existing) {
      return { ok: false, status: 409, code: 'CONFLICT', error: 'Agent identity already registered' };
    }
  } else if (meta.record_kind === 'delegation_consent') {
    const v = validateConsentRecord(record);
    if (!v.ok) return { ok: false, status: 400, code: 'BAD_REQUEST', error: v.error };
    record.evidence_ref = `proposal:${proposal.proposal_id}`;
    const identity = getAgentIdentity(dataDir, vaultId, record.delegate_agent_id);
    if (!identity || identity.status !== 'active') {
      return { ok: false, status: 403, code: 'DELEGATION_IDENTITY_DENIED', error: 'Delegate agent not active' };
    }
  } else {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Unknown delegation record kind' };
  }
  return { ok: true, vaultId, recordKind: meta.record_kind, record };
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-KN-4 unit — principal binding + author gate', () => {
  test('hashPrincipalRef is deterministic for the author', () => {
    assert.equal(hashPrincipalRef(TEST_USER_ID), TEST_PRINCIPAL_REF);
    assert.equal(hashPrincipalRef(TEST_USER_ID), hashPrincipalRef(TEST_USER_ID));
  });

  test('R3 mismatch → DELEGATION_PRINCIPAL_REBIND_MISMATCH', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_mismatch01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_mismatch01',
        agentId: identity.agent_id,
      });
      body.principal_ref = VICTIM_PRINCIPAL;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const result = precheckApprovedDelegationProposal(dir, proposal, { author: ATTACKER_USER });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'DELEGATION_PRINCIPAL_REBIND_MISMATCH');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R3 match → applied record principal_ref equals derived', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_match_test01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_match_test01',
        agentId: identity.agent_id,
      });
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const result = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(result.ok, true);
      assert.equal(result.record.principal_ref, TEST_PRINCIPAL_REF);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R4 owner_ref mismatch → DELEGATION_OWNER_REBIND_MISMATCH', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const body = makeAgentIdentity({ agentId: 'agent_owner_mm01' });
      body.owner_ref = VICTIM_PRINCIPAL;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'agent_identity',
        agent_id: body.agent_id,
      });
      const result = precheckApprovedDelegationProposal(dir, proposal, { author: ATTACKER_USER });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'DELEGATION_OWNER_REBIND_MISMATCH');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R5 org_ref principal and owner → DELEGATION_ORG_REF_UNSUPPORTED', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_org01' });
      seedDelegationFixtures(dir, 'default', identity);
      const consentBody = makeDelegationConsent({
        consentId: 'dcons_org01',
        agentId: identity.agent_id,
      });
      consentBody.principal_ref = 'org_ref:ws_evil';
      const consentProposal = delegationProposal(dir, consentBody, {
        record_kind: 'delegation_consent',
        consent_id: consentBody.consent_id,
      });
      const consentResult = precheckApprovedDelegationProposal(dir, consentProposal, {
        author: TEST_USER_ID,
      });
      assert.equal(consentResult.code, 'DELEGATION_ORG_REF_UNSUPPORTED');

      const idBody = makeAgentIdentity({ agentId: 'agent_org02' });
      idBody.owner_ref = 'org_ref:ws_evil';
      const idProposal = delegationProposal(dir, idBody, {
        record_kind: 'agent_identity',
        agent_id: idBody.agent_id,
      });
      const idResult = precheckApprovedDelegationProposal(dir, idProposal, { author: TEST_USER_ID });
      assert.equal(idResult.code, 'DELEGATION_ORG_REF_UNSUPPORTED');

      // R5 is worded on the body's principal_ref OR owner_ref, independent of kind.
      // A consent body smuggling org_ref in owner_ref must refuse too, even though
      // validateConsentRecord never reads owner_ref.
      const crossBody = makeDelegationConsent({
        consentId: 'dcons_org02',
        agentId: identity.agent_id,
      });
      crossBody.owner_ref = 'org_ref:ws_evil';
      const crossProposal = delegationProposal(dir, crossBody, {
        record_kind: 'delegation_consent',
        consent_id: crossBody.consent_id,
      });
      const crossResult = precheckApprovedDelegationProposal(dir, crossProposal, {
        author: TEST_USER_ID,
      });
      assert.equal(crossResult.code, 'DELEGATION_ORG_REF_UNSUPPORTED');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R2 author failures → DELEGATION_AUTHOR_UNVERIFIED', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_auth01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_auth01',
        agentId: identity.agent_id,
      });
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      for (const author of ['', '   ', 'x'.repeat(129), 'bad char!']) {
        const result = precheckApprovedDelegationProposal(dir, proposal, { author });
        assert.equal(result.code, 'DELEGATION_AUTHOR_UNVERIFIED', `author=${JSON.stringify(author)}`);
      }
      assert.equal(
        precheckApprovedDelegationProposal(dir, proposal, undefined).code,
        'DELEGATION_AUTHOR_UNVERIFIED',
      );
      assert.equal(
        precheckApprovedDelegationProposal(dir, { ...proposal, _knowtation_backup_json_unparseable: true }, {
          author: TEST_USER_ID,
        }).code,
        'DELEGATION_AUTHOR_UNVERIFIED',
      );
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R7 gate off → DELEGATION_DISABLED; policy forbidden → DELEGATION_POLICY_FORBIDDEN', () => {
    const dir = mkDataDir();
    try {
      delete process.env.DELEGATION_ENABLED;
      const identity = makeAgentIdentity({ agentId: 'agent_gate01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_gate01',
        agentId: identity.agent_id,
      });
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const off = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(off.code, 'DELEGATION_DISABLED');

      fs.writeFileSync(
        path.join(dir, 'hub_delegation_policy.json'),
        JSON.stringify({ delegation: { enabled: true, forbidden: true } }),
        'utf8',
      );
      process.env.DELEGATION_ENABLED = '1';
      const forbidden = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(forbidden.code, 'DELEGATION_POLICY_FORBIDDEN');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration
// ---------------------------------------------------------------------------
describe('SEC-KN-4 integration — call sites + canister contracts', () => {
  test('self-hosted approve passes proposal.proposed_by as author', () => {
    const src = fs.readFileSync(SERVER_SRC, 'utf8');
    assert.match(src, /precheckApprovedDelegationProposal\(config\.data_dir, proposal, \{/);
    assert.match(src, /author: typeof proposal\.proposed_by === 'string' \? proposal\.proposed_by : ''/);
  });

  test('hosted apply passes canister created_by as author', () => {
    const src = fs.readFileSync(HOSTED_PROPOSAL_SRC, 'utf8');
    assert.match(src, /precheckApprovedDelegationProposal\(opts\.dataDir, proposal, \{/);
    assert.match(src, /author: typeof proposal\.created_by === 'string' \? proposal\.created_by : ''/);
  });

  test('CONFLICT idempotency unreachable when R2–R5 refuse', async () => {
    const dir = mkDataDir();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          proposal_id: 'prop-idem',
          status: 'approved',
          intent: 'delegation_consent_create',
          body: JSON.stringify(
            makeDelegationConsent({ consentId: 'dcons_idem01', agentId: 'agent_tutor_test01' }),
          ),
          frontmatter: JSON.stringify(
            mergeDelegationFrontmatter({}, {
              record_kind: 'delegation_consent',
              consent_id: 'dcons_idem01',
            }),
          ),
          created_by: '',
        }),
    });
    try {
      enableGate(dir);
      const identity = makeAgentIdentity();
      seedDelegationFixtures(dir, 'default', identity);
      const result = await applyApprovedDelegationProposalFromCanister({
        dataDir: dir,
        canisterUrl: 'https://canister.test',
        headers: {},
        proposalId: 'prop-idem',
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'DELEGATION_AUTHOR_UNVERIFIED');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('absent/empty principal_ref re-derived before validateConsentRecord', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_rederive01' });
      seedDelegationFixtures(dir, 'default', identity);
      for (const [label, principalRef] of [
        ['absent', undefined],
        ['empty', ''],
        ['non_string', 42],
      ]) {
        const body = makeDelegationConsent({
          consentId: `dcons_rederive_${label}`,
          agentId: identity.agent_id,
        });
        delete body.principal_ref;
        if (principalRef !== undefined) body.principal_ref = principalRef;
        const proposal = delegationProposal(dir, body, {
          record_kind: 'delegation_consent',
          consent_id: body.consent_id,
        });
        const result = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
        assert.equal(result.ok, true, `case=${label}`);
        assert.equal(result.record.principal_ref, TEST_PRINCIPAL_REF);
      }
      {
        const body = makeDelegationConsent({
          consentId: 'dcons_rederive_ws',
          agentId: identity.agent_id,
        });
        body.principal_ref = '   ';
        const proposal = delegationProposal(dir, body, {
          record_kind: 'delegation_consent',
          consent_id: body.consent_id,
        });
        const result = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
        assert.equal(result.ok, true, 'whitespace-only principal_ref');
        assert.equal(result.record.principal_ref, TEST_PRINCIPAL_REF);
      }
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-empty differing principal_ref refuses even when well-formed', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_wellformed01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_wellformed01',
        agentId: identity.agent_id,
      });
      body.principal_ref = VICTIM_PRINCIPAL;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const result = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(result.code, 'DELEGATION_PRINCIPAL_REBIND_MISMATCH');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('canister create + GET serializers emit created_by; no userId fallback', () => {
    const main = fs.readFileSync(MAIN_MO, 'utf8');
    assert.match(main, /func createdByFromRequest\(req : HttpRequest\) : Text/);
    assert.match(main, /created_by = createdBy/);
    assert.match(main, /getHeader\(req, "X-Actor-Id"\)/);
    assert.doesNotMatch(main, /created_by = userId\(req\)/);
    assert.match(main, /\\"created_by\\":\\"/);
  });

  test('Migration.mo pins V5/V6/V7 to ProposalRecordV7 and _proposalV7ToCurrent + TODO(SEC-KN-4c)', () => {
    const migration = fs.readFileSync(MIGRATION_MO, 'utf8');
    assert.match(migration, /public type ProposalRecordV7/);
    assert.match(migration, /proposalEntries : \[\(Text, \[ProposalRecordV7\]\)\];/);
    assert.match(migration, /func _proposalV7ToCurrent\(p : ProposalRecordV7\) : ProposalRecord/);
    assert.match(migration, /TODO\(SEC-KN-4c\)/);
    assert.match(
      migration,
      /func _proposalBeforeEnrichToCurrent\(p : ProposalRecordBeforeEnrich\) : ProposalRecordV7/,
    );
    assert.match(migration, /func _proposalV4ToV5\(p : ProposalRecordV4\) : ProposalRecordV7/);
  });

  test('npm run canister:verify-migration exits 0', () => {
    execSync('npm run canister:verify-migration', { cwd: ROOT, stdio: 'pipe' });
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e
// ---------------------------------------------------------------------------
describe('SEC-KN-4 e2e — honest and hostile apply paths', () => {
  test('honest path: author A → apply → mint grant principal equals hash(A)', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_honest01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_honest01',
        agentId: identity.agent_id,
      });
      const proposal = createProposal(dir, {
        path: 'meta/delegation/consents/honest.md',
        body: JSON.stringify(body),
        intent: 'delegation_consent_create',
        source: DELEGATION_PROPOSAL_SOURCE,
        vault_id: 'default',
        proposed_by: TEST_USER_ID,
        delegation_meta: { record_kind: 'delegation_consent', consent_id: body.consent_id },
      });
      const pre = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(pre.ok, true);
      applyDelegationProposalToIndex(dir, pre);
      const mint = handleDelegationGrantMintRequest({
        dataDir: dir,
        vaultId: 'default',
        consentId: body.consent_id,
        actorAgentId: identity.agent_id,
      });
      assert.equal(mint.ok, true);
      assert.equal(mint.payload.grant.principal_ref, TEST_PRINCIPAL_REF);
      assert.ok(mint.payload.bearer?.startsWith('dgrnt_bearer_'));
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('hostile path: body names victim B, author A → refuse, no consent row, mint unknown', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_hostile01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_hostile01',
        agentId: identity.agent_id,
      });
      body.principal_ref = VICTIM_PRINCIPAL;
      const proposal = createProposal(dir, {
        path: 'meta/delegation/consents/hostile.md',
        body: JSON.stringify(body),
        intent: 'delegation_consent_create',
        source: DELEGATION_PROPOSAL_SOURCE,
        vault_id: 'default',
        proposed_by: ATTACKER_USER,
        delegation_meta: { record_kind: 'delegation_consent', consent_id: body.consent_id },
      });
      const pre = precheckApprovedDelegationProposal(dir, proposal, { author: ATTACKER_USER });
      assert.equal(pre.ok, false);
      assert.equal(pre.code, 'DELEGATION_PRINCIPAL_REBIND_MISMATCH');
      assert.equal(getConsent(dir, 'default', body.consent_id), null);
      const mint = handleDelegationGrantMintRequest({
        dataDir: dir,
        vaultId: 'default',
        consentId: body.consent_id,
        actorAgentId: identity.agent_id,
      });
      assert.equal(mint.code, 'unknown_consent');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-KN-4 stress — alternating honest/hostile applies', () => {
  test('200 applies: hostile refuses, honest applies, no store corruption', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_stress01' });
      seedDelegationFixtures(dir, 'default', identity);
      let honestCount = 0;
      for (let i = 0; i < 200; i += 1) {
        const hostile = i % 2 === 0;
        const body = makeDelegationConsent({
          consentId: `dcons_stress_${String(i).padStart(3, '0')}`,
          agentId: identity.agent_id,
        });
        if (hostile) body.principal_ref = VICTIM_PRINCIPAL;
        const proposal = delegationProposal(dir, body, {
          record_kind: 'delegation_consent',
          consent_id: body.consent_id,
        });
        const pre = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
        if (hostile) {
          assert.equal(pre.ok, false);
        } else {
          assert.equal(pre.ok, true);
          applyDelegationProposalToIndex(dir, pre);
          honestCount += 1;
        }
      }
      const store = JSON.parse(fs.readFileSync(path.join(dir, DELEGATION_CONSENTS_FILE), 'utf8'));
      assert.equal(store.vaults.default.consents.length, honestCount);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-KN-4 data-integrity — refused applies + idempotent identity', () => {
  test('refused applies leave consent/identity stores byte-identical', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_di_refuse01' });
      seedDelegationFixtures(dir, 'default', identity);
      const identitiesBefore = fs.readFileSync(path.join(dir, DELEGATION_IDENTITIES_FILE), 'utf8');
      const consentsPath = path.join(dir, DELEGATION_CONSENTS_FILE);
      const consentsBefore = fs.existsSync(consentsPath) ? fs.readFileSync(consentsPath, 'utf8') : null;
      const body = makeDelegationConsent({
        consentId: 'dcons_di_refuse01',
        agentId: identity.agent_id,
      });
      body.principal_ref = VICTIM_PRINCIPAL;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const pre = precheckApprovedDelegationProposal(dir, proposal, { author: ATTACKER_USER });
      assert.equal(pre.ok, false);
      assert.equal(
        fs.readFileSync(path.join(dir, DELEGATION_IDENTITIES_FILE), 'utf8'),
        identitiesBefore,
      );
      if (consentsBefore === null) {
        assert.equal(fs.existsSync(consentsPath), false);
      } else {
        assert.equal(fs.readFileSync(consentsPath, 'utf8'), consentsBefore);
      }
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('applied record persists derived principal even when body differed (whitespace-only body)', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_di_persist01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_di_persist01',
        agentId: identity.agent_id,
      });
      body.principal_ref = '   ';
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const pre = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(pre.ok, true);
      applyDelegationProposalToIndex(dir, pre);
      const stored = getConsent(dir, 'default', body.consent_id);
      assert.equal(stored.principal_ref, TEST_PRINCIPAL_REF);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('re-applying agent_identity stays idempotent (CONFLICT)', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const body = makeAgentIdentity({ agentId: 'agent_di_idem01' });
      const proposal = delegationProposal(dir, body, {
        record_kind: 'agent_identity',
        agent_id: body.agent_id,
      });
      const first = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(first.ok, true);
      applyDelegationProposalToIndex(dir, first);
      const second = precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      assert.equal(second.ok, false);
      assert.equal(second.code, 'CONFLICT');
      const stored = getAgentIdentity(dir, 'default', body.agent_id);
      assert.equal(stored.owner_ref, TEST_PRINCIPAL_REF);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-KN-4 performance — precheck bounded wall-clock', () => {
  test('1000 precheck calls complete within generous local budget', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_perf01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_perf01',
        agentId: identity.agent_id,
      });
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const start = performance.now();
      for (let i = 0; i < 1000; i += 1) {
        precheckApprovedDelegationProposal(dir, proposal, { author: TEST_USER_ID });
      }
      assert.ok(performance.now() - start < 5000, '1000 prechecks should finish within 5s locally');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('author binding adds no filesystem read beyond the existing store loads', () => {
    const dir = mkDataDir();
    const realReadFileSync = fs.readFileSync;
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_perf02' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_perf02',
        agentId: identity.agent_id,
      });
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });

      // Count reads for a refused call (author fails before any re-derivation work)
      // and for an accepted one. R2-R5 are pure string/hash operations, so the
      // accepted path must not read more files than the refusal plus the store loads
      // the pre-SEC-KN-4 code already performed.
      const countReads = (author) => {
        const seen = [];
        fs.readFileSync = (p, ...rest) => {
          seen.push(String(p));
          return realReadFileSync(p, ...rest);
        };
        try {
          precheckApprovedDelegationProposal(dir, proposal, { author });
        } finally {
          fs.readFileSync = realReadFileSync;
        }
        return seen;
      };

      const allowed = [
        DELEGATION_POLICY_FILE,
        DELEGATION_CONSENTS_FILE,
        DELEGATION_IDENTITIES_FILE,
      ];
      const refusedReads = countReads('');
      const acceptedReads = countReads(TEST_USER_ID);

      for (const p of [...refusedReads, ...acceptedReads]) {
        assert.ok(
          allowed.some((f) => p.includes(f)),
          `unexpected filesystem read during precheck: ${p}`,
        );
      }
      assert.ok(
        acceptedReads.length <= allowed.length,
        `precheck should read at most the gate policy plus the two stores, saw ${acceptedReads.length}`,
      );
      assert.ok(
        refusedReads.length <= acceptedReads.length,
        'author refusal must not read more than an accepted apply',
      );
    } finally {
      fs.readFileSync = realReadFileSync;
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security
// ---------------------------------------------------------------------------
describe('SEC-KN-4 security — regression + anti-regressions', () => {
  test('legacy body-trusted accepts attacker principal; fixed refuses', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_sec_reg01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_sec_reg01',
        agentId: identity.agent_id,
      });
      body.principal_ref = VICTIM_PRINCIPAL;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const legacy = precheckLegacyBodyTrusted(dir, proposal);
      assert.equal(legacy.ok, true);
      assert.equal(legacy.record.principal_ref, VICTIM_PRINCIPAL);
      const fixed = precheckApprovedDelegationProposal(dir, proposal, { author: ATTACKER_USER });
      assert.equal(fixed.ok, false);
      assert.equal(fixed.code, 'DELEGATION_PRINCIPAL_REBIND_MISMATCH');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refusal payloads contain no bearer, author, or derived hash', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_sec_leak01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_sec_leak01',
        agentId: identity.agent_id,
      });
      body.principal_ref = VICTIM_PRINCIPAL;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const result = precheckApprovedDelegationProposal(dir, proposal, { author: ATTACKER_USER });
      const payload = JSON.stringify(result);
      assert.equal(payload.includes('dgrnt_bearer_'), false);
      assert.equal(payload.includes(ATTACKER_USER), false);
      assert.equal(payload.includes(VICTIM_PRINCIPAL), false);
      assert.equal(payload.includes(ATTACKER_PRINCIPAL), false);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('org_ref stored consent cannot mint grant', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_sec_orgmint01' });
      const consent = makeDelegationConsent({
        consentId: 'dcons_sec_orgmint01',
        agentId: identity.agent_id,
      });
      consent.principal_ref = 'org_ref:ws_legacy';
      seedDelegationFixtures(dir, 'default', identity, consent);
      const mint = handleDelegationGrantMintRequest({
        dataDir: dir,
        vaultId: 'default',
        consentId: consent.consent_id,
        actorAgentId: identity.agent_id,
      });
      assert.equal(mint.code, 'DELEGATION_CONSENT_PRINCIPAL_INVALID');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('approver ≠ author: principal stays author-derived (§3.1 anti-regression)', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_sec_approver01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_sec_approver01',
        agentId: identity.agent_id,
      });
      delete body.principal_ref;
      const proposal = delegationProposal(dir, body, {
        record_kind: 'delegation_consent',
        consent_id: body.consent_id,
      });
      const memberAuthor = 'member:alice';
      const ownerApprover = PARTITION_OWNER;
      const pre = precheckApprovedDelegationProposal(dir, proposal, { author: memberAuthor });
      assert.equal(pre.ok, true);
      assert.equal(pre.record.principal_ref, hashPrincipalRef(memberAuthor));
      assert.notEqual(pre.record.principal_ref, hashPrincipalRef(ownerApprover));
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R1.5: empty created_by refuses; never binds to partition owner', () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const identity = makeAgentIdentity({ agentId: 'agent_sec_empty01' });
      seedDelegationFixtures(dir, 'default', identity);
      const body = makeDelegationConsent({
        consentId: 'dcons_sec_empty01',
        agentId: identity.agent_id,
      });
      delete body.principal_ref;
      const proposal = normalizeCanisterProposalForDelegationPrecheck({
        proposal_id: 'prop-empty-author',
        status: 'approved',
        vault_id: 'default',
        intent: 'delegation_consent_create',
        created_by: '',
        body: JSON.stringify(body),
        frontmatter: JSON.stringify(
          mergeDelegationFrontmatter({}, {
            record_kind: 'delegation_consent',
            consent_id: body.consent_id,
          }),
        ),
      });
      assert.ok(proposal);
      const pre = precheckApprovedDelegationProposal(dir, proposal, { author: '' });
      assert.equal(pre.code, 'DELEGATION_AUTHOR_UNVERIFIED');
      assert.equal(pre.ok, false);

      // The refusal must not have bound the consent to the partition owner. Both the
      // returned record and the persisted store are checked: a fallback to the owner
      // would surface as the owner's derived principal in one of them.
      const ownerDerived = hashPrincipalRef(PARTITION_OWNER);
      assert.equal(pre.record, undefined);
      const consentsPath = path.join(dir, DELEGATION_CONSENTS_FILE);
      const persisted = fs.existsSync(consentsPath)
        ? fs.readFileSync(consentsPath, 'utf8')
        : '';
      assert.ok(!persisted.includes(ownerDerived), 'owner principal must never be persisted');
      assert.ok(!persisted.includes(body.consent_id), 'refused consent must not be stored');
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('R8: bridge apply uses effectiveCanisterUid partition (no cross-partition fetch)', () => {
    const src = fs.readFileSync(DELEGATION_ROUTES, 'utf8');
    assert.match(src, /'X-User-Id': hctx\.effectiveCanisterUid/);
    assert.match(src, /applyApprovedDelegationProposalFromCanister/);
  });

  test('R9: delegation intents absent from personal self-apply fingerprint class', () => {
    assert.equal(
      matchesScoolingReviewTrayFingerprint({ intent: 'delegation_consent_create', path: 'x', external_ref: 'y' }),
      false,
    );
    assert.equal(
      matchesScoolingReviewTrayFingerprint({ intent: 'agent_identity_register', path: 'x', external_ref: 'y' }),
      false,
    );
  });

  test('R6: identity propose always derives owner_ref from session userId', async () => {
    const dir = mkDataDir();
    try {
      enableGate(dir);
      const created = [];
      const result = await handleAgentIdentityRegisterProposeRequest({
        dataDir: dir,
        vaultId: 'default',
        userId: TEST_USER_ID,
        kind: 'delegate',
        agentId: 'agent_r6_test01',
        createProposal: (_dataDir, input) => {
          created.push(input);
          return { proposal_id: 'prop-r6' };
        },
      });
      assert.equal(result.ok, true);
      const body = JSON.parse(created[0].body);
      assert.equal(body.owner_ref, TEST_PRINCIPAL_REF);
    } finally {
      delete process.env.DELEGATION_ENABLED;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
