import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createOAuthRedirectAttempt } from '../lib/companion-oauth-flow.mjs';

test('loopback bind failure closes the attempt without retaining the callback timeout', async () => {
  const server = new EventEmitter();
  server.listening = false;
  server.listen = () => queueMicrotask(() => server.emit('error', new Error('denied')));
  server.close = () => {};
  await assert.rejects(
    createOAuthRedirectAttempt({
      expectedState: 'state',
      expectedIssuer: 'https://mcp.knowtation.store/api/v1/auth/native',
      timeoutMs: 120_000,
      createServer: () => server,
    }),
    /bind_failed/,
  );
});
