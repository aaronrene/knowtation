import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import {
  createScoolingNoteOutlineSmokeRouter,
  normalizeVaultRelativePath,
  sanitizeNoteOutline,
} from '../hub/gateway/scooling-note-outline-smoke.mjs';

const BRIDGE_TOKEN = 'bridge-owned-note-outline-token';

function validOutline(path = 'inbox/a.md') {
  return {
    schema: 'knowtation.note_outline/v1',
    path,
    title: 'Bridge Outline',
    headings: [
      { level: 1, text: 'Intro', id: 'h1-intro-0001' },
      { level: 2, text: 'Next', id: 'h2-next-0002' },
    ],
    truncated: false,
  };
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withBridgeServer({ upstreamHandler, routerOptions = {}, fn }) {
  const upstreamApp = express();
  upstreamApp.get('/api/v1/note-outline', upstreamHandler);
  const upstream = await startServer(upstreamApp);

  const bridgeApp = express();
  bridgeApp.use(
    createScoolingNoteOutlineSmokeRouter({
      upstreamEndpoint: `${upstream.base}/api/v1/note-outline`,
      authorizationHeader: () => `Bearer ${BRIDGE_TOKEN}`,
      isEnabled: () => true,
      environment: () => 'local',
      ...routerOptions,
    }),
  );
  const bridge = await startServer(bridgeApp);

  try {
    await fn({ bridgeBase: bridge.base, upstreamBase: upstream.base });
  } finally {
    await bridge.close();
    await upstream.close();
  }
}

describe('Scooling NoteOutline smoke bridge helpers', () => {
  it('unit: validates vault-relative paths and body-free NoteOutline payloads', () => {
    assert.equal(normalizeVaultRelativePath('inbox\\a.md'), 'inbox/a.md');
    assert.throws(() => normalizeVaultRelativePath('../secret.md'));
    assert.throws(() => normalizeVaultRelativePath('/Users/private/a.md'));
    assert.deepEqual(sanitizeNoteOutline({ ...validOutline(), body: 'must not leak' }, 'inbox/a.md'), validOutline());
    assert.throws(() =>
      sanitizeNoteOutline(
        {
          ...validOutline(),
          headings: [{ level: 1, text: 'Intro', id: 'h1-intro-0001', body: 'must not leak' }],
        },
        'inbox/a.md',
      ),
    );
  });

  it('integration: owns the upstream bearer token and rejects Scooling-supplied credentials', async () => {
    const upstreamCalls = [];
    await withBridgeServer({
      upstreamHandler: (req, res) => {
        upstreamCalls.push({
          path: req.query.path,
          authorization: req.headers.authorization,
        });
        res.json(validOutline(String(req.query.path)));
      },
      fn: async ({ bridgeBase }) => {
        const ok = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
        assert.equal(ok.status, 200);
        assert.equal(upstreamCalls.length, 1);
        assert.equal(upstreamCalls[0].authorization, `Bearer ${BRIDGE_TOKEN}`);

        const rejected = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`, {
          headers: { Authorization: 'Bearer scooling-must-not-send' },
        });
        const body = await rejected.json();
        assert.equal(rejected.status, 400);
        assert.equal(body.containsRawCredentials, false);
        assert.equal(upstreamCalls.length, 1);
      },
    });
  });

  it('end-to-end: returns only raw body-free NoteOutline JSON for Scooling transport', async () => {
    await withBridgeServer({
      upstreamHandler: (req, res) => {
        res.json({
          ...validOutline(String(req.query.path)),
          body: 'private body must not cross bridge',
          frontmatter: { api_key: 'must-not-leak' },
          mcp_resource_uri: 'knowtation://private',
        });
      },
      fn: async ({ bridgeBase }) => {
        const res = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
        const body = await res.json();
        const serialized = JSON.stringify(body);

        assert.equal(res.status, 200);
        assert.deepEqual(body, validOutline());
        assert.equal(serialized.includes('private body'), false);
        assert.equal(serialized.includes('must-not-leak'), false);
        assert.equal(serialized.includes('knowtation://'), false);
      },
    });
  });

  it('stress: repeated bridge calls stay deterministic', async () => {
    const upstreamCalls = [];
    await withBridgeServer({
      upstreamHandler: (req, res) => {
        upstreamCalls.push(req.originalUrl);
        res.json(validOutline(String(req.query.path)));
      },
      fn: async ({ bridgeBase }) => {
        const outputs = [];
        for (let index = 0; index < 5; index += 1) {
          const res = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
          outputs.push(await res.text());
        }
        assert.equal(new Set(outputs).size, 1);
        assert.equal(upstreamCalls.length, 5);
      },
    });
  });

  it('data-integrity: rejects unsafe paths before upstream fetch', async () => {
    const upstreamCalls = [];
    await withBridgeServer({
      upstreamHandler: (req, res) => {
        upstreamCalls.push(req.originalUrl);
        res.status(500).json({ error: 'must not be called' });
      },
      fn: async ({ bridgeBase }) => {
        for (const unsafePath of ['../secret.md', '/Users/private/a.md', 'C:\\Users\\private\\a.md']) {
          const res = await fetch(
            `${bridgeBase}/scooling/note-outline/smoke?path=${encodeURIComponent(unsafePath)}`,
          );
          const body = await res.json();
          const serialized = JSON.stringify(body);
          assert.equal(res.status, 400);
          assert.equal(body.containsRawCredentials, false);
          assert.equal(serialized.includes('secret.md'), false);
          assert.equal(serialized.includes('/Users'), false);
        }
        assert.equal(upstreamCalls.length, 0);
      },
    });
  });

  it('performance: performs exactly one upstream NoteOutline GET per bridge request', async () => {
    const upstreamCalls = [];
    await withBridgeServer({
      upstreamHandler: (req, res) => {
        upstreamCalls.push({ method: req.method, url: req.originalUrl });
        res.json(validOutline(String(req.query.path)));
      },
      fn: async ({ bridgeBase }) => {
        const res = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
        assert.equal(res.status, 200);
        assert.deepEqual(upstreamCalls, [{ method: 'GET', url: '/api/v1/note-outline?path=inbox%2Fa.md' }]);
      },
    });
  });

  it('security: hides bridge unless enabled and sanitizes upstream failures', async () => {
    await withBridgeServer({
      routerOptions: { isEnabled: () => false },
      upstreamHandler: (_req, res) => res.json(validOutline()),
      fn: async ({ bridgeBase }) => {
        const res = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
        assert.equal(res.status, 404);
      },
    });

    await withBridgeServer({
      upstreamHandler: (_req, res) =>
        res.status(403).json({ error: 'forbidden', body: 'private body', token: 'must-not-leak' }),
      fn: async ({ bridgeBase }) => {
        const res = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
        const body = await res.json();
        const serialized = JSON.stringify(body);
        assert.equal(res.status, 403);
        assert.equal(body.code, 'FORBIDDEN');
        assert.equal(serialized.includes('private body'), false);
        assert.equal(serialized.includes('must-not-leak'), false);
      },
    });

    await withBridgeServer({
      upstreamHandler: (_req, res) => res.json({ ...validOutline(), path: 'other.md' }),
      fn: async ({ bridgeBase }) => {
        const res = await fetch(`${bridgeBase}/scooling/note-outline/smoke?path=inbox/a.md`);
        const body = await res.json();
        assert.equal(res.status, 502);
        assert.equal(body.code, 'BAD_GATEWAY');
        assert.equal(body.returnedBodyText, false);
      },
    });
  });
});
