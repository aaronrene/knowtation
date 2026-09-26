import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const native = '/api/v1/auth/native';
const device = '/api/v1/auth/device';

async function start(t, env = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'knowtation-gateway-bootstrap-'));
  const child = fork(new URL('./helpers/gateway-bootstrap-child.mjs', import.meta.url), [], {
    env: { KNOWTATION_GATEWAY_DATA_DIR: dir, ...env },
    execArgv: ['--no-warnings', '--experimental-loader', new URL('./helpers/gateway-bootstrap-loader.mjs', import.meta.url).href],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  // No raw runtime output: assertions never print credentials or token responses.
  child.stdout.resume();
  child.stderr.resume();
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  });
  const pending = new Map();
  let sequence = 0;
  child.on('message', (message) => {
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(message.error));
      else entry?.resolve(message.result);
    }
  });
  const boot = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Gateway startup timed out')), 15000);
    child.on('message', (message) => {
      if (message.event) { clearTimeout(timeout); resolve(message); }
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Gateway exited before startup result')); });
  });
  return {
    ...boot, exited,
    rpc(action, values = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.send({ id, action, ...values });
      });
    },
    async request(urlPath, body, headers = {}, method = body ? 'POST' : 'GET') {
      const response = await fetch(boot.baseUrl + urlPath, {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { /* redirects / SSE */ }
      return { status: response.status, headers: response.headers, json, text };
    },
  };
}

