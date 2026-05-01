import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalDataForHostedReviewHintsFromCreate } from '../hub/gateway/proposal-hints-create-context.mjs';

test('returns null when no proposal_id', () => {
  assert.equal(proposalDataForHostedReviewHintsFromCreate({ path: 'a.md' }, { body: 'x' }), null);
});

test('uses canister body when present', () => {
  const out = proposalDataForHostedReviewHintsFromCreate(
    { proposal_id: 'p1', path: 'n.md', body: 'from-canister' },
    { path: 'n.md', body: 'from-client' },
  );
  assert.deepEqual(out, { path: 'n.md', body: 'from-canister' });
});

test('falls back to client body when canister omits body', () => {
  const out = proposalDataForHostedReviewHintsFromCreate(
    { proposal_id: 'p1', path: 'projects/x.md', status: 'proposed' },
    { path: 'projects/x.md', body: 'client markdown', source: 'hub_ui' },
  );
  assert.deepEqual(out, { path: 'projects/x.md', body: 'client markdown' });
});

test('falls back to client body when canister returns empty string', () => {
  const out = proposalDataForHostedReviewHintsFromCreate(
    { proposal_id: 'p1', path: 'p.md', body: '' },
    { path: 'p.md', body: 'filled from client' },
  );
  assert.deepEqual(out, { path: 'p.md', body: 'filled from client' });
});
