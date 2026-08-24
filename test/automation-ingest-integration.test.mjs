/**
 * AIP-b integration: pack load, PUT rules, route+execute review_queue, from-template.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listPackTemplates,
  normalizeRuleForSave,
  mintRuleId,
  processAutomationIngest,
} from '../lib/automation-ingest-policy.mjs';
import {
  loadIngestRulesForSub,
  saveIngestRulesForSub,
} from '../hub/gateway/automation-ingest-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { augmentProposalCreateRequestBody } from '../lib/hub-proposal-create-augment.mjs';
import { loadReviewTriggers } from '../lib/hub-proposal-review-triggers.mjs';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aip-int-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('automation ingest integration', () => {
  it('load pack disabled; PUT rules; from-template stays disabled unless enable', async () => {
    const templates = listPackTemplates();
    assert.ok(templates.every((t) => t.enabled === false));
    const empty = await loadIngestRulesForSub('user:1', tmp);
    assert.deepEqual(empty.rules, []);
    const rule = normalizeRuleForSave({
      label: 'mine',
      disposition: 'review_queue',
      match: { path_prefix: 'inbox/trends/' },
    });
    await saveIngestRulesForSub('user:1', [rule], tmp);
    const loaded = await loadIngestRulesForSub('user:1', tmp);
    assert.equal(loaded.rules.length, 1);
    assert.equal(loaded.rules[0].label, 'mine');

    const copiedOff = normalizeRuleForSave(
      { ...templates[0], rule_id: mintRuleId(), enabled: false },
      { mintMissingId: false }
    );
    assert.equal(copiedOff.enabled, false);
    const copiedOn = normalizeRuleForSave(
      { ...templates[0], rule_id: mintRuleId(), enabled: true },
      { mintMissingId: false }
    );
    assert.equal(copiedOn.enabled, true);
  });

  it('route + execute review_queue creates a proposal', async () => {
    const audits = [];
    const io = {
      async getIdempotency() { return null; },
      async putIdempotency() {},
      async appendAudit(action, detail, proposalId) { audits.push({ action, detail, proposalId }); },
      async runBilling() { return true; },
      async readExistingNote() { return null; },
      async writeNote() { throw new Error('should not write'); },
      async createProposal(payload) {
        const augmented = augmentProposalCreateRequestBody(payload, tmp, {
          evaluationRequired: false,
          sessionBound: false,
          evaluatedBy: 'user:1',
        });
        return createProposal(tmp, { ...augmented, proposed_by: 'user:1' });
      },
      async markProposalApproved() { return { ok: true }; },
    };
    const out = await processAutomationIngest({
      rawBody: {
        path: 'inbox/trends/int.md',
        body: 'integration',
        source_fingerprint: 'fp-int-0001',
        content_class: 'research',
      },
      actor: { sub: 'user:1', vaultId: 'default', credentialId: null, credentialName: 'bot' },
      rules: [],
      triggers: loadReviewTriggers(tmp),
      io,
    });
    assert.equal(out.status, 201);
    assert.equal(out.body.disposition, 'review_queue');
    assert.equal(out.body.outcome, 'proposal');
    assert.ok(out.body.proposal_id);
    assert.ok(audits.some((a) => a.action === 'ingest_review_queued'));
  });
});
