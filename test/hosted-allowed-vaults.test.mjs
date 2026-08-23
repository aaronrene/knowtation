import test from 'node:test';
import assert from 'node:assert';
import {
  resolveAllowedVaultIdsForHostedContext,
  resolveAllowedVaultIdsForSessionBoundActor,
} from '../hub/lib/hosted-workspace-resolve.mjs';

test('non-delegate without access row: all canister vaults', () => {
  const out = resolveAllowedVaultIdsForHostedContext({
    delegate: false,
    actorUid: 'owner',
    accessMap: {},
    canisterIds: ['default', 'work', 'personal'],
  });
  assert.deepStrictEqual(out, ['default', 'work', 'personal']);
});

test('non-delegate with explicit access: intersect with canister list', () => {
  const out = resolveAllowedVaultIdsForHostedContext({
    delegate: false,
    actorUid: 'owner',
    accessMap: { owner: ['default'] },
    canisterIds: ['default', 'work'],
  });
  assert.deepStrictEqual(out, ['default']);
});

test('delegate without access row: default only', () => {
  const out = resolveAllowedVaultIdsForHostedContext({
    delegate: true,
    actorUid: 'editor1',
    accessMap: {},
    canisterIds: ['default', 'work'],
  });
  assert.deepStrictEqual(out, ['default']);
});

test('delegate with explicit access', () => {
  const out = resolveAllowedVaultIdsForHostedContext({
    delegate: true,
    actorUid: 'editor1',
    accessMap: { editor1: ['work'] },
    canisterIds: ['default', 'work'],
  });
  assert.deepStrictEqual(out, ['work']);
});

test('session-bound delegate may use Business on owner partition', () => {
  const base = resolveAllowedVaultIdsForHostedContext({
    delegate: true,
    actorUid: 'google:learner',
    accessMap: {},
    canisterIds: ['default', 'Business'],
  });
  assert.deepStrictEqual(base, ['default']);
  const expanded = resolveAllowedVaultIdsForSessionBoundActor({
    sessionBound: true,
    allowedVaultIds: base,
    canisterIds: ['default', 'Business'],
    vaultId: 'Business',
  });
  assert.deepStrictEqual(expanded, ['default', 'Business']);
});

test('session-bound does not expand to vault absent from canister', () => {
  const base = resolveAllowedVaultIdsForHostedContext({
    delegate: true,
    actorUid: 'google:learner',
    accessMap: { 'google:learner': ['default'] },
    canisterIds: ['default'],
  });
  const expanded = resolveAllowedVaultIdsForSessionBoundActor({
    sessionBound: true,
    allowedVaultIds: base,
    canisterIds: ['default'],
    vaultId: 'Business',
  });
  assert.deepStrictEqual(expanded, ['default']);
});

test('integration token (non-session) keeps delegate vault map', () => {
  const base = resolveAllowedVaultIdsForHostedContext({
    delegate: true,
    actorUid: 'google:learner',
    accessMap: {},
    canisterIds: ['default', 'Business'],
  });
  const unchanged = resolveAllowedVaultIdsForSessionBoundActor({
    sessionBound: false,
    allowedVaultIds: base,
    canisterIds: ['default', 'Business'],
    vaultId: 'Business',
  });
  assert.deepStrictEqual(unchanged, ['default']);
});