test('real gateway: public OAuth routers precede catch-all at listen, including delayed imports', async (t) => {
  const gw = await start(t, { GATEWAY_TEST_MODULE: 'native-oauth-provider' });
  assert.equal(gw.event, 'ready');
  assert.ok(gw.order.native >= 0 && gw.order.native < gw.order.catchAll);
  assert.ok(gw.order.device >= 0 && gw.order.device < gw.order.catchAll);
  for (const prefix of ['', native, device]) {
    const r = await gw.request(prefix + '/.well-known/oauth-authorization-server');
    assert.equal(r.status, 200, `public discovery: ${prefix || 'MCP'}`);
    assert.equal(r.json.issuer, 'http://localhost:3340' + (prefix || '/'));
  }
  assert.equal((await gw.request('/health')).status, 200);
  assert.equal((await gw.request('/api/v1/unhandled-test')).status, 401);
  assert.equal(await gw.rpc('upstreamHits'), 0);
  const restToken = await gw.rpc('sign', { sub: 'google:bootstrap-test' });
  const proxied = await gw.request('/api/v1/unhandled-test', undefined, { Authorization: `Bearer ${restToken}` });
  assert.equal(proxied.status, 200);
  assert.equal(proxied.json.mock_upstream, true, 'authenticated fallback still reaches the upstream');
  assert.equal((await gw.request('/api/v1/health-canister')).status, 200, 'last specific route also precedes fallback');

  await t.test('registration accepts literal loopback and rejects remote/malformed redirects', async () => {
    for (const uri of ['http://127.0.0.1:53112/cb', 'http://[::1]:53113/cb']) {
      const r = await gw.request(native + '/register', { redirect_uris: [uri] });
      assert.equal(r.status, 201);
      assert.equal(r.json.token_endpoint_auth_method, 'none');
      assert.ok(!r.json.client_secret);
    }
    for (const uri of ['https://example.com/cb', 'http://localhost:53112/cb', 'not-a-uri', 'http://[::1', 'http://127.0.0.1:99999/cb', 'javascript:alert(1)']) {
      assert.equal((await gw.request(native + '/register', { redirect_uris: [uri] })).status, 400);
    }
    assert.equal((await gw.request(native + '/register', { redirect_uris: [] })).status, 400);
  });

  async function authorization() {
    const redirect = 'http://127.0.0.1:53114/callback';
    const reg = await gw.request(native + '/register', { redirect_uris: [redirect] });
    assert.equal(reg.status, 201);
    const clientId = reg.json.client_id;
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, response_type: 'code', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', scope: 'vault:read vault:write admin',
    });
    const r = await gw.request(native + '/authorize?' + q);
    assert.equal(r.status, 302);
    const location = await gw.rpc('complete', {
      state: new URL(r.headers.get('location')).searchParams.get('native_state'), sub: 'google:bootstrap-test',
    });
    const callback = new URL(location);
    assert.ok(callback.searchParams.get('state') === state, 'state preserved');
    assert.equal(callback.searchParams.get('iss'), 'http://localhost:3340' + native);
    return { grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect };
  }

  await t.test('PKCE, exact redirect, code single-use, role ceiling, rotation and reuse revocation', async () => {
    const registration = await gw.request(native + '/register', { redirect_uris: ['http://127.0.0.1:53114/callback'] });
    assert.equal(registration.status, 201);
    for (const method of ['', 'plain']) {
      const query = new URLSearchParams({ client_id: registration.json.client_id, redirect_uri: 'http://127.0.0.1:53114/callback', code_challenge: 'test', code_challenge_method: method });
      const rejected = await gw.request(native + '/authorize?' + query);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.json.error, 'invalid_request');
    }
    const wrongRedirect = await authorization();
    const mismatch = await gw.request(native + '/token', { ...wrongRedirect, redirect_uri: 'http://127.0.0.1:53115/callback' });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.json.error, 'invalid_grant');
    const badPkce = await authorization();
    assert.equal((await gw.request(native + '/token', { ...badPkce, code_verifier: randomBytes(32).toString('base64url') })).status, 400);
    const grant = await authorization();
    const tokens = await gw.request(native + '/token', grant);
    assert.equal(tokens.status, 200);
    assert.equal(tokens.json.scope, 'vault:read vault:write');
    const payload = JSON.parse(Buffer.from(tokens.json.access_token.split('.')[1], 'base64url'));
    assert.equal(payload.type, 'session');
    assert.equal(payload.role, 'member');
    assert.equal((await gw.request(native + '/token', grant)).status, 400);
    const refresh = { grant_type: 'refresh_token', client_id: grant.client_id, refresh_token: tokens.json.refresh_token };
    const rotated = await gw.request(native + '/token', refresh);
    assert.equal(rotated.status, 200);
    assert.ok(rotated.json.refresh_token !== tokens.json.refresh_token, 'refresh rotated');
    assert.equal(rotated.json.scope, 'vault:read vault:write');
    const replay = await gw.request(native + '/token', refresh);
    assert.equal(replay.status, 401);
    assert.equal(replay.json.code, 'REFRESH_REUSE');
    assert.equal((await gw.request(native + '/token', { ...refresh, refresh_token: rotated.json.refresh_token })).status, 401);
    const revokeGrant = await authorization();
    const revocable = await gw.request(native + '/token', revokeGrant);
    assert.equal(revocable.status, 200);
    assert.equal((await gw.request(native + '/revoke', { token: revocable.json.refresh_token })).status, 200);
    assert.equal((await gw.request(native + '/token', { grant_type: 'refresh_token', client_id: revokeGrant.client_id, refresh_token: revocable.json.refresh_token })).status, 401);
  });

  await t.test('device initiation/polling public; user operations authenticated', async () => {
    const r = await gw.request(device + '/authorize', { client_id: 'bootstrap-test', scope: 'vault:read' });
    assert.equal(r.status, 200);
    const poll = await gw.request(device + '/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: r.json.device_code });
    assert.equal(poll.status, 400);
    assert.equal(poll.json.error, 'authorization_pending');
    for (const action of ['approve', 'deny']) {
      assert.equal((await gw.request(device + '/' + action, { user_code: r.json.user_code })).status, 401);
    }
    assert.equal((await gw.request(device + '/pending')).status, 401);
    const token = await gw.rpc('sign', { sub: 'google:bootstrap-test' });
    assert.equal((await gw.request(device + '/pending', undefined, { Authorization: `Bearer ${token}` })).status, 200);
  });

  await t.test('OAuth CORS permits configured apex/www; no-origin discovery stays public', async () => {
    for (const Origin of ['https://knowtation.store', 'https://www.knowtation.store']) {
      for (const prefix of [native, device]) {
        const r = await gw.request(prefix + '/token', undefined, { Origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, 'OPTIONS');
        // A reached Express router answers automatic OPTIONS with 200 (the old
        // shadowing catch-all answered 204); both are valid CORS preflights.
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('access-control-allow-origin'), Origin);
        assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
      }
    }
  });

  await t.test('MCP authentication, initialization and session ownership remain enforced', async () => {
    assert.equal((await gw.request('/mcp')).status, 401);
    assert.equal((await gw.request('/mcp', undefined, { Authorization: 'Bearer invalid' })).status, 401);
    const token = await gw.rpc('sign', { sub: 'google:bootstrap-test' });
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' };
    const init = await gw.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bootstrap-test', version: '1' } } }, headers);
    assert.equal(init.status, 200);
    const session = init.headers.get('mcp-session-id');
    assert.ok(session, 'MCP session initialized');
    const list = await gw.request('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { ...headers, 'mcp-session-id': session });
    assert.equal(list.status, 200);
    assert.ok(list.text.includes('get_note'), 'existing tool catalog available');
    const other = await gw.rpc('sign', { sub: 'google:another-test-user' });
    const stolen = await gw.request('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, { ...headers, Authorization: `Bearer ${other}`, 'mcp-session-id': session });
    assert.equal(stolen.status, 404);
    assert.equal((await gw.request('/mcp', undefined, { ...headers, 'mcp-session-id': session }, 'DELETE')).status, 200);
  });
});

for (const mode of ['netlify', 'offline-locked']) {
  test(`real gateway: ${mode} keeps durable OAuth disabled`, async (t) => {
    const gw = await start(t, mode === 'netlify' ? { NETLIFY: '1' } : { KNOWTATION_OFFLINE_LOCKED_AUTH: 'enabled' });
    assert.equal(gw.event, 'ready');
    assert.equal(gw.order.native, -1);
    assert.equal(gw.order.device, -1);
    assert.equal((await gw.request('/.well-known/oauth-authorization-server')).status, 404);
    for (const prefix of [native, device]) assert.equal((await gw.request(prefix + '/.well-known/oauth-authorization-server')).status, 401);
    if (mode === 'netlify') {
      const r = await gw.request('/mcp');
      assert.equal(r.status, 503);
      assert.equal(r.json.code, 'MCP_NETLIFY_UNSUPPORTED');
      assert.equal((await gw.request('/.netlify/functions/gateway/health')).status, 200);
    }
  });
}

for (const module of ['mcp-oauth-provider', 'native-oauth-provider', 'device-oauth-provider', 'mcp-proxy']) {
  test(`startup aborts before listen when ${module} cannot load`, async (t) => {
    const gw = await start(t, { GATEWAY_TEST_MODULE: module, GATEWAY_TEST_FAULT: 'import' });
    assert.equal(gw.event, 'startup-failed');
    assert.equal(gw.listenCalls, 0);
    assert.equal(await gw.exited, 1);
  });
}

for (const module of ['native-oauth-provider', 'agent-credential-routes']) {
  test(`startup aborts before listen when ${module} construction fails`, async (t) => {
    const gw = await start(t, { GATEWAY_TEST_MODULE: module, GATEWAY_TEST_FAULT: 'factory' });
    assert.equal(gw.event, 'startup-failed');
    assert.equal(gw.listenCalls, 0);
    assert.equal(await gw.exited, 1);
  });
}
