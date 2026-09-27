import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

const custodyIdentifier = 'C72VAF2EM2.store.knowtation.companion.custody';
for (const [name, applicationIdentifier, keychainGroup, accepted] of [
  ['correct application identifier and Keychain group', custodyIdentifier, custodyIdentifier, true],
  ['missing application identifier', null, custodyIdentifier, false],
  ['incorrect application identifier', 'wrong.custody', custodyIdentifier, false],
  ['missing Keychain group', custodyIdentifier, null, false],
  ['incorrect Keychain group', custodyIdentifier, 'wrong.custody', false],
]) {
  test(`release custody entitlement checks: ${name}`, { skip: process.platform !== 'darwin' }, () => {
    // Run the verifier's actual shell checks against the real macOS plutil.
    const verifier = fs.readFileSync('scripts/release/macos/verify.sh', 'utf8');
    const checks = verifier.match(/^test "\$\(plutil -extract [\s\S]*?(?=^pkgutil --check-signature)/m)?.[0];
    assert.ok(checks, 'custody entitlement checks must be present');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-entitlements-'));
    try {
      const appEntry = applicationIdentifier === null ? '' :
        `<key>com.apple.application-identifier</key><string>${applicationIdentifier}</string>`;
      const groupEntry = keychainGroup === null ? '' :
        `<key>keychain-access-groups</key><array><string>${keychainGroup}</string></array>`;
      fs.writeFileSync(path.join(root, 'custody-entitlements.plist'),
        `<?xml version="1.0"?><plist version="1.0"><dict>${appEntry}${groupEntry}</dict></plist>`);
      const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', checks], {
        encoding: 'utf8',
        env: { ...process.env, verification_tmp: root, KNOWTATION_APPLE_TEAM_ID: 'C72VAF2EM2' },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, accepted ? 0 : 1, result.stdout + result.stderr);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

const releaseVerifier = fs.readFileSync('scripts/release/macos/verify.sh', 'utf8');
const executablePaths = [
  'Contents/MacOS/Knowtation',
  'Contents/Helpers/knowtation',
  'Contents/Helpers/knowtation-mcp',
  'Contents/Resources/runtime/node/bin/node',
];
const architectureChecks = releaseVerifier.match(/^lipo .*$/gm) ?? [];

test('release executable checks put each input before the lipo architecture list', () => {
  assert.deepEqual(architectureChecks, executablePaths.map((file) =>
    `lipo "$app/${file}" -verify_arch arm64`));
  assert.ok(releaseVerifier.includes("plutil -extract 'com\\.apple\\.application-identifier' raw"));
  assert.ok(releaseVerifier.includes('plutil -extract keychain-access-groups.0 raw'));
});

test('release executable checks accept arm64 and reject an absent architecture with real lipo', {
  skip: process.platform === 'darwin' ? false : 'requires macOS lipo and clang',
}, () => {
  assert.equal(architectureChecks.length, executablePaths.length);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-lipo-'));
  try {
    const fixture = path.join(root, 'arm64.o');
    const compiled = spawnSync('/usr/bin/xcrun', [
      'clang', '-arch', 'arm64', '-x', 'c', '-c', '-o', fixture, '-',
    ], { encoding: 'utf8', input: 'int architecture_fixture(void) { return 0; }\n' });
    assert.ifError(compiled.error);
    assert.equal(compiled.signal, null);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const architectures = spawnSync('/usr/bin/lipo', [fixture, '-archs'], { encoding: 'utf8' });
    assert.ifError(architectures.error);
    assert.equal(architectures.status, 0, architectures.stdout + architectures.stderr);
    assert.equal(architectures.stdout.trim(), 'arm64');

    const app = path.join(root, 'Knowtation fixture.app');
    for (const file of executablePaths) {
      const target = path.join(app, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(fixture, target);
    }
    for (const check of architectureChecks) {
      for (const [command, expectedStatus] of [
        [check, 0],
        [check.replace('-verify_arch arm64', '-verify_arch x86_64'), 1],
      ]) {
        // Execute the verifier's actual invocation with Apple's lipo, without running the release verifier.
        const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', command], {
          encoding: 'utf8',
          env: { ...process.env, app, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        assert.equal(result.status, expectedStatus, `${command}\n${result.stdout}${result.stderr}`);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
