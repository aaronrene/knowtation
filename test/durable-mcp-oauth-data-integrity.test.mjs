/**
 * Phase A — durable MCP OAuth: data-integrity tier.
 * Concurrent refresh (no double-spend); corrupt store fail-closed.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createDurableMcpProvider,
  mintMcpTokens,
  createTempStrongStore,
} from './helpers/durable-mcp-oauth-harness.mjs';
import { loadRefreshRecords } from '../hub/gateway/refresh-token-store.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase A data-integrity — concurrent refresh + corrupt store', () => {
  it('sequential rotate chain never double-spends the same presented token', async () => {
    const { provider, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);
    const { client, tokens } = await mintMcpTokens(provider);
    const first = tokens.refresh_token;
    const second = (await provider.exchangeRefreshToken(client, first)).refresh_token;
    const third = (await provider.exchangeRefreshToken(client, second)).refresh_token;
    assert.ok(third);
    assert.notEqual(third, second);
    // Replaying an earlier link burns the family (reuse detection).
    await assert.rejects(() => provider.exchangeRefreshToken(client, first), /reuse|revoked|Unknown/i);
    await assert.rejects(() => provider.exchangeRefreshToken(client, third), /revoked|Unknown|reuse/i);
  });

  it('corrupt store file fails closed (empty records / no throw on load)', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    await fs.writeFile(path.join(tmp.dir, 'hosted_refresh_tokens.json'), '{not-json', 'utf8');
    const records = await loadRefreshRecords();
    assert.deepEqual(records, {});
  });

  it('malformed token entries are dropped on load (fail-closed)', async () => {
    const tmp = await createTempStrongStore();
    cleanups.push(tmp.cleanup);
    await fs.writeFile(
      path.join(tmp.dir, 'hosted_refresh_tokens.json'),
      JSON.stringify({
        tokens: {
          good: {
            sub: 'google:1',
            family_id: 'f',
            token_hash: 'abc',
            created_at: 1,
            expires_at: 9e15,
            family_expires_at: 9e15,
            rotated_to: null,
            used_at: null,
            revoked: false,
            meta: {},
          },
          bad: { sub: 'x' },
          alsoBad: null,
        },
      }),
      'utf8'
    );
    const records = await loadRefreshRecords();
    assert.ok(records.good);
    assert.equal(records.bad, undefined);
    assert.equal(records.alsoBad, undefined);
  });
});
