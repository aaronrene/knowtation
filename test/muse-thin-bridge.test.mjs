/**
 * Muse thin bridge (Option C): config, normalize, resolve, proxy path allowlist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMuseConfigFromEnv,
  normalizeExternalRef,
  resolveExternalRefForApprove,
  isAllowedMuseProxyPath,
  parseMuseProxyPathPrefixes,
  proposalIdFromApprovePath,
  MUSE_LINEAGE_REF_PATH,
} from '../lib/muse-thin-bridge.mjs';

describe('muse-thin-bridge', () => {
  it('parseMuseConfigFromEnv returns null when MUSE_URL unset', () => {
    const c = parseMuseConfigFromEnv({});
    assert.equal(c, null);
  });

  it('parseMuseConfigFromEnv parses base URL and optional key', () => {
    const c = parseMuseConfigFromEnv({
      MUSE_URL: 'https://muse.example.com/',
      MUSE_API_KEY: 'secret',
      MUSE_LINEAGE_TIMEOUT_MS: '3000',
    });
    assert.ok(c);
    assert.strictEqual(c.baseUrl, 'https://muse.example.com');
    assert.strictEqual(c.apiKey, 'secret');
    assert.strictEqual(c.lineageTimeoutMs, 3000);
  });

  it('parseMuseConfigFromEnv rejects non-http(s) URL', () => {
    assert.equal(parseMuseConfigFromEnv({ MUSE_URL: 'ftp://x' }), null);
    assert.equal(parseMuseConfigFromEnv({ MUSE_URL: 'not-a-url' }), null);
  });

  it('normalizeExternalRef trims and rejects control chars and oversize', () => {
    assert.strictEqual(normalizeExternalRef('  abc  '), 'abc');
    assert.strictEqual(normalizeExternalRef('a\nb'), '');
    assert.strictEqual(normalizeExternalRef('x'), 'x');
    assert.strictEqual(normalizeExternalRef('a'.repeat(600)), '');
  });

  it('resolveExternalRefForApprove prefers client ref over fetch', async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return /** @type {any} */ ({ ok: true, text: async () => '{"external_ref":"bad"}' });
    };
    const r = await resolveExternalRefForApprove({
      clientRef: 'client-wins',
      proposalId: 'p1',
      vaultId: 'default',
      config: parseMuseConfigFromEnv({ MUSE_URL: 'https://m.example' }),
      fetchFn,
    });
    assert.strictEqual(r, 'client-wins');
    assert.strictEqual(called, false);
  });

  it('resolveExternalRefForApprove uses JSON external_ref when client empty', async () => {
    const fetchFn = async (url) => {
      assert.match(String(url), /\/knowtation\/v1\/lineage-ref\?/);
      assert.match(String(url), /proposal_id=p1/);
      return /** @type {any} */ ({ ok: true, text: async () => '{"external_ref":"muse-commit-9"}' });
    };
    const r = await resolveExternalRefForApprove({
      clientRef: '',
      proposalId: 'p1',
      vaultId: 'v1',
      config: parseMuseConfigFromEnv({ MUSE_URL: 'https://m.example' }),
      fetchFn,
    });
    assert.strictEqual(r, 'muse-commit-9');
  });

  it('resolveExternalRefForApprove returns empty on fetch failure without throwing', async () => {
    const warnings = [];
    const fetchFn = async () => {
      throw new Error('network down');
    };
    const r = await resolveExternalRefForApprove({
      clientRef: '',
      proposalId: 'p1',
      vaultId: 'default',
      config: parseMuseConfigFromEnv({ MUSE_URL: 'https://m.example' }),
      fetchFn,
      logWarn: (msg, extra) => warnings.push({ msg, extra }),
    });
    assert.strictEqual(r, '');
    assert.ok(warnings.some((w) => String(w.msg).includes('knowtation:muse-bridge')));
  });

  it('proposalIdFromApprovePath extracts id', () => {
    assert.strictEqual(proposalIdFromApprovePath('/api/v1/proposals/abc/approve'), 'abc');
    assert.strictEqual(proposalIdFromApprovePath('/api/v1/proposals/abc/approve/'), 'abc');
    assert.strictEqual(proposalIdFromApprovePath('/api/v1/notes/x'), null);
  });

  it('isAllowedMuseProxyPath respects prefixes', () => {
    const p = ['/knowtation/v1/'];
    assert.strictEqual(isAllowedMuseProxyPath('/knowtation/v1/foo', p), true);
    assert.strictEqual(isAllowedMuseProxyPath('/other/foo', p), false);
    assert.strictEqual(isAllowedMuseProxyPath('/knowtation/v1/../etc', p), false);
  });

  it('MUSE_LINEAGE_REF_PATH is documented path', () => {
    assert.strictEqual(MUSE_LINEAGE_REF_PATH, '/knowtation/v1/lineage-ref');
  });

  it('parseMuseProxyPathPrefixes splits comma list', () => {
    const env = { MUSE_PROXY_PATH_PREFIXES: '/a/, /b/' };
    assert.deepStrictEqual(parseMuseProxyPathPrefixes(env), ['/a/', '/b/']);
  });
});
