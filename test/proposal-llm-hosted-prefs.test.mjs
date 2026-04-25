import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveHostedReviewHints,
  effectiveHostedEnrich,
} from '../hub/gateway/proposal-llm-store.mjs';

/**
 * Settings → Backup "Save proposal policy" persists review_hints_enabled / enrich_enabled
 * in Netlify Blob; effective*() reads that object. These tests cover env override vs stored prefs
 * (not emptyPrefs() — that only supplies defaults when no blob/local file exists yet).
 */
test('effectiveHostedReviewHints / Enrich: use stored true when env unset', async (t) => {
  const prevH = process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS;
  const prevE = process.env.KNOWTATION_HUB_PROPOSAL_ENRICH;
  t.after(() => {
    if (prevH === undefined) delete process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS;
    else process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS = prevH;
    if (prevE === undefined) delete process.env.KNOWTATION_HUB_PROPOSAL_ENRICH;
    else process.env.KNOWTATION_HUB_PROPOSAL_ENRICH = prevE;
  });
  delete process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS;
  delete process.env.KNOWTATION_HUB_PROPOSAL_ENRICH;

  const storedOn = {
    proposal_evaluation_required: true,
    review_hints_enabled: true,
    enrich_enabled: true,
  };
  assert.equal(effectiveHostedReviewHints(storedOn), true);
  assert.equal(effectiveHostedEnrich(storedOn), true);
});

test('explicit env 0 disables even when stored prefs are true', async (t) => {
  const prevH = process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS;
  const prevE = process.env.KNOWTATION_HUB_PROPOSAL_ENRICH;
  t.after(() => {
    if (prevH === undefined) delete process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS;
    else process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS = prevH;
    if (prevE === undefined) delete process.env.KNOWTATION_HUB_PROPOSAL_ENRICH;
    else process.env.KNOWTATION_HUB_PROPOSAL_ENRICH = prevE;
  });
  process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS = '0';
  process.env.KNOWTATION_HUB_PROPOSAL_ENRICH = '0';
  const onPrefs = {
    proposal_evaluation_required: false,
    review_hints_enabled: true,
    enrich_enabled: true,
  };
  assert.equal(effectiveHostedReviewHints(onPrefs), false);
  assert.equal(effectiveHostedEnrich(onPrefs), false);
});
