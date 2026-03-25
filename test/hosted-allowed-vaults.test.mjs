import test from 'node:test';
import assert from 'node:assert';
import { resolveAllowedVaultIdsForHostedContext } from '../hub/lib/hosted-workspace-resolve.mjs';

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
