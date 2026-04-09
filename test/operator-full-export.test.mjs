import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAllOperatorUserIds,
  fetchOperatorUserIndexPage,
  buildOperatorFullExportPayload,
} from '../lib/operator-full-export.mjs';

test('fetchOperatorUserIndexPage builds URL with cursor and limit', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(String(url), /\/api\/v1\/operator\/export/);
    assert.ok(String(url).includes('cursor=10'));
    assert.ok(String(url).includes('limit=50'));
    assert.equal(init.headers['X-Operator-Export-Key'], 'k');
    return {
      ok: true,
      async json() {
        return { user_ids: ['a'], next_cursor: '11', done: false };
      },
    };
  });
  const j = await fetchOperatorUserIndexPage('https://c.example.test', 'k', '10', 50);
  assert.deepEqual(j.user_ids, ['a']);
});

test('collectAllOperatorUserIds follows next_cursor until done', async () => {
  let call = 0;
  mock.method(globalThis, 'fetch', async (url) => {
    call += 1;
    if (call === 1) {
      return {
        ok: true,
        json: async () => ({
          user_ids: ['u1', 'u2'],
          next_cursor: '2',
          done: false,
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        user_ids: ['u3'],
        next_cursor: '',
        done: true,
      }),
    };
  });
  try {
    const ids = await collectAllOperatorUserIds('https://c.test', 'key', 200);
    assert.deepEqual(ids, ['u1', 'u2', 'u3']);
    assert.equal(call, 2);
  } finally {
    mock.restoreAll();
  }
});

test('collectAllOperatorUserIds stops if next_cursor empty when not done', async () => {
  mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({
      user_ids: ['x'],
      next_cursor: '',
      done: false,
    }),
  }));
  try {
    const ids = await collectAllOperatorUserIds('https://c.test', 'key');
    assert.deepEqual(ids, ['x']);
  } finally {
    mock.restoreAll();
  }
});

test('buildOperatorFullExportPayload shape', () => {
  const p = buildOperatorFullExportPayload([
    { user_id: 'a', vaults: [{ vault_id: 'default', notes: [] }], proposals: [] },
  ]);
  assert.equal(p.format_version, 4);
  assert.equal(p.kind, 'knowtation-operator-full-export');
  assert.equal(p.users.length, 1);
});
