#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error('invalid arguments');
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function writeStable(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, { mode: 0o644 });
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function sourceRevision({ allowUncommitted }) {
  const muse = process.env.KNOWTATION_SOURCE_MUSE_REVISION;
  const github = process.env.KNOWTATION_SOURCE_GIT_REVISION;
  const validMuse = /^sha256:[0-9a-f]{64}$/.test(muse ?? '');
  const validGit = /^[0-9a-f]{40}$/.test(github ?? '');
  if (validMuse && validGit) return { status: 'committed', muse, github };
  if (allowUncommitted && process.env.KNOWTATION_ALLOW_UNCOMMITTED_BUILD === '1') {
    return {
      status: 'uncommitted',
      branch: 'feat/companion-phase-7-distribution',
      baseline: release.sourceBaseline,
    };
  }
  throw new Error(
    'exact KNOWTATION_SOURCE_MUSE_REVISION and KNOWTATION_SOURCE_GIT_REVISION are required'
  );
}

function walk(root, relative = '') {
  const entries = [];
  const directory = path.join(root, relative);
  for (const name of fs.readdirSync(directory).sort()) {
    const rel = relative ? `${relative}/${name}` : name;
    const absolute = path.join(root, rel);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`symbolic links are forbidden in release payload: ${rel}`);
    if (stat.isDirectory()) entries.push(...walk(root, rel));
    else if (stat.isFile()) entries.push({
      path: rel,
      sha256: sha256(absolute),
      bytes: stat.size,
      executable: (stat.mode & 0o111) !== 0,
    });
    else throw new Error(`unsupported payload entry: ${rel}`);
  }
  return entries;
}

function requireSafeOutput(output, root) {
  const rel = path.relative(root, output);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

const args = parseArgs(process.argv.slice(2));
const stage = args.stage;
const output = path.resolve(args.output ?? '');
const repoRoot = path.resolve(new URL('../../../', import.meta.url).pathname);
const release = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/macos/release.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/macos/release-lock.json'), 'utf8'));

if (stage === 'unsigned') {
  const app = path.resolve(args.app ?? '');
  const resources = path.join(app, 'Contents/Resources');
  const excluded = requireSafeOutput(output, resources);
  const files = walk(resources).filter((entry) => entry.path !== excluded);
  writeStable(output, {
    schema: 1,
    releaseVersion: release.version,
    releaseBuild: release.build,
    architecture: release.architectures[0],
    sourceRevision: sourceRevision({ allowUncommitted: true }),
    sourceBaseline: release.sourceBaseline,
    releaseLockSHA256: sha256(path.join(repoRoot, 'release/macos/release-lock.json')),
    w3BundleDigest: lock.model.w3BundleDigest,
    files,
  });
  process.exit(0);
}

if (stage === 'final') {
  const dist = path.resolve(args.dist ?? '');
  const packageName = `Knowtation-${release.version}-${release.build}-macos-${release.architectures[0]}.pkg`;
  const packagePath = path.join(dist, packageName);
  if (!fs.existsSync(packagePath)) throw new Error(`missing final package: ${packagePath}`);
  const artifactNames = [
    `Knowtation-${release.version}-${release.build}-macos-${release.architectures[0]}.zip`,
    packageName,
    'sbom.spdx.json',
    'LICENSE',
    'THIRD-PARTY-NOTICES.txt',
  ];
  const artifacts = artifactNames.map((name) => {
    const file = path.join(dist, name);
    if (!fs.existsSync(file)) throw new Error(`missing final artifact: ${file}`);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error(`final artifact is not a file: ${file}`);
    return { path: name, sha256: sha256(file), bytes: stat.size, executable: false };
  });
  const issuedAt = Number(process.env.KNOWTATION_UPDATE_ISSUED_AT);
  const expiresAt = Number(process.env.KNOWTATION_UPDATE_EXPIRES_AT);
  const keyID = process.env.KNOWTATION_UPDATE_KEY_ID;
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
    throw new Error('valid KNOWTATION_UPDATE_ISSUED_AT and KNOWTATION_UPDATE_EXPIRES_AT are required');
  }
  if (!keyID || keyID.includes('<')) throw new Error('KNOWTATION_UPDATE_KEY_ID is required');
  const sourceMin = Number(process.env.KNOWTATION_UPDATE_SOURCE_MIN_BUILD);
  const sourceMax = Number(process.env.KNOWTATION_UPDATE_SOURCE_MAX_BUILD);
  if (!Number.isSafeInteger(sourceMin) || !Number.isSafeInteger(sourceMax) ||
      sourceMin < 0 || sourceMax < sourceMin || sourceMax >= release.build) {
    throw new Error('valid update source build range below the target build is required');
  }
  writeStable(output, {
    schema: 1,
    channel: release.channel,
    platform: release.platform,
    architecture: release.architectures[0],
    keyID,
    issuedAt,
    expiresAt,
    source: { minimumBuild: sourceMin, maximumBuild: sourceMax },
    target: {
      version: release.version,
      build: release.build,
      packageURL: `https://releases.knowtation.store/stable/${packageName}`,
      packageSHA256: sha256(packagePath),
      packageBytes: fs.statSync(packagePath).size,
    },
    minimumAcceptedBuild: release.update.minimumAcceptedBuild,
    sourceRevision: sourceRevision({ allowUncommitted: false }),
    sourceBaseline: release.sourceBaseline,
    releaseLockSHA256: sha256(path.join(repoRoot, 'release/macos/release-lock.json')),
    w3BundleDigest: lock.model.w3BundleDigest,
    artifacts,
  });
  process.exit(0);
}

throw new Error('stage must be unsigned or final');
