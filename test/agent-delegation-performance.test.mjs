/**
 * Tier 6 — PERFORMANCE: validateChain and mint bounded on fixture store.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDelegationGrantMintRequest,
  validateChain,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import {
  writeDelegationPolicy,
  makeAgentIdentity,
  makeDelegationConsent,
  TEST_PRINCIPAL_REF,
} from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-agent-delegation-performance');

describe('Agent delegation — performance', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
    const identity = makeAgentIdentity({ agentId: 'agent_perf_test01' });
    seedDelegationFixtures(dataDir, vaultId, identity);
    for (let i = 0; i < 100; i++) {
      const consent = makeDelegationConsent({
        consentId: `dcons_perf_${String(i).padStart(4, '0')}`,
        agentId: identity.agent_id,
        taskIds: [],
        flowIds: [],
      });
      seedDelegationFixtures(dataDir, vaultId, identity, consent);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.DELEGATION_ENABLED;
  });

  it('mint + validateChain p95 under 500ms on 100-consent fixture', () => {
    const identity = makeAgentIdentity({ agentId: 'agent_perf_test01' });
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const consentId = `dcons_perf_${String(i).padStart(4, '0')}`;
      const t0 = performance.now();
      const mint = handleDelegationGrantMintRequest({
        dataDir,
        vaultId,
        consentId,
        actorAgentId: identity.agent_id,
      });
      assert.equal(mint.ok, true);
      const chain = validateChain({
        dataDir,
        vaultId,
        actorAgentId: identity.agent_id,
        principalRef: TEST_PRINCIPAL_REF,
        grantId: mint.payload.grant.grant_id,
        requireGrant: true,
      });
      assert.equal(chain.ok, true);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
    assert.ok(p95 < 500, `p95 ${p95}ms exceeds 500ms budget`);
  });
});
