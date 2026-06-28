import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGrantsStoreJson } from '../../hub/bridge/delegation-blob-store.mjs';

describe('mergeGrantsStoreJson', () => {
  it('prefers grant with higher action_count when revocation state matches', () => {
    const blob = JSON.stringify({
      vaults: {
        default: {
          grants: [
            {
              grant_id: 'dgrnt_test01',
              action_count: 0,
              issued_at: '2026-06-28T00:00:00.000Z',
            },
          ],
        },
      },
    });
    const local = JSON.stringify({
      vaults: {
        default: {
          grants: [
            {
              grant_id: 'dgrnt_test01',
              action_count: 3,
              issued_at: '2026-06-28T00:00:00.000Z',
            },
          ],
        },
      },
    });

    const merged = JSON.parse(mergeGrantsStoreJson(local, blob));
    const grant = merged.vaults.default.grants.find((g) => g.grant_id === 'dgrnt_test01');
    assert.equal(grant.action_count, 3);
  });
});
