/**
 * Tier 7 — SECURITY: Phase 5 bind/lifecycle layer centerpiece tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import { createCompanionInferenceListener } from '../lib/companion-inference-listener.mjs';
import { createScrubbedRuntimeEnv } from '../lib/companion-spawn-adapter.mjs';
import { createCompanionResourceProbe } from '../lib/companion-resource-probe.mjs';
import {
  computeCompanionAvailable,
  validateManifestTrustAnchor,
} from '../lib/companion-shell.mjs';

function rawHttpStatus({ port, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/v1/models',
      method: 'GET',
      headers,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('architecture/import boundary', () => {
  it('runtime group modules import no authority modules', async () => {
    const files = [
      'lib/companion-spawn-adapter.mjs',
      'lib/companion-download-adapter.mjs',
      'lib/companion-resource-probe.mjs',
      'lib/companion-runtime-manager.mjs',
    ];
    const forbidden = [
      'companion-token-custody',
      'companion-oauth-pkce',
      'companion-keychain',
      'canister',
      'vault',
      'auth-session',
    ];
    for (const file of files) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const needle of forbidden) {
        assert.equal(source.includes(`from './${needle}`), false, `${file} imports ${needle}`);
        assert.equal(source.includes(`from '../${needle}`), false, `${file} imports ${needle}`);
      }
    }
  });
});

describe('child environment contains no secret', () => {
  it('strips SESSION_SECRET, token, API key, JWT, and keychain refs', () => {
    const env = createScrubbedRuntimeEnv({
      HOME: '/Users/a',
      TMPDIR: '/tmp',
      SESSION_SECRET: 's',
      ACCESS_TOKEN: 's',
      REFRESH_TOKEN: 's',
      OPENROUTER_API_KEY: 's',
      JWT: 's',
      KEYCHAIN_ACCOUNT: 's',
    });
    assert.deepEqual(env, { HOME: '/Users/a', TMPDIR: '/tmp' });
  });
});

describe('loopback-only bind and browser attack rejection', () => {
  it('rejects wildcard and routable bind hosts before listen', () => {
    assert.throws(() => createCompanionInferenceListener({ host: '0.0.0.0', expectedToken: 't', runtimeRequest() {} }));
    assert.throws(() => createCompanionInferenceListener({ host: '::', expectedToken: 't', runtimeRequest() {} }));
    assert.throws(() => createCompanionInferenceListener({ host: '192.168.1.20', expectedToken: 't', runtimeRequest() {} }));
  });

  it('DNS-rebinding host and cross-origin requests stay 403 before runtime work', async () => {
    let hits = 0;
    const listener = createCompanionInferenceListener({
      expectedToken: 'token',
      runtimeRequest(_req, res) {
        hits += 1;
        res.statusCode = 200;
        res.end('ok');
      },
    });
    const bound = await listener.start();
    try {
      const cross = await fetch(`http://127.0.0.1:${bound.port}/v1/models`, {
        headers: { Origin: 'https://attacker.example', Authorization: 'Bearer token' },
      });
      assert.equal(cross.status, 403);
      assert.equal(cross.headers.get('access-control-allow-origin'), null);
      assert.equal(hits, 0);

      const rebindStatus = await rawHttpStatus({
        port: bound.port,
        headers: { Host: `evil.example:${bound.port}`, Authorization: 'Bearer token' },
      });
      assert.equal(rebindStatus, 403);
      assert.equal(hits, 0);
    } finally {
      await listener.close();
    }
  });
});

describe('manifest trust anchor', () => {
  it('accepts first-party manifest only when it is out-of-band from the model host', () => {
    const base = {
      expectedDigest: 'b'.repeat(64),
      expectedSizeBytes: 128,
      allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
    };
    assert.equal(validateManifestTrustAnchor({
      ...base,
      manifestUrl: 'https://gateway.knowtation.com/manifest.json',
      modelUrl: 'https://cdn.knowtation-models.com/model.bin',
    }).ok, true);
    assert.equal(validateManifestTrustAnchor({
      ...base,
      manifestUrl: 'https://cdn.knowtation-models.com/manifest.json',
      modelUrl: 'https://cdn.knowtation-models.com/model.bin',
    }).ok, false);
    assert.equal(validateManifestTrustAnchor({
      ...base,
      manifestUrl: 'http://gateway.knowtation.com/manifest.json',
      modelUrl: 'https://cdn.knowtation-models.com/model.bin',
    }).ok, false);
  });
});

describe('resource probe privacy', () => {
  it('does not invoke GPU process-table tools', async () => {
    const commands = [];
    const probe = createCompanionResourceProbe({
      pid: 999,
      platform: 'darwin',
      execFile: async (cmd, args) => {
        commands.push([cmd, args]);
        return { stdout: '1024 2.5\n' };
      },
    });
    const obs = await probe.statResources();
    assert.equal(obs.vramBytes, 0);
    assert.equal(commands.some(([cmd]) => String(cmd).includes('nvidia-smi')), false);
    assert.equal(commands.some(([cmd]) => String(cmd).includes('ioreg')), false);
  });
});

describe('fail-closed companionAvailable and no secret in outputs', () => {
  it('never flips true without all readiness conditions', () => {
    assert.equal(computeCompanionAvailable({ now: 1 }), false);
    assert.equal(computeCompanionAvailable({
      now: 1,
      integrityVerified: true,
      lifecycleState: { state: 'ready' },
      lastHealthOkAt: 1,
      listenerBound: true,
      loopbackTokenPresent: false,
    }), false);
  });

  it('fixed failure reasons do not include supplied secrets', async () => {
    const listener = createCompanionInferenceListener({
      expectedToken: 'super-secret-loopback-token',
      runtimeRequest() {},
    });
    const bound = await listener.start();
    try {
      const res = await fetch(`http://127.0.0.1:${bound.port}/v1/models`, {
        headers: { Authorization: 'Bearer wrong-secret' },
      });
      const body = await res.text();
      assert.equal(body.includes('super-secret-loopback-token'), false);
      assert.equal(body.includes('wrong-secret'), false);
    } finally {
      await listener.close();
    }
  });
});
