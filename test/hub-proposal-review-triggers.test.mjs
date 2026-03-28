import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadReviewTriggers, applyReviewTriggers } from '../lib/hub-proposal-review-triggers.mjs';
import { getProposalEvaluationRequired } from '../lib/hub-proposal-policy.mjs';
import { augmentProposalCreateRequestBody } from '../lib/hub-proposal-create-augment.mjs';

test('applyReviewTriggers: phrase and path prefix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-tr-'));
  fs.writeFileSync(
    path.join(dir, 'hub_proposal_review_triggers.json'),
    JSON.stringify({
      literal_phrases: [{ match: 'api_key', review_queue: 'sec', review_severity: 'elevated' }],
      path_prefixes: [{ prefix: 'legal/', review_queue: 'legal', review_severity: 'standard' }],
      label_any: [{ labels: ['pii'], review_queue: 'privacy' }],
    }),
  );
  const triggers = loadReviewTriggers(dir);
  const byPath = applyReviewTriggers(triggers, { path: 'legal/contract.md', body: 'ok', intent: '', labels: [] });
  assert.equal(byPath.forcePending, true);
  assert.equal(byPath.review_queue, 'legal');
  assert.equal(byPath.review_severity, 'standard');

  const byPhrase = applyReviewTriggers(triggers, { path: 'inbox/x.md', body: 'contains api_key value', intent: '', labels: [] });
  assert.equal(byPhrase.forcePending, true);
  assert.equal(byPhrase.review_queue, 'sec');
  assert.equal(byPhrase.review_severity, 'elevated');

  const byLabel = applyReviewTriggers(triggers, { path: 'a.md', body: '', intent: '', labels: ['PII'] });
  assert.equal(byLabel.forcePending, true);
  assert.equal(byLabel.review_queue, 'privacy');
});

test('getProposalEvaluationRequired: policy file when env unset', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-pol-'));
  const prev = process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
  t.after(() => {
    if (prev === undefined) delete process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
    else process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = prev;
  });
  delete process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
  assert.equal(getProposalEvaluationRequired(dir), false);
  fs.writeFileSync(path.join(dir, 'hub_proposal_policy.json'), JSON.stringify({ proposal_evaluation_required: true }));
  assert.equal(getProposalEvaluationRequired(dir), true);
});

test('augmentProposalCreateRequestBody: policy pending + triggers', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-aug-'));
  const prev = process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
  t.after(() => {
    if (prev === undefined) delete process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
    else process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = prev;
  });
  process.env.HUB_PROPOSAL_EVALUATION_REQUIRED = '0';
  fs.writeFileSync(
    path.join(dir, 'hub_proposal_review_triggers.json'),
    JSON.stringify({
      literal_phrases: [{ match: 'password' }],
      path_prefixes: [],
      label_any: [],
    }),
  );
  const body = augmentProposalCreateRequestBody({ path: 'n.md', body: 'reset password', labels: [] }, dir);
  assert.equal(body.evaluation_status, 'pending');
  assert.ok(Array.isArray(JSON.parse(body.auto_flag_reasons_json)));
});
