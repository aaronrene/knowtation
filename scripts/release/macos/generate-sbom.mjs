#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return path.resolve(process.argv[index + 1]);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function packageRoots(root) {
  const roots = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') continue;
      const candidate = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of fs.readdirSync(candidate, { withFileTypes: true })) {
          if (scoped.isDirectory()) visitPackage(path.join(candidate, scoped.name));
        }
      } else {
        visitPackage(candidate);
      }
    }
  }
  function visitPackage(directory) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) roots.push(directory);
    const nested = path.join(directory, 'node_modules');
    if (fs.existsSync(nested)) visit(nested);
  }
  visit(root);
  return roots.sort();
}

function includedLicenseText(directory) {
  const candidate = fs.readdirSync(directory)
    .filter((name) => /^(license|licence|copying|notice)(\.|$)/i.test(name))
    .sort()[0];
  if (!candidate) return null;
  const file = path.join(directory, candidate);
  if (!fs.statSync(file).isFile()) return null;
  return fs.readFileSync(file, 'utf8');
}

function authorName(author) {
  if (typeof author === 'string' && author.trim()) return author.trim();
  if (author && typeof author.name === 'string' && author.name.trim()) return author.name.trim();
  return null;
}

function normalizeLicense(value) {
  if (value === 'MIT/X11') return 'MIT';
  if (value === 'MIT OR Apache') return 'MIT OR Apache-2.0';
  return value;
}

function fallbackLicense({ expression, copyright, source, templates }) {
  if (!copyright) throw new Error(`license fallback lacks copyright attribution for ${source}`);
  const identifiers = expression.split(/\s+OR\s+/);
  const texts = identifiers.map((identifier) => {
    if (!['MIT', 'ISC', 'Apache-2.0'].includes(identifier)) {
      throw new Error(`unsupported license fallback ${expression} for ${source}`);
    }
    const text = fs.readFileSync(path.join(templates, `${identifier}.txt`), 'utf8').trim();
    const attribution = identifier === 'Apache-2.0' ? '' : `Copyright (c) ${copyright}\n\n`;
    return `--- ${identifier} ---\n${attribution}${text}`;
  });
  return [
    'The published package omitted its repository license file.',
    `Source metadata: ${source}`,
    '',
    ...texts,
  ].join('\n');
}

function integrityChecksum(integrity) {
  const match = /^(sha512|sha256)-([A-Za-z0-9+/=]+)$/.exec(integrity ?? '');
  if (!match) return [];
  return [{
    algorithm: match[1].toUpperCase(),
    checksumValue: Buffer.from(match[2], 'base64').toString('hex'),
  }];
}

function purl(name, version) {
  const packageName = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${packageName}@${version}`;
}

const modules = arg('node-modules');
const sbomOutput = arg('sbom');
const noticesOutput = arg('notices');
const packageLockFile = arg('package-lock');
const releaseLockFile = arg('release-lock');
const nodeLicenseFile = arg('node-license');
const licenseTemplates = arg('license-templates');
const overridesFile = arg('license-overrides');
const packageLock = JSON.parse(fs.readFileSync(packageLockFile, 'utf8'));
const releaseLock = JSON.parse(fs.readFileSync(releaseLockFile, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8')).packages;
const lockDigest = digest(fs.readFileSync(releaseLockFile));

const packages = packageRoots(modules).map((directory, index) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const key = `${manifest.name}@${manifest.version}`;
  const override = overrides[key] ?? {};
  const declared = normalizeLicense(override.license ?? manifest.license);
  if (!declared) throw new Error(`dependency has no declared or reviewed license: ${key}`);
  const relative = path.relative(modules, directory).split(path.sep).join('/');
  const lockEntry = packageLock.packages[`node_modules/${relative}`];
  if (!lockEntry || lockEntry.version !== manifest.version) {
    throw new Error(`installed dependency is absent from exact package lock: ${key} at ${relative}`);
  }
  const repository = typeof manifest.repository === 'string'
    ? manifest.repository
    : manifest.repository?.url;
  const source = override.source ?? repository ?? manifest.homepage;
  const included = includedLicenseText(directory);
  const notice = included ?? fallbackLicense({
    expression: declared,
    copyright: override.copyright ?? authorName(manifest.author),
    source: source ?? key,
    templates: licenseTemplates,
  });
  return {
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: manifest.name,
    versionInfo: manifest.version,
    downloadLocation: lockEntry.resolved ?? 'NOASSERTION',
    filesAnalyzed: false,
    checksums: integrityChecksum(lockEntry.integrity),
    licenseConcluded: declared,
    licenseDeclared: declared,
    copyrightText: override.copyright ?? authorName(manifest.author) ?? 'NOASSERTION',
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: purl(manifest.name, manifest.version),
    }],
    notice,
  };
});

const spdxPackages = packages.map(({ notice, ...entry }) => entry);
spdxPackages.push(
  {
    SPDXID: 'SPDXRef-NodeRuntime',
    name: 'Node.js',
    versionInfo: releaseLock.node.version,
    downloadLocation: releaseLock.node.url,
    filesAnalyzed: false,
    checksums: [{ algorithm: 'SHA256', checksumValue: releaseLock.node.sha256 }],
    licenseConcluded: 'MIT',
    licenseDeclared: 'MIT',
    copyrightText: 'Node.js contributors',
  },
  {
    SPDXID: 'SPDXRef-EmbeddingModel',
    name: releaseLock.model.repository,
    versionInfo: releaseLock.model.revision,
    downloadLocation: `https://huggingface.co/${releaseLock.model.repository}/tree/${releaseLock.model.revision}`,
    filesAnalyzed: false,
    licenseConcluded: 'Apache-2.0',
    licenseDeclared: 'Apache-2.0',
    copyrightText: 'NOASSERTION',
  }
);

const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'Knowtation-0.1.0-100-macos-arm64',
  documentNamespace: `https://releases.knowtation.store/spdx/${lockDigest}`,
  creationInfo: {
    created: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000).toISOString(),
    creators: ['Tool: Knowtation Phase 7 release builder'],
  },
  packages: spdxPackages,
  relationships: spdxPackages.map((entry) => ({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: entry.SPDXID,
  })),
};

fs.mkdirSync(path.dirname(sbomOutput), { recursive: true });
fs.writeFileSync(sbomOutput, `${JSON.stringify(sbom, null, 2)}\n`);

const noticeParts = [
  'Knowtation third-party notices',
  'Generated from the exact standalone runtime dependency tree.',
  '',
];
for (const pkg of packages) {
  noticeParts.push(`===== ${pkg.name} ${pkg.versionInfo} (${pkg.licenseDeclared}) =====`);
  noticeParts.push(pkg.notice.trim());
  noticeParts.push('');
}
noticeParts.push(`===== Node.js ${releaseLock.node.version} (MIT and bundled third-party licenses) =====`);
noticeParts.push(fs.readFileSync(nodeLicenseFile, 'utf8').trim());
noticeParts.push('');
noticeParts.push(`===== ${releaseLock.model.repository} ${releaseLock.model.revision} (Apache-2.0) =====`);
noticeParts.push(fs.readFileSync(path.join(licenseTemplates, 'Apache-2.0.txt'), 'utf8').trim());
noticeParts.push('');
fs.writeFileSync(noticesOutput, `${noticeParts.join('\n')}\n`);
