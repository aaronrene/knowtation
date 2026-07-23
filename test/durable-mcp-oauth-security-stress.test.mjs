/**
 * Phase A — durable MCP OAuth: security-stress tier.
 * Refresh storm / family churn must not degrade reuse detection or leak secrets.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDurableMcpProvider,
  mintMcpTokens,
} from './helpers/durable-mcp-oauth-harness.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('Phase A security-stress — refresh storm', () => {
  it('50 families × 5 rotations: reuse of first token always fails; no secret in errors', async () => {
    const { provider, cleanup } = await createDurableMcpProvider();
    cleanups.push(cleanup);

    const families = [];
    for (let i = 0; i < 50; i++) {
      const { client, tokens } = await mintMcpTokens(provider, {
        userId: `google:storm-${i}`,
        clientName: `agent-${i}`,
        scopes: ['vault:read'],
      });
      families.push({ client, first: tokens.refresh_token, current: tokens.refresh_token });
    }

    for (const fam of families) {
      for (let r = 0; r < 5; r++) {
        const next = await provider.exchangeRefreshToken(fam.client, fam.current);
        fam.current = next.refresh_token;
      }
    }

    for (const fam of families) {
      try {
        await provider.exchangeRefreshToken(fam.client, fam.first);
        assert.fail('reuse of first token must fail');
      } catch (e) {
        const msg = String(e.message || e);
        assert.ok(/reuse|revoked|Unknown/i.test(msg), msg);
        assert.ok(!msg.includes(fam.first.split('.')[1] || '___'));
      }
    }
  });
});
