// Run the real server in a separate process, with no local .env or production data.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const require = createRequire(new URL('../../hub/gateway/server.mjs', import.meta.url));
const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
require('dotenv').config = rootRequire('dotenv').config = () => ({ parsed: {} });
const secret = randomBytes(32).toString('hex');
Object.assign(process.env, {
  SESSION_SECRET: secret,
  CANISTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  HUB_BASE_URL: 'http://localhost:3340', GATEWAY_PORT: '0',
  BILLING_ENFORCE: 'false', NODE_ENV: 'test',
  HUB_CORS_ORIGIN: 'https://knowtation.store,https://www.knowtation.store',
});
let upstreamHits = 0;
const upstream = http.createServer((req, res) => {
  upstreamHits++;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url.startsWith('/api/v1/hosted-context')
    ? { role: 'viewer', scope: {}, effective_canister_user_id: 'google:bootstrap-test' }
    : { mock_upstream: true }));
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
process.env.CANISTER_URL = process.env.BRIDGE_URL = `http://127.0.0.1:${upstream.address().port}`;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(String(input)).hostname)) {
    throw new Error('External network disabled in gateway bootstrap tests');
  }
  return realFetch(input, options);
};
const express = require('express');
let server;
let listenCalls = 0;
const realListen = express.application.listen;
express.application.listen = function (_port, callback) {
  listenCalls++;
  // Snapshot at the actual listen boundary, not after a startup delay.
  const stack = this._router.stack;
  const api = stack.map((layer, i) => layer.regexp.test('/api/v1') ? i : -1);
  const catchAll = Math.max(...api.filter((i) => i >= 0 && !stack[i].regexp.fast_slash));
  const mounts = (prefix) => stack.findIndex((layer) =>
    layer.name === 'router' && layer.regexp.test(prefix) && !layer.regexp.fast_slash);
  const order = { catchAll, native: mounts('/api/v1/auth/native'), device: mounts('/api/v1/auth/device') };
  server = realListen.call(this, 0, '127.0.0.1', () => {
    callback?.();
    process.send({ event: 'ready', baseUrl: `http://127.0.0.1:${server.address().port}`, order, listenCalls });
  });
  return server;
};

try {
  const { app } = await import('../../hub/gateway/server.mjs');
  process.on('message', async ({ id, action, state, sub, type, scopes }) => {
    try {
      let result;
      if (action === 'complete') {
        await app._nativeOAuthProvider.completeNativeAuthorization(state, sub, {
          redirect(location) { result = location; },
          status() { return this; }, send() { throw new Error('Native completion rejected'); },
        });
      } else if (action === 'sign') {
        result = require('jsonwebtoken').sign(
          { sub, type: type || 'session', role: 'member', ...(scopes ? { scopes } : {}) },
          secret, { expiresIn: '1h' },
        );
      } else if (action === 'upstreamHits') result = upstreamHits;
      process.send({ id, result });
    } catch { process.send({ id, error: 'Fixture operation failed' }); }
  });
  if (process.env.NETLIFY) {
    if (listenCalls !== 0) throw new Error('Netlify import unexpectedly started a listener');
    app.listen(0);
  }
} catch {
  process.send({ event: 'startup-failed', listenCalls });
  upstream.close();
  process.exitCode = 1;
  process.disconnect();
}
