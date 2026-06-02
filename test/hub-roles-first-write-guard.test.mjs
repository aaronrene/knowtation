/**
 * First write to hub_roles.json must keep the acting user as admin so local operators
 * are not locked out of Team / POST /api/v1/roles (see hub/roles.mjs + hub/server.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureActorAdminOnFirstRolesPopulation } from '../hub/roles.mjs';

test('first population: adds actor as admin alongside new row', () => {
  const out = ensureActorAdminOnFirstRolesPopulation(
    0,
    { 'google:999': 'viewer' },
    'google:111',
  );
  assert.deepEqual(out, {
    'google:999': 'viewer',
    'google:111': 'admin',
  });
});

test('first population: actor already in map keeps admin if set', () => {
  const out = ensureActorAdminOnFirstRolesPopulation(
    0,
    { 'google:111': 'admin', 'google:999': 'editor' },
    'google:111',
  );
  assert.equal(out['google:111'], 'admin');
  assert.equal(out['google:999'], 'editor');
});

test('subsequent writes: does not inject admin row', () => {
  const out = ensureActorAdminOnFirstRolesPopulation(
    2,
    { 'google:111': 'admin', 'google:999': 'evaluator' },
    'google:111',
  );
  assert.deepEqual(out, { 'google:111': 'admin', 'google:999': 'evaluator' });
});

test('empty actor sub: unchanged', () => {
  const row = { 'google:999': 'viewer' };
  assert.deepEqual(ensureActorAdminOnFirstRolesPopulation(0, row, ''), row);
  assert.deepEqual(ensureActorAdminOnFirstRolesPopulation(0, row, '   '), row);
});
