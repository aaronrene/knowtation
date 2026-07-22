/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 3 e2e: Node Hub propose+approve applies note under reviewed/.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProposal, getProposal, updateProposalStatus, evaluationAllowsApprove } from '../hub/proposals-store.mjs';
import { personalSelfApplyAllowsApprove, SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import { writeNote } from '../lib/write.mjs';
import { readNote } from '../lib/vault.mjs';

describe('HOSTED-WRITE-EVAL-KN-b e2e — propose+approve apply', () => {
  /** @type {string} */
  let dataDir;
  /** @type {string} */
  let vaultPath;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-hwe-e2e-'));
    vaultPath = path.join(dataDir, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('member-class actor create+approve writes reviewed/*.md', async () => {
    const actor = 'google:learner';
    const notePath = 'reviewed/e2e-self-apply.md';
    const body = '# Applied note\n\nhello';
    const proposal = createProposal(dataDir, {
      path: notePath,
      body,
      intent: SCOOLING_REVIEW_TRAY_INTENT,
      external_ref: 'scooling.review:e2e-self-apply',
      evaluationRequired: true,
      proposed_by: actor,
      source: 'human',
    });
    assert.equal(proposal.evaluation_status, 'passed');
    assert.equal(evaluationAllowsApprove(proposal), true);
    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal,
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      true,
    );

    await writeNote(vaultPath, proposal.path, {
      body: proposal.body,
      frontmatter: proposal.frontmatter || {},
    });
    updateProposalStatus(dataDir, proposal.proposal_id, 'approved');

    const onDisk = readNote(vaultPath, notePath);
    assert.equal(onDisk.body.trimEnd(), body.trimEnd());
    assert.equal(getProposal(dataDir, proposal.proposal_id).status, 'approved');
    assert.match(notePath, /^reviewed\/.+\.md$/);
  });
});
