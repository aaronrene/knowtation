/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 4 stress: N create+approve cycles; no cross-user leakage.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProposal, listProposals } from '../hub/proposals-store.mjs';
import { personalSelfApplyAllowsApprove, SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';

const N = 40;

describe('HOSTED-WRITE-EVAL-KN-b stress', () => {
  /** @type {string} */
  let dataDir;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-hwe-stress-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it(`${N} matching create cycles; partition ownership stays per-actor`, () => {
    const users = ['user:a', 'user:b'];
    /** @type {Map<string, string[]>} */
    const byUser = new Map(users.map((u) => [u, []]));

    for (let i = 0; i < N; i++) {
      const actor = users[i % users.length];
      const id = `stress-${i}`;
      const proposal = createProposal(dataDir, {
        path: `reviewed/${id}.md`,
        body: `body-${i}`,
        intent: SCOOLING_REVIEW_TRAY_INTENT,
        external_ref: `scooling.review:${id}`,
        evaluationRequired: true,
        proposed_by: actor,
        vault_id: 'default',
      });
      assert.equal(proposal.evaluation_status, 'passed');
      assert.equal(
        personalSelfApplyAllowsApprove({
          proposal,
          hasVaultWrite: true,
          partitionOwned: proposal.proposed_by === actor,
          role: 'member',
        }),
        true,
      );
      // Cross-user: other actor must not claim partition ownership for this row.
      const other = users[(i + 1) % users.length];
      assert.equal(
        personalSelfApplyAllowsApprove({
          proposal,
          hasVaultWrite: true,
          partitionOwned: proposal.proposed_by === other,
          role: 'member',
        }),
        false,
      );
      byUser.get(actor).push(proposal.proposal_id);
    }

    const all = listProposals(dataDir, { limit: 500 });
    assert.equal(all.total, N);
    for (const [actor, ids] of byUser) {
      for (const pid of ids) {
        const row = all.proposals.find((p) => p.proposal_id === pid);
        assert.ok(row);
        assert.equal(row.proposed_by, actor);
      }
    }
  });
});
