import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  evaluateUpdateManifest,
  parseUpdateManifest,
  persistUpdateFloor,
  readPersistedUpdateFloor,
  verifyUpdateSignature,
} from '../companion/runtime/update-verifier.mjs';

function manifest(overrides = {}) {
  return {
    schema: 1,
    channel: 'stable',
    platform: 'macos',
    architecture: 'arm64',
    keyID: 'release-key-1',
    issuedAt: 1000,
    expiresAt: 2000,
    source: { minimumBuild: 100, maximumBuild: 100 },
    target: {
      version: '0.1.1',
      build: 101,
      packageURL: 'https://releases.knowtation.store/stable/Knowtation.pkg',
      packageSHA256: 'a'.repeat(64),
      packageBytes: 1024,
    },
    minimumAcceptedBuild: 100,
    ...overrides,
  };
}

const context = {
  channel: 'stable',
  platform: 'macos',
  architecture: 'arm64',
  keyID: 'release-key-1',
  now: 1500,
  currentBuild: 100,
  persistedFloor: 100,
};

test('accepts a signed forward update and rejects a tampered signature', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const bytes = Buffer.from(JSON.stringify(manifest()));
  const signature = crypto.sign(null, bytes, privateKey);
  assert.equal(verifyUpdateSignature({ manifestBytes: bytes, signature, publicKey }), true);
  assert.equal(verifyUpdateSignature({ manifestBytes: Buffer.from(`${bytes} `), signature, publicKey }), false);
  assert.equal(evaluateUpdateManifest(parseUpdateManifest(bytes), context).build, 101);
});

test('rejects rollback, replay, source substitution, stale, wrong-key, and wrong-platform manifests', () => {
  const cases = [
    [manifest({ target: { ...manifest().target, build: 99 } }), 'update_target_not_newer'],
    [manifest({ target: { ...manifest().target, build: 100 } }), 'update_target_not_newer'],
    [manifest({ source: { minimumBuild: 99, maximumBuild: 99 } }), 'update_source_mismatch'],
    [manifest({ expiresAt: 1400 }), 'update_expired'],
    [manifest({ keyID: 'substituted-key' }), 'update_key_mismatch'],
    [manifest({ platform: 'linux' }), 'update_platform_mismatch'],
    [manifest({ architecture: 'x64' }), 'update_architecture_mismatch'],
    [manifest({ minimumAcceptedBuild: 102 }), 'update_rollback_rejected'],
  ];
  for (const [candidate, expected] of cases) {
    assert.throws(() => evaluateUpdateManifest(candidate, context), { code: expected });
  }
});

test('persists a monotonic rollback floor through custody', async () => {
  const store = new Map();
  const custody = {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => { store.set(key, value); },
  };
  assert.equal(await readPersistedUpdateFloor(custody), 0);
  await persistUpdateFloor(custody, 101, 100);
  assert.equal(await readPersistedUpdateFloor(custody), 101);
  await assert.rejects(() => persistUpdateFloor(custody, 100, 101), { code: 'update_rollback_rejected' });
});

test('release verifier binds signature, public trust, source revision, and package bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-update-release-'));
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const packageFile = path.join(root, 'Knowtation-0.1.0-100-macos-arm64.pkg');
    const packageBytes = Buffer.from('signed package fixture');
    fs.writeFileSync(packageFile, packageBytes);
    const candidate = manifest({
      target: {
        version: '0.1.0',
        build: 100,
        packageURL: 'https://releases.knowtation.store/stable/Knowtation-0.1.0-100-macos-arm64.pkg',
        packageSHA256: crypto.createHash('sha256').update(packageBytes).digest('hex'),
        packageBytes: packageBytes.length,
      },
      sourceRevision: {
        status: 'committed',
        muse: `sha256:${'a'.repeat(64)}`,
        github: 'b'.repeat(40),
      },
      artifacts: [{
        path: path.basename(packageFile),
        sha256: crypto.createHash('sha256').update(packageBytes).digest('hex'),
        bytes: packageBytes.length,
        executable: false,
      }],
    });
    const manifestFile = path.join(root, 'release-manifest.json');
    const signatureFile = path.join(root, 'release-manifest.sig');
    const publicFile = path.join(root, 'public.pem');
    const trustFile = path.join(root, 'update-trust.json');
    const manifestBytes = Buffer.from(JSON.stringify(candidate));
    fs.writeFileSync(manifestFile, manifestBytes);
    fs.writeFileSync(signatureFile, crypto.sign(null, manifestBytes, privateKey));
    fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(trustFile, JSON.stringify({
      schema: 1,
      algorithm: 'Ed25519',
      activeKey: {
        keyID: 'release-key-1',
        publicKey: Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64'),
      },
      revokedKeyIDs: [],
      minimumAcceptedBuild: 100,
    }));
    const args = [
      'scripts/release/macos/verify-update-manifest.mjs',
      '--manifest', manifestFile,
      '--signature', signatureFile,
      '--public-key-file', publicFile,
      '--trust', trustFile,
      '--package', packageFile,
    ];
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
    fs.writeFileSync(packageFile, 'substituted package');
    const substituted = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(substituted.status, 0);
    assert.match(substituted.stderr, /package does not match signed manifest|artifact does not match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
