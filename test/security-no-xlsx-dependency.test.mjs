/**
 * Security regression guard: the vulnerable SheetJS `xlsx` package must never
 * be (re)introduced into any npm lockfile, and the Excel import path must keep
 * using the maintained `exceljs` parser.
 *
 * Background
 * ----------
 * Dependabot alerts #29/#30 flagged `xlsx` (SheetJS community build) for
 * Prototype Pollution and ReDoS with *no upstream patch available*. Knowtation
 * resolved this structurally by migrating `lib/importers/excel-xlsx.mjs` to
 * `exceljs` and removing the `xlsx` dependency entirely. These tests prove that
 * remediation stays in force, so a future transitive bump cannot silently pull
 * the unpatched parser back in and expose the Excel import surface (which
 * accepts user-supplied .xlsx files) to those CVEs.
 *
 * This is the "Option C" guarantee from the security audit: instead of pinning
 * an unpatched package, we assert the unsafe code path cannot exist.
 */

import assert from 'assert';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const LOCKFILES = [
  'package-lock.json',
  'hub/package-lock.json',
  'hub/bridge/package-lock.json',
  'hub/gateway/package-lock.json',
];

/**
 * Collect every package name referenced by an npm v3 lockfile, drawn from both
 * the `packages` map (keyed by `node_modules/...` install path) and the legacy
 * `dependencies` tree, so a match cannot slip through a single representation.
 *
 * @param {string} lockPath absolute path to a package-lock.json
 * @returns {Set<string>} the set of dependency names present in the lockfile
 */
function collectLockfilePackageNames(lockPath) {
  const raw = fs.readFileSync(lockPath, 'utf8');
  /** @type {{ packages?: Record<string, unknown>, dependencies?: Record<string, unknown> }} */
  const lock = JSON.parse(raw);
  const names = new Set();
  for (const key of Object.keys(lock.packages ?? {})) {
    if (key === '') continue;
    const idx = key.lastIndexOf('node_modules/');
    const name = idx === -1 ? key : key.slice(idx + 'node_modules/'.length);
    if (name) names.add(name);
  }
  for (const name of Object.keys(lock.dependencies ?? {})) {
    names.add(name);
  }
  return names;
}

test('no npm lockfile contains the vulnerable SheetJS `xlsx` package', () => {
  for (const rel of LOCKFILES) {
    const lockPath = path.join(repoRoot, rel);
    assert.ok(fs.existsSync(lockPath), `expected lockfile to exist: ${rel}`);
    const names = collectLockfilePackageNames(lockPath);
    assert.ok(
      !names.has('xlsx'),
      `${rel} must not contain the unpatched 'xlsx' (SheetJS) package — use exceljs instead`,
    );
    // Defend against a maliciously aliased reintroduction (npm:xlsx@...).
    const rawText = fs.readFileSync(lockPath, 'utf8');
    assert.ok(
      !/"resolved":\s*"[^"]*\/xlsx\/-\//.test(rawText),
      `${rel} resolves a tarball for 'xlsx' — the vulnerable parser must not be installed`,
    );
  }
});

test('Excel importer uses exceljs and never imports the `xlsx` package', () => {
  const importerPath = path.join(repoRoot, 'lib/importers/excel-xlsx.mjs');
  assert.ok(fs.existsSync(importerPath), 'lib/importers/excel-xlsx.mjs must exist');
  const src = fs.readFileSync(importerPath, 'utf8');

  assert.match(
    src,
    /import\s+ExcelJS\s+from\s+['"]exceljs['"]/,
    'excel importer must parse via exceljs',
  );

  // A bare `from 'xlsx'` / `require('xlsx')` would reintroduce the CVE surface.
  assert.doesNotMatch(
    src,
    /from\s+['"]xlsx['"]|require\(\s*['"]xlsx['"]\s*\)/,
    'excel importer must not import the vulnerable xlsx package',
  );
});

test('root package.json declares no direct dependency on `xlsx`', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const buckets = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  for (const bucket of buckets) {
    const deps = pkg[bucket] ?? {};
    assert.ok(
      !Object.prototype.hasOwnProperty.call(deps, 'xlsx'),
      `package.json#${bucket} must not declare 'xlsx'`,
    );
  }
});
