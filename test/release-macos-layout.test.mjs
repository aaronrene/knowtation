import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const release = JSON.parse(fs.readFileSync('release/macos/release.json', 'utf8'));
const appPlist = fs.readFileSync('release/macos/plists/App-Info.plist', 'utf8');
const agentPlist = fs.readFileSync('release/macos/plists/LaunchAgent.plist', 'utf8');
const distribution = fs.readFileSync('release/macos/Distribution.xml', 'utf8');
const preinstall = fs.readFileSync('release/macos/pkg-scripts/preinstall', 'utf8');

test('release identity, platform, and installer metadata agree', () => {
  assert.equal(release.version, '0.1.0');
  assert.equal(release.build, 100);
  assert.deepEqual(release.architectures, ['arm64']);
  assert.equal(release.minimumMacOS, '14.0');
  assert.equal(release.hosted.origin, 'https://mcp.knowtation.store');
  assert.equal(release.hosted.nativeOAuthIssuer, `${release.hosted.origin}/api/v1/auth/native`);
  assert.deepEqual(release.hosted.scopes, ['vault:read', 'vault:write']);
  assert.deepEqual(
    release.optionalExternalTools.map((entry) => entry.command),
    ['git', 'muse'],
  );
  assert.ok(release.optionalExternalTools.every((entry) => entry.bundled === false));
  assert.match(appPlist, /store\.knowtation\.companion/);
  assert.match(appPlist, /<string>0\.1\.0<\/string>/);
  assert.match(appPlist, /<string>100<\/string>/);
  assert.match(agentPlist, /store\.knowtation\.companion\.custody/);
  assert.match(agentPlist, /<key>MachServices<\/key>/);
  assert.match(agentPlist, /<key>BundleProgram<\/key>/);
  assert.match(distribution, /min="14\.0"/);
  assert.match(distribution, /store\.knowtation\.pkg/);
  assert.match(distribution, /require-scripts="true"/);
  assert.match(preinstall, /installed_build > 100/);
  assert.match(preinstall, /rollback is rejected/);
});

test('release entitlements do not disable library validation or permit debugging', () => {
  for (const file of [
    'release/macos/entitlements/app.plist',
    'release/macos/entitlements/custody.plist',
    'release/macos/entitlements/launcher.plist',
    'release/macos/entitlements/runtime.plist',
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /get-task-allow/);
    assert.doesNotMatch(text, /disable-library-validation/);
  }
});
