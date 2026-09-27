#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return process.argv[index + 1];
}

const manifest = fs.readFileSync(option('manifest'));
const signature = fs.readFileSync(option('signature'));
const publicKey = crypto.createPublicKey(fs.readFileSync(option('public-key-file')));
const trust = JSON.parse(fs.readFileSync(option('trust'), 'utf8'));
const packageFile = option('package');
if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('update public key must be Ed25519');
if (!crypto.verify(null, manifest, publicKey, signature)) throw new Error('update manifest signature invalid');
const parsed = JSON.parse(manifest.toString('utf8'));
const publicJwk = publicKey.export({ format: 'jwk' });
const rawPublicKey = Buffer.from(publicJwk.x, 'base64url').toString('base64');
if (trust.algorithm !== 'Ed25519' ||
    trust.activeKey?.keyID !== parsed.keyID ||
    trust.activeKey?.publicKey !== rawPublicKey ||
    trust.revokedKeyIDs?.includes(parsed.keyID)) {
  throw new Error('update trust, key ID, and public key do not match');
}
const packageBytes = fs.readFileSync(packageFile);
const packageSHA256 = crypto.createHash('sha256').update(packageBytes).digest('hex');
if (parsed.target?.packageSHA256 !== packageSHA256 ||
    parsed.target?.packageBytes !== packageBytes.length ||
    path.basename(new URL(parsed.target?.packageURL).pathname) !== path.basename(packageFile)) {
  throw new Error('update package does not match signed manifest');
}
if (parsed.schema !== 1 || parsed.platform !== 'macos' || parsed.architecture !== 'arm64' ||
    !Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt) ||
    parsed.expiresAt <= parsed.issuedAt || parsed.minimumAcceptedBuild < trust.minimumAcceptedBuild ||
    parsed.sourceRevision?.status !== 'committed') {
  throw new Error('update manifest policy is invalid');
}
const dist = path.dirname(path.resolve(option('manifest')));
for (const artifact of parsed.artifacts ?? []) {
  if (typeof artifact.path !== 'string' || path.basename(artifact.path) !== artifact.path) {
    throw new Error('update manifest artifact path is invalid');
  }
  const bytes = fs.readFileSync(path.join(dist, artifact.path));
  const artifactHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (artifact.sha256 !== artifactHash || artifact.bytes !== bytes.length) {
    throw new Error(`release artifact does not match signed manifest: ${artifact.path}`);
  }
}
process.stdout.write('update manifest signature, trust, source, and package verified\n');
