/**
 * URL fetch guardrails for import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrBlockedIp, fetchUrlForImport } from '../lib/url-fetch-safe.mjs';

describe('url-fetch-safe', () => {
  it('isPrivateOrBlockedIp marks loopback and RFC1918', () => {
    assert.equal(isPrivateOrBlockedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrBlockedIp('10.0.0.1'), true);
    assert.equal(isPrivateOrBlockedIp('192.168.1.1'), true);
    assert.equal(isPrivateOrBlockedIp('::1'), true);
    assert.equal(isPrivateOrBlockedIp('fe80::1'), true);
    assert.equal(isPrivateOrBlockedIp('fd00::1'), true);
  });

  it('rejects http scheme', async () => {
    await assert.rejects(() => fetchUrlForImport('http://example.com/'), /Only https/);
  });

  it('rejects localhost hostname', async () => {
    await assert.rejects(() => fetchUrlForImport('https://localhost/foo'), /localhost/);
  });
});
