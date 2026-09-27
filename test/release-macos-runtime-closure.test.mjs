import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const runtimePackage = JSON.parse(fs.readFileSync('companion/runtime/package.json', 'utf8'));
const runtimeLock = JSON.parse(fs.readFileSync('companion/runtime/package-lock.json', 'utf8'));
const releaseLock = JSON.parse(fs.readFileSync('release/macos/release-lock.json', 'utf8'));
const runtimeFiles = JSON.parse(fs.readFileSync('release/macos/runtime-files.json', 'utf8'));

test('standalone dependency roots resolve exactly in the dedicated lock', () => {
  assert.equal(runtimePackage.engines.node, '24.21.0');
  assert.equal(runtimePackage.engines.npm, releaseLock.node.npmVersion);
  for (const [name, version] of Object.entries(runtimePackage.dependencies)) {
    assert.equal(runtimeLock.packages[`node_modules/${name}`]?.version, version, name);
  }
  assert.equal(runtimeLock.packages['node_modules/onnxruntime-web'].version, releaseLock.runtime.onnxruntimeWeb);
  assert.equal(runtimeLock.packages['node_modules/onnxruntime-common'].version, releaseLock.runtime.onnxruntimeCommon);
  assert.match(releaseLock.model.w3BundleDigest, /^[0-9a-f]{64}$/);
  assert.ok(releaseLock.runtime.files.length >= 7);
});

test('Node and every model file have immutable HTTPS, size, and SHA-256 pins', () => {
  assert.match(releaseLock.node.url, /^https:\/\/nodejs\.org\//);
  assert.match(releaseLock.node.sha256, /^[0-9a-f]{64}$/);
  assert.ok(releaseLock.model.files.length >= 7);
  for (const file of releaseLock.model.files) {
    assert.match(file.url, /^https:\/\/huggingface\.co\//);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
});

test('native-image dependencies are explicitly excluded from the final web-WASM runtime', () => {
  assert.ok(runtimeFiles.excludedDependencyNames.includes('sharp'));
  assert.ok(runtimeFiles.excludedDependencyNames.some((name) => name.includes('libvips')));
  const build = fs.readFileSync('scripts/release/macos/build.sh', 'utf8');
  assert.match(build, /excluded sharp\/libvips dependency entered runtime closure/);
  assert.doesNotMatch(build, /--omit=optional/);
  assert.match(build, /argon2\/prebuilds/);
  assert.match(build, /sqlite-vec-darwin-arm64\/vec0\.dylib/);
  assert.match(build, /verify-module-closure\.mjs/);
});
