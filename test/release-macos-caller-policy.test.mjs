import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('custody authenticates the XPC message sender and admits only fixed signed identifiers', () => {
  const identity = fs.readFileSync(
    'companion/macos/Sources/KnowtationSecurity/CallerIdentity.swift',
    'utf8'
  );
  const contract = fs.readFileSync(
    'companion/macos/Sources/KnowtationSecurity/ReleaseContract.swift',
    'utf8'
  );
  assert.match(identity, /SecCodeCreateWithXPCMessage/);
  assert.match(identity, /SecCodeCheckValidity/);
  assert.doesNotMatch(identity, /processIdentifier/);
  for (const id of ['store.knowtation.companion', 'store.knowtation.cli', 'store.knowtation.mcp']) {
    assert.match(contract, new RegExp(id.replaceAll('.', '\\.')));
  }
});

test('runtime launcher fixes app, Node, and entrypoint paths and strips injection variables', () => {
  const launcher = fs.readFileSync(
    'companion/macos/Sources/KnowtationSecurity/RuntimeLauncher.swift',
    'utf8'
  );
  assert.match(launcher, /\/Applications\/Knowtation\.app/);
  assert.match(launcher, /appendingPathComponent\("runtime"/);
  assert.match(launcher, /appendingPathComponent\("node\/bin\/node"/);
  assert.match(launcher, /companion\/runtime\/main\.mjs/);
  assert.match(launcher, /expectedIdentifier: KnowtationReleaseContract\.appIdentifier/);
  assert.match(launcher, /expectedIdentifier: KnowtationReleaseContract\.nodeIdentifier/);
  assert.match(launcher, /NODE_OPTIONS/);
  assert.match(launcher, /KNOWTATION_HUB_TOKEN/);
  assert.match(launcher, /NODE_EXTRA_CA_CERTS/);
  assert.match(launcher, /HTTPS_PROXY/);
  assert.match(launcher, /\/usr\/bin:\/bin:\/usr\/sbin:\/sbin:\/usr\/local\/bin:\/opt\/homebrew\/bin/);
  assert.match(launcher, /DYLD_/);
  assert.doesNotMatch(launcher, /--script|scriptPath/);
});

test('custody uses device-bound Keychain storage and never logs values', () => {
  const agent = fs.readFileSync('companion/macos/Sources/KnowtationCustodyAgent/main.swift', 'utf8');
  assert.match(agent, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(agent, /kSecUseDataProtectionKeychain/);
  assert.match(agent, /kSecAttrAccessGroup/);
  assert.match(agent, /allowedAccounts\.contains/);
  assert.doesNotMatch(agent, /print\(/);
  assert.doesNotMatch(agent, /NSLog/);
});
