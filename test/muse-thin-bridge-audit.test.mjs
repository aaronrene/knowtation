/**
 * Audit-level tests for Muse thin bridge: env edge cases, proxy limits, path hardening, JSON shapes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMuseConfigFromEnv,
  normalizeExternalRef,
  resolveExternalRefForApprove,
  isAllowedMuseProxyPath,
  fetchMuseProxiedGet,
} from '../lib/muse-thin-bridge.mjs';

describe('muse-thin-bridge audit — env numeric hardening', () => {
  it('parseMuseConfigFromEnv uses defaults when MUSE_LINEAGE_TIMEOUT_MS is non-numeric', () => {
    const c = parseMuseConfigFromEnv({
      MUSE_URL: 'https://muse.example.com',
      MUSE_LINEAGE_TIMEOUT_MS: 'not-a-number',
    });
    assert.ok(c);
    assert.strictEqual(c.lineageTimeoutMs, 5000);
  });

  it('parseMuseConfigFromEnv uses defaults when MUSE_PROXY_MAX_BYTES is non-numeric', () => {
    const c = parseMuseConfigFromEnv({
      MUSE_URL: 'https://muse.example.com',
      MUSE_PROXY_MAX_BYTES: 'xyz',
    });
    assert.ok(c);
    assert.strictEqual(c.proxyMaxBytes, 1024 * 1024);
  });

  it('parseMuseConfigFromEnv honors valid numeric overrides', () => {
    const c = parseMuseConfigFromEnv({
      MUSE_URL: 'https://m.example',
      MUSE_LINEAGE_TIMEOUT_MS: '8000',
      MUSE_PROXY_MAX_BYTES: '2048',
    });
    assert.ok(c);
    assert.strictEqual(c.lineageTimeoutMs, 8000);
    assert.strictEqual(c.proxyMaxBytes, 2048);
  });

  it('parseMuseConfigFromEnv clamps lineage timeout to 60s max', () => {
    const c = parseMuseConfigFromEnv({
      MUSE_URL: 'https://m.example',
      MUSE_LINEAGE_TIMEOUT_MS: '999999',
    });
    assert.ok(c);
    assert.strictEqual(c.lineageTimeoutMs, 60_000);
  });
});

describe('muse-thin-bridge audit — proxy path hardening', () => {
  const prefixes = ['/knowtation/v1/'];

  it('rejects encoded path segments that decode to parent traversal', () => {
    assert.strictEqual(isAllowedMuseProxyPath('/%2e%2e%2fetc/passwd', prefixes), false);
    assert.strictEqual(isAllowedMuseProxyPath('/knowtation/v1/../secret', prefixes), false);
  });

  it('allows normal path under prefix', () => {
    assert.strictEqual(isAllowedMuseProxyPath('/knowtation/v1/commits/abc', prefixes), true);
  });
});

describe('muse-thin-bridge audit — fetchMuseProxiedGet', () => {
  it('returns BAD_GATEWAY when response exceeds proxyMaxBytes', async () => {
    const cfg = parseMuseConfigFromEnv({
      MUSE_URL: 'https://upstream.test',
      MUSE_PROXY_MAX_BYTES: '50',
    });
    assert.ok(cfg);
    const big = Buffer.alloc(200, 0x61);
    const fetchFn = async () =>
      /** @type {any} */ ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/octet-stream' },
        arrayBuffer: async () => big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
      });
    const r = await fetchMuseProxiedGet({
      config: { ...cfg, proxyMaxBytes: 50 },
      relativePath: '/knowtation/v1/blob',
      fetchFn,
      logWarn: () => {},
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'BAD_GATEWAY');
  });

  it('returns UPSTREAM with body when Muse returns 404', async () => {
    const cfg = parseMuseConfigFromEnv({ MUSE_URL: 'https://upstream.test' });
    assert.ok(cfg);
    const errBody = Buffer.from('not found');
    const fetchFn = async () =>
      /** @type {any} */ ({
        ok: false,
        status: 404,
        headers: { get: () => 'text/plain' },
        arrayBuffer: async () => errBody.buffer.slice(errBody.byteOffset, errBody.byteOffset + errBody.byteLength),
      });
    const r = await fetchMuseProxiedGet({
      config: cfg,
      relativePath: '/knowtation/v1/missing',
      fetchFn,
      logWarn: () => {},
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'UPSTREAM');
    assert.strictEqual(r.status, 404);
    assert.ok(r.body && Buffer.compare(r.body, errBody) === 0);
  });
});

describe('muse-thin-bridge audit — resolveExternalRef JSON shapes', () => {
  it('ignores non-string external_ref in JSON response', async () => {
    const fetchFn = async () =>
      /** @type {any} */ ({
        ok: true,
        text: async () => '{"external_ref":999}',
      });
    const r = await resolveExternalRefForApprove({
      clientRef: '',
      proposalId: 'p1',
      vaultId: 'default',
      config: parseMuseConfigFromEnv({ MUSE_URL: 'https://m.example' }),
      fetchFn,
      logWarn: () => {},
    });
    assert.strictEqual(r, '');
  });

  it('normalizes oversized external_ref from Muse JSON to empty', async () => {
    const huge = 'x'.repeat(600);
    const fetchFn = async () =>
      /** @type {any} */ ({
        ok: true,
        text: async () => JSON.stringify({ external_ref: huge }),
      });
    const r = await resolveExternalRefForApprove({
      clientRef: '',
      proposalId: 'p1',
      vaultId: 'default',
      config: parseMuseConfigFromEnv({ MUSE_URL: 'https://m.example' }),
      fetchFn,
      logWarn: () => {},
    });
    assert.strictEqual(r, '');
  });
});

describe('muse-thin-bridge audit — normalizeExternalRef edge cases', () => {
  it('rejects tab and DEL', () => {
    assert.strictEqual(normalizeExternalRef('a\tb'), '');
    assert.strictEqual(normalizeExternalRef('a\u007fb'), '');
  });

  it('allows common ref-safe punctuation', () => {
    assert.strictEqual(normalizeExternalRef('commit:abc-123_456'), 'commit:abc-123_456');
  });
});
