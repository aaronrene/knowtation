import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveEffectiveCanisterUser,
  getAllowedVaultIdsFromAccessMap,
  getScopeForUserVaultFromScopeMap,
  intersectVaultIds,
} from '../hub/lib/hosted-workspace-resolve.mjs';

describe('hosted-workspace-resolve', () => {
  const admins = new Set(['google:admin']);

  it('no workspace owner: everyone uses self', () => {
    const r = resolveEffectiveCanisterUser({
      actorSub: 'google:a',
      workspaceOwnerId: null,
      storedRoles: {},
      adminUserIdsSet: admins,
    });
    assert.equal(r.effective, 'google:a');
    assert.equal(r.delegate, false);
  });

  it('owner uses self', () => {
    const r = resolveEffectiveCanisterUser({
      actorSub: 'google:owner',
      workspaceOwnerId: 'google:owner',
      storedRoles: { 'google:member': 'editor' },
      adminUserIdsSet: new Set(),
    });
    assert.equal(r.effective, 'google:owner');
    assert.equal(r.delegate, false);
  });

  it('invited member delegates to owner', () => {
    const r = resolveEffectiveCanisterUser({
      actorSub: 'github:member',
      workspaceOwnerId: 'google:owner',
      storedRoles: { 'github:member': 'editor' },
      adminUserIdsSet: new Set(),
    });
    assert.equal(r.effective, 'google:owner');
    assert.equal(r.delegate, true);
  });

  it('env admin delegates when not owner', () => {
    const r = resolveEffectiveCanisterUser({
      actorSub: 'google:admin',
      workspaceOwnerId: 'google:owner',
      storedRoles: {},
      adminUserIdsSet: admins,
    });
    assert.equal(r.effective, 'google:owner');
    assert.equal(r.delegate, true);
  });

  it('solo user not in roles does not delegate', () => {
    const r = resolveEffectiveCanisterUser({
      actorSub: 'google:stranger',
      workspaceOwnerId: 'google:owner',
      storedRoles: { 'github:member': 'editor' },
      adminUserIdsSet: new Set(),
    });
    assert.equal(r.effective, 'google:stranger');
    assert.equal(r.delegate, false);
  });

  it('getAllowedVaultIdsFromAccessMap defaults to default', () => {
    assert.deepEqual(getAllowedVaultIdsFromAccessMap({}, 'any'), ['default']);
    assert.deepEqual(getAllowedVaultIdsFromAccessMap({ 'google:x': ['work'] }, 'google:x'), ['work']);
  });

  it('getScopeForUserVaultFromScopeMap', () => {
    const map = {
      'google:x': {
        default: { projects: ['p1'], folders: [] },
      },
    };
    assert.deepEqual(getScopeForUserVaultFromScopeMap(map, 'google:x', 'default'), {
      projects: ['p1'],
      folders: [],
    });
    assert.equal(getScopeForUserVaultFromScopeMap(map, 'google:x', 'other'), null);
  });

  it('intersectVaultIds preserves canister order', () => {
    assert.deepEqual(intersectVaultIds(['default', 'work', 'x'], ['work', 'default']), ['default', 'work']);
  });
});
