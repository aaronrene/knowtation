/**
 * HOSTED-WRITE-EVAL-KN-b — Tier 5 data-integrity: path/body, audit fields, not left pending.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProposal, getProposal, updateProposalStatus } from '../hub/proposals-store.mjs';
import { augmentProposalCreateRequestBody } from '../lib/hub-proposal-create-augment.mjs';
import { SCOOLING_REVIEW_TRAY_INTENT } from '../lib/hub-proposal-personal-self-apply.mjs';
import { writeNote } from '../lib/write.mjs';
import { readNote } from '../lib/vault.mjs';

describe('HOSTED-WRITE-EVAL-KN-b data-integrity', () => {
  /** @type {string} */
  let dataDir;
  /** @type {string} */
  let vaultPath;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-hwe-di-'));
    vaultPath = path.join(dataDir, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('applied note path/body match proposal; evaluated_by + external_ref preserved; not pending', async () => {
    const actor = 'github:ops';
    const notePath = 'reviewed/di-note.md';
    const bodyText = 'integrity body';
    const ext = 'scooling.review:di-note';
    const augmented = augmentProposalCreateRequestBody(
      {
        path: notePath,
        body: bodyText,
        intent: SCOOLING_REVIEW_TRAY_INTENT,
        external_ref: ext,
        labels: [],
      },
      dataDir,
      { evaluationRequired: true, evaluatedBy: actor },
    );
    assert.equal(augmented.evaluation_status, 'passed');

    const proposal = createProposal(dataDir, {
      path: notePath,
      body: bodyText,
      intent: SCOOLING_REVIEW_TRAY_INTENT,
      external_ref: ext,
      evaluationRequired: true,
      proposed_by: actor,
    });
    assert.equal(proposal.evaluation_status, 'passed');
    assert.equal(proposal.evaluated_by, actor);
    assert.ok(proposal.evaluated_at);
    assert.equal(proposal.external_ref, ext);

    await writeNote(vaultPath, proposal.path, { body: proposal.body, frontmatter: {} });
    updateProposalStatus(dataDir, proposal.proposal_id, 'approved', { external_ref: ext });

    const disk = readNote(vaultPath, notePath);
    assert.equal(disk.body.trimEnd(), bodyText.trimEnd());
    const stored = getProposal(dataDir, proposal.proposal_id);
    assert.equal(stored.status, 'approved');
    assert.notEqual(stored.evaluation_status, 'pending');
    assert.equal(stored.evaluation_status, 'passed');
    assert.equal(stored.external_ref, ext);
    assert.equal(stored.evaluated_by, actor);
  });
});
