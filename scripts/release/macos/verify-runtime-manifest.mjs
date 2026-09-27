#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return path.resolve(process.argv[index + 1]);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(root, relative = '') {
  const entries = [];
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const rel = relative ? `${relative}/${name}` : name;
    if (rel === 'runtime-manifest.json') continue;
    const absolute = path.join(root, rel);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`symbolic link in runtime closure: ${rel}`);
    if (stat.isDirectory()) entries.push(...walk(root, rel));
    else if (stat.isFile()) entries.push({
      path: rel,
      sha256: sha256(absolute),
      bytes: stat.size,
      executable: (stat.mode & 0o111) !== 0,
    });
    else throw new Error(`unsupported runtime entry: ${rel}`);
  }
  return entries;
}

const app = option('app');
const resources = path.join(app, 'Contents/Resources');
const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'runtime-manifest.json'), 'utf8'));
if (manifest.schema !== 1 || manifest.releaseVersion !== '0.1.0' || manifest.releaseBuild !== 100 ||
    manifest.architecture !== 'arm64') {
  throw new Error('runtime manifest release identity mismatch');
}
if (process.argv.includes('--require-committed-source') && manifest.sourceRevision?.status !== 'committed') {
  throw new Error('runtime manifest is not bound to committed Muse and Git revisions');
}
const lockFile = path.join(resources, 'release-lock.json');
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
if (manifest.releaseLockSHA256 !== sha256(lockFile) || manifest.w3BundleDigest !== lock.model.w3BundleDigest) {
  throw new Error('runtime manifest release lock mismatch');
}
const actual = walk(resources);
const fields = (entry) => [entry.path, entry.sha256, entry.bytes, entry.executable];
if (!Array.isArray(manifest.files) ||
    JSON.stringify(actual.map(fields)) !== JSON.stringify(manifest.files.map(fields))) {
  throw new Error('runtime manifest file closure mismatch');
}
process.stdout.write(`runtime manifest verified (${actual.length} files)\n`);
