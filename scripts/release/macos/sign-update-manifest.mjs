#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return process.argv[index + 1];
}

const manifestPath = option('manifest');
const keyPath = option('key-file');
const outputPath = option('output');
const expectedKeyID = option('key-id');
const manifest = fs.readFileSync(manifestPath);
const parsed = JSON.parse(manifest.toString('utf8'));
if (parsed.keyID !== expectedKeyID) throw new Error('update key ID does not match manifest');
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('update key must be Ed25519');
const signature = crypto.sign(null, manifest, privateKey);
fs.writeFileSync(outputPath, signature, { mode: 0o644 });
process.stdout.write(`${outputPath}\n`);
