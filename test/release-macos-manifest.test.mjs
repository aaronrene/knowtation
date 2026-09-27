import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function makeApp(root) {
  const resources = path.join(root, 'Knowtation.app/Contents/Resources');
  fs.mkdirSync(path.join(resources, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'runtime/data.txt'), 'deterministic payload');
  fs.writeFileSync(path.join(resources, 'runtime/tool'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return path.dirname(path.dirname(resources));
}

function generate(app, output) {
  return spawnSync(process.execPath, [
    'scripts/release/macos/generate-manifest.mjs',
    '--stage', 'unsigned',
    '--app', app,
    '--output', output,
  ], {
    encoding: 'utf8',
    env: { ...process.env, KNOWTATION_ALLOW_UNCOMMITTED_BUILD: '1' },
  });
}

test('unsigned runtime manifest is deterministic and records mode, size, and digest', () => {
  const one = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-manifest-one-'));
  const two = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-manifest-two-'));
  try {
    const appOne = makeApp(one);
    const appTwo = makeApp(two);
    const outputOne = path.join(appOne, 'Contents/Resources/runtime-manifest.json');
    const outputTwo = path.join(appTwo, 'Contents/Resources/runtime-manifest.json');
    assert.equal(generate(appOne, outputOne).status, 0);
    assert.equal(generate(appTwo, outputTwo).status, 0);
    assert.equal(fs.readFileSync(outputOne, 'utf8'), fs.readFileSync(outputTwo, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(outputOne, 'utf8'));
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.sourceRevision.status, 'uncommitted');
    assert.equal(manifest.files.find((entry) => entry.path === 'runtime/tool').executable, true);
    assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(one, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });
  }
});

test('release manifest generation rejects an uncommitted source identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-final-manifest-'));
  try {
    const pkg = path.join(root, 'Knowtation-0.1.0-100-macos-arm64.pkg');
    fs.writeFileSync(pkg, 'fixture');
    fs.writeFileSync(path.join(root, 'Knowtation-0.1.0-100-macos-arm64.zip'), 'zip fixture');
    fs.writeFileSync(path.join(root, 'sbom.spdx.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'LICENSE'), 'fixture license\n');
    fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), 'fixture\n');
    const result = spawnSync(process.execPath, [
      'scripts/release/macos/generate-manifest.mjs',
      '--stage', 'final',
      '--dist', root,
      '--output', path.join(root, 'release-manifest.json'),
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        KNOWTATION_ALLOW_UNCOMMITTED_BUILD: '1',
        KNOWTATION_UPDATE_ISSUED_AT: '1000',
        KNOWTATION_UPDATE_EXPIRES_AT: '2000',
        KNOWTATION_UPDATE_KEY_ID: 'test-release-key',
        KNOWTATION_UPDATE_SOURCE_MIN_BUILD: '0',
        KNOWTATION_UPDATE_SOURCE_MAX_BUILD: '99',
        KNOWTATION_SOURCE_MUSE_REVISION: '',
        KNOWTATION_SOURCE_GIT_REVISION: '',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact KNOWTATION_SOURCE_MUSE_REVISION/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest generation rejects symbolic links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-manifest-link-'));
  try {
    const app = makeApp(root);
    fs.symlinkSync('/etc/hosts', path.join(app, 'Contents/Resources/runtime/substitution'));
    const result = generate(app, path.join(app, 'Contents/Resources/runtime-manifest.json'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic links are forbidden/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime verifier accepts the exact generated resource tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-manifest-exact-'));
  try {
    const app = makeApp(root);
    const resources = path.join(app, 'Contents/Resources');
    fs.copyFileSync('release/macos/release-lock.json', path.join(resources, 'release-lock.json'));
    const output = path.join(resources, 'runtime-manifest.json');
    assert.equal(generate(app, output).status, 0);
    const result = spawnSync(process.execPath, [
      'scripts/release/macos/verify-runtime-manifest.mjs', '--app', app,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime verifier rejects an added file after manifest generation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-manifest-extra-'));
  try {
    const app = makeApp(root);
    const resources = path.join(app, 'Contents/Resources');
    fs.copyFileSync('release/macos/release-lock.json', path.join(resources, 'release-lock.json'));
    const output = path.join(resources, 'runtime-manifest.json');
    assert.equal(generate(app, output).status, 0);
    fs.writeFileSync(path.join(resources, 'substitution.txt'), 'unexpected');
    const result = spawnSync(process.execPath, [
      'scripts/release/macos/verify-runtime-manifest.mjs', '--app', app,
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runtime manifest file closure mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
