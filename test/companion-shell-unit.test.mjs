/**
 * Tier 1 — UNIT: Phase 5 companion shell and I/O adapters.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { KEYCHAIN_ACCOUNTS } from '../lib/companion-token-custody.mjs';
import {
  KEYCHAIN_ADAPTER_REASONS,
  requireKeychainSecret,
  requireKnownKeychainAccount,
} from '../lib/companion-keychain-adapter.mjs';
import { buildAllowedHosts } from '../lib/companion-inference-listener.mjs';
import {
  SECRET_ENV_KEY_PATTERNS,
  buildRuntimeArgv,
  createScrubbedRuntimeEnv,
} from '../lib/companion-spawn-adapter.mjs';
import { requireHttpsDownloadUrl } from '../lib/companion-download-adapter.mjs';
import { requireRuntimePid } from '../lib/companion-resource-probe.mjs';
import {
  computeCompanionAvailable,
  createRuntimeGroup,
  validateManifestTrustAnchor,
} from '../lib/companion-shell.mjs';

describe('keychain adapter surface', () => {
  it('accepts only the four custody accounts', () => {
    for (const account of Object.values(KEYCHAIN_ACCOUNTS)) {
      assert.equal(requireKnownKeychainAccount(account), account);
    }
    assert.throws(
      () => requireKnownKeychainAccount('knowtation.companion.other'),
      { message: KEYCHAIN_ADAPTER_REASONS.UNKNOWN_ACCOUNT },
    );
  });

  it('rejects empty and oversized secrets', () => {
    assert.throws(() => requireKeychainSecret(''));
    assert.throws(() => requireKeychainSecret('x'.repeat(8193)));
    assert.equal(requireKeychainSecret('ok-secret'), 'ok-secret');
  });
});

describe('loopback bind helpers', () => {
  it('builds allowed hosts from an IPv4 loopback port', () => {
    assert.deepEqual(buildAllowedHosts({ host: '127.0.0.1', port: 49152 }), [
      '127.0.0.1:49152',
      'localhost:49152',
    ]);
  });

  it('rejects wildcard bind helpers', () => {
    assert.throws(() => buildAllowedHosts({ host: '0.0.0.0', port: 49152 }));
    assert.throws(() => buildAllowedHosts({ host: '::', port: 49152 }));
  });
});

describe('spawn adapter helpers', () => {
  it('scrubs secret-bearing environment keys', () => {
    const env = createScrubbedRuntimeEnv({
      HOME: '/home/a',
      PATH: '/bin',
      SESSION_SECRET: 'secret',
      OPENAI_API_KEY: 'secret',
      REFRESH_TOKEN: 'secret',
      JWT: 'secret',
    });
    assert.deepEqual(env, { HOME: '/home/a', PATH: '/bin' });
  });

  it('builds argv from inert values only', () => {
    const argv = buildRuntimeArgv({
      modelPath: '/models/verified.gguf',
      port: 41234,
      maxRamBytes: 1024,
    });
    assert.deepEqual(argv, [
      '--host', '127.0.0.1',
      '--port', '41234',
      '--model', '/models/verified.gguf',
      '--max-ram-bytes', '1024',
    ]);
  });

  it('secret env patterns cover API keys, tokens, JWTs, and keychain refs', () => {
    for (const key of ['SESSION_SECRET', 'OPENAI_API_KEY', 'JWT', 'REFRESH_TOKEN', 'KEYCHAIN_REF']) {
      assert.equal(SECRET_ENV_KEY_PATTERNS.some((pattern) => pattern.test(key)), true, key);
    }
  });
});

describe('download and resource helpers', () => {
  it('download URLs must be HTTPS', () => {
    assert.equal(requireHttpsDownloadUrl('https://models.example.com/m.bin').protocol, 'https:');
    assert.throws(() => requireHttpsDownloadUrl('http://models.example.com/m.bin'));
  });

  it('resource probe requires a positive runtime PID', () => {
    assert.equal(requireRuntimePid(123), 123);
    assert.throws(() => requireRuntimePid(0));
    assert.throws(() => requireRuntimePid(-1));
  });
});

describe('companionAvailable predicate', () => {
  const ready = { state: 'ready' };

  it('is true only when every Phase 5 readiness condition holds', () => {
    assert.equal(computeCompanionAvailable({
      integrityVerified: true,
      lifecycleState: ready,
      lastHealthOkAt: 1000,
      now: 1100,
      listenerBound: true,
      loopbackTokenPresent: true,
      healthRecencyMs: 500,
    }), true);
  });

  it('fails closed for stale health, missing token, or missing integrity', () => {
    assert.equal(computeCompanionAvailable({ integrityVerified: false, lifecycleState: ready, lastHealthOkAt: 1000, now: 1100, listenerBound: true, loopbackTokenPresent: true }), false);
    assert.equal(computeCompanionAvailable({ integrityVerified: true, lifecycleState: ready, lastHealthOkAt: 1000, now: 20_000, listenerBound: true, loopbackTokenPresent: true }), false);
    assert.equal(computeCompanionAvailable({ integrityVerified: true, lifecycleState: ready, lastHealthOkAt: 1000, now: 1100, listenerBound: true, loopbackTokenPresent: false }), false);
  });
});

describe('manifest and runtime group shape', () => {
  it('requires the manifest origin to be out-of-band from model bytes', () => {
    assert.equal(validateManifestTrustAnchor({
      manifestUrl: 'https://gateway.knowtation.com/models/manifest.json',
      modelUrl: 'https://cdn.knowtation-models.com/model.bin',
      expectedDigest: 'a'.repeat(64),
      expectedSizeBytes: 12,
      allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
    }).ok, true);
    assert.equal(validateManifestTrustAnchor({
      manifestUrl: 'https://cdn.knowtation-models.com/manifest.json',
      modelUrl: 'https://cdn.knowtation-models.com/model.bin',
      expectedDigest: 'a'.repeat(64),
      expectedSizeBytes: 12,
      allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
    }).ok, false);
  });

  it('runtime group exposes no authority accessors', () => {
    const group = createRuntimeGroup({
      spawn: async () => ({ pid: 1, kill: async () => {} }),
      download: async () => {},
      healthCheck: async () => true,
    });
    assert.deepEqual(Object.keys(group).sort(), ['download', 'healthCheck', 'spawn', 'statResources'].sort());
  });
});
