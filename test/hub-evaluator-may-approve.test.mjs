import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorMayApproveProposals } from '../hub/lib/hub-evaluator-may-approve.mjs';

test('actorMayApproveProposals: admin always true', () => {
  assert.equal(actorMayApproveProposals('u1', 'admin', {}, false), true);
  assert.equal(actorMayApproveProposals('u1', 'admin', { u1: false }, false), true);
});

test('actorMayApproveProposals: non-evaluator false', () => {
  assert.equal(actorMayApproveProposals('u1', 'editor', {}, true), false);
  assert.equal(actorMayApproveProposals('u1', 'viewer', {}, true), false);
});

test('actorMayApproveProposals: evaluator explicit map wins over env', () => {
  assert.equal(actorMayApproveProposals('u1', 'evaluator', { u1: true }, false), true);
  assert.equal(actorMayApproveProposals('u1', 'evaluator', { u1: false }, true), false);
});

test('actorMayApproveProposals: evaluator missing key uses env fallback', () => {
  assert.equal(actorMayApproveProposals('u1', 'evaluator', {}, false), false);
  assert.equal(actorMayApproveProposals('u1', 'evaluator', {}, true), true);
});
