import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { subscriptionCoversUri, vaultRelativePosix } from '../mcp/resource-subscriptions.mjs';

test('subscriptionCoversUri prefix match', () => {
  assert.strictEqual(
    subscriptionCoversUri('knowtation://vault/inbox', 'knowtation://vault/inbox/foo.md'),
    true
  );
  assert.strictEqual(
    subscriptionCoversUri('knowtation://vault/inbox', 'knowtation://vault/inbox'),
    true
  );
  assert.strictEqual(
    subscriptionCoversUri('knowtation://vault/inbox', 'knowtation://vault/captures/x.md'),
    false
  );
});

test('vaultRelativePosix', () => {
  const vault = path.resolve('/tmp/kvault');
  assert.strictEqual(vaultRelativePosix(vault, path.join(vault, 'inbox', 'a.md')), 'inbox/a.md');
  assert.strictEqual(vaultRelativePosix(vault, path.join(vault, '..', 'outside')), null);
});
