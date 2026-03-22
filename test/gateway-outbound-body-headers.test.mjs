/**
 * Regression: gateway proxies with spread req.headers. After express.json(),
 * we replace the body with JSON.stringify(merge(...)) which is longer than the
 * client's original body. Undici keeps an explicit Content-Length from the client
 * and may deadlock trying to write the full string (body length ≠ declared length).
 */
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('undici fetch does not complete promptly when Content-Length is shorter than body', async () => {
  const fullBody = JSON.stringify({
    path: 'inbox/hub_123.md',
    body: 'hello world content',
    frontmatter: JSON.stringify({ title: 'T', knowtation_editor: 'google:1', author_kind: 'human' }),
  });
  const staleLength = 32;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const got = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ receivedLen: got.length, fullLen: fullBody.length, got }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 400);

  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/notes`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(staleLength),
      },
      body: fullBody,
    });
    assert.fail('expected fetch to hang or abort when Content-Length underreports body');
  } catch (e) {
    assert.equal(e.name, 'AbortError');
  } finally {
    clearTimeout(t);
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close').catch(() => {});
  }
});

test('undici fetch completes with full body when Content-Length is omitted', async () => {
  const fullBody = JSON.stringify({ ok: true, pad: 'x'.repeat(200) });

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const got = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ receivedLen: got.length, match: got === fullBody }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const r = await fetch(`http://127.0.0.1:${port}/t`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fullBody,
    });
    const j = await r.json();
    assert.equal(j.receivedLen, fullBody.length);
    assert.equal(j.match, true);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close').catch(() => {});
  }
});
