import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import {
  createScoolingWriteBackSmokeRouter,
  validSmokeRequest,
} from '../hub/gateway/scooling-write-back-smoke.mjs';

function validPayload() {
  return {
    requestId: 'request-scooling-smoke-001',
    targetId: 'phase-2-hosted-knowtation-staging',
    kind: 'hosted_knowtation',
    environment: 'staging',
    vaultId: 'staging-vault-fixture',
    actions: [
      'metadata_read',
      'proposal_dry_run',
      'conflict_check_dry_run',
      'live_write_denial_check',
    ],
    includeRawCredentials: false,
    allowLiveWrite: false,
  };
}

async function withSmokeServer({ routerOptions, fn }) {
  const app = express();
  app.use(express.json());
  app.use(createScoolingWriteBackSmokeRouter(routerOptions));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Scooling write-back smoke request validation', () => {
  it('accepts the exact metadata-only contract', () => {
    assert.equal(validSmokeRequest(validPayload()), true);
  });

  it('rejects raw credentials, live writes, production targets, and extra fields', () => {
    assert.equal(validSmokeRequest({ ...validPayload(), includeRawCredentials: true }), false);
    assert.equal(validSmokeRequest({ ...validPayload(), allowLiveWrite: true }), false);
    assert.equal(validSmokeRequest({ ...validPayload(), environment: 'production' }), false);
    assert.equal(validSmokeRequest({ ...validPayload(), rawCredential: 'secret' }), false);
  });

  it('requires the full dry-run capability action set', () => {
    assert.equal(validSmokeRequest({ ...validPayload(), actions: ['metadata_read'] }), false);
    assert.equal(
      validSmokeRequest({
        ...validPayload(),
        actions: [
          'metadata_read',
          'metadata_read',
          'conflict_check_dry_run',
          'live_write_denial_check',
        ],
      }),
      false,
    );
  });
});

describe('POST /scooling/write-back/smoke', () => {
  it('is hidden unless explicitly enabled in staging', async () => {
    await withSmokeServer({
      routerOptions: {
        isEnabled: () => false,
        environment: () => 'staging',
        canisterUrl: 'https://mock-canister.test',
        fetchImpl: async () => ({ ok: true }),
      },
      fn: async (base) => {
        const res = await fetch(`${base}/scooling/write-back/smoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload()),
        });
        assert.equal(res.status, 404);
      },
    });

    await withSmokeServer({
      routerOptions: {
        isEnabled: () => true,
        environment: () => 'production',
        canisterUrl: 'https://mock-canister.test',
        fetchImpl: async () => ({ ok: true }),
      },
      fn: async (base) => {
        const res = await fetch(`${base}/scooling/write-back/smoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload()),
        });
        assert.equal(res.status, 404);
      },
    });
  });

  it('returns safe metadata only and performs no write calls', async () => {
    const upstreamCalls = [];
    await withSmokeServer({
      routerOptions: {
        isEnabled: () => true,
        environment: () => 'staging',
        canisterUrl: 'https://mock-canister.test',
        nowIso: () => '2026-05-23T11:00:00.000Z',
        fetchImpl: async (url, opts) => {
          upstreamCalls.push({ url: String(url), method: opts?.method || 'GET' });
          return { ok: true };
        },
      },
      fn: async (base) => {
        const res = await fetch(`${base}/scooling/write-back/smoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload()),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body, {
          ok: true,
          checkedAtIso: '2026-05-23T11:00:00.000Z',
          targetId: 'phase-2-hosted-knowtation-staging',
          metadataRead: true,
          proposalDryRun: true,
          conflictCheckDryRun: true,
          liveWriteDenied: true,
          containsRawCredentials: false,
          performedLiveWrite: false,
        });
      },
    });

    assert.deepEqual(upstreamCalls, [
      { url: 'https://mock-canister.test/health', method: 'GET' },
    ]);
  });

  it('rejects unsafe payloads without probing upstream metadata', async () => {
    const upstreamCalls = [];
    await withSmokeServer({
      routerOptions: {
        isEnabled: () => true,
        environment: () => 'staging',
        canisterUrl: 'https://mock-canister.test',
        fetchImpl: async (url, opts) => {
          upstreamCalls.push({ url: String(url), method: opts?.method || 'GET' });
          return { ok: true };
        },
      },
      fn: async (base) => {
        const res = await fetch(`${base}/scooling/write-back/smoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload(), allowLiveWrite: true }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.containsRawCredentials, false);
        assert.equal(body.performedLiveWrite, false);
      },
    });

    assert.deepEqual(upstreamCalls, []);
  });

  it('fails closed when canister metadata is unavailable', async () => {
    await withSmokeServer({
      routerOptions: {
        isEnabled: () => true,
        environment: () => 'staging',
        canisterUrl: 'https://mock-canister.test',
        fetchImpl: async () => ({ ok: false }),
      },
      fn: async (base) => {
        const res = await fetch(`${base}/scooling/write-back/smoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload()),
        });
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.equal(body.containsRawCredentials, false);
        assert.equal(body.performedLiveWrite, false);
      },
    });
  });
});
