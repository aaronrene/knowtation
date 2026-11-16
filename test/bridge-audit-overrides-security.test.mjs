/**
 * Bridge audit override pins — keep muse-bridge-deploy npm audit gate green.
 *
 * Context
 * -------
 * Staging cleanup land C2 failed GitHub mirror because `scripts/muse-bridge-deploy.sh`
 * refuses to bridge while high/critical `npm audit` findings remain. Two root
 * overrides were still inside advisory ranges:
 *   - brace-expansion@5.0.9 (GHSA quadratic/recursion DoS; fixed in 5.0.13+)
 *   - undici@6.28.0 (multiple DoS / TLS issues; fixed in 6.29.1+)
 *
 * This suite guards the pins and the audit surface so a future lock regenerate
 * cannot silently reintroduce bridge-blocking highs without a failing test.
 *
 * Seven-tier coverage
 * -------------------
 * 1. unit            — package.json override strings meet minimum versions
 * 2. integration     — lockfile + installed module versions match the pins
 * 3. end-to-end      — bridge script still fails closed on residual high/critical
 * 4. stress          — many consecutive pin reads stay identical (no flake)
 * 5. data-integrity  — lock packages map never records vulnerable brace/undici
 * 6. performance     — pin + lock parse completes under a tight budget
 * 7. security        — live `npm audit --json` reports 0 high and 0 critical
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const BRIDGE_SCRIPT = path.join(ROOT, 'scripts/muse-bridge-deploy.sh');

const MIN_BRACE = '5.0.13';
const MIN_UNDICI = '6.29.1';

/**
 * Compare dotted numeric semver cores (major.minor.patch only).
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
function cmpSemverCore(a, b) {
  const pa = String(a).replace(/^[^\d]*/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^[^\d]*/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * @returns {{ brace: string, undici: string }}
 */
function readOverridePins() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const overrides = pkg.overrides || {};
  return {
    brace: String(overrides['brace-expansion'] || ''),
    undici: String(overrides.undici || ''),
  };
}

/**
 * Collect installed versions for a package name from the lock `packages` map.
 * @param {object} lock
 * @param {string} name
 * @returns {string[]}
 */
function lockVersionsFor(lock, name) {
  const out = [];
  const packages = lock.packages || {};
  for (const [key, meta] of Object.entries(packages)) {
    if (!meta || typeof meta !== 'object') continue;
    const base = key === '' ? '' : path.posix.basename(key.replace(/\\/g, '/'));
    if (base === name || meta.name === name) {
      if (meta.version) out.push(String(meta.version));
    }
  }
  return out;
}

describe('bridge audit overrides — unit', () => {
  test('package.json pins brace-expansion and undici at or above fixed floors', () => {
    const pins = readOverridePins();
    assert.ok(pins.brace, 'overrides.brace-expansion must be set');
    assert.ok(pins.undici, 'overrides.undici must be set');
    assert.ok(
      cmpSemverCore(pins.brace, MIN_BRACE) >= 0,
      `brace-expansion override ${pins.brace} must be >= ${MIN_BRACE}`,
    );
    assert.ok(
      cmpSemverCore(pins.undici, MIN_UNDICI) >= 0,
      `undici override ${pins.undici} must be >= ${MIN_UNDICI}`,
    );
  });
});

describe('bridge audit overrides — integration', () => {
  test('lockfile and node_modules resolve brace-expansion and undici at pinned floors', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    const braceVers = lockVersionsFor(lock, 'brace-expansion');
    const undiciVers = lockVersionsFor(lock, 'undici');
    assert.ok(braceVers.length > 0, 'lockfile must record brace-expansion');
    assert.ok(undiciVers.length > 0, 'lockfile must record undici');
    for (const v of braceVers) {
      assert.ok(
        cmpSemverCore(v, MIN_BRACE) >= 0,
        `lock brace-expansion@${v} must be >= ${MIN_BRACE}`,
      );
    }
    for (const v of undiciVers) {
      assert.ok(
        cmpSemverCore(v, MIN_UNDICI) >= 0,
        `lock undici@${v} must be >= ${MIN_UNDICI}`,
      );
    }

    const bracePkg = path.join(ROOT, 'node_modules/brace-expansion/package.json');
    const undiciPkg = path.join(ROOT, 'node_modules/undici/package.json');
    assert.ok(fs.existsSync(bracePkg), 'brace-expansion must be installed');
    assert.ok(fs.existsSync(undiciPkg), 'undici must be installed');
    const braceInstalled = JSON.parse(fs.readFileSync(bracePkg, 'utf8')).version;
    const undiciInstalled = JSON.parse(fs.readFileSync(undiciPkg, 'utf8')).version;
    assert.ok(cmpSemverCore(braceInstalled, MIN_BRACE) >= 0);
    assert.ok(cmpSemverCore(undiciInstalled, MIN_UNDICI) >= 0);
  });
});

describe('bridge audit overrides — end-to-end', () => {
  test('muse-bridge-deploy.sh still hard-fails when high/critical remain', () => {
    const src = fs.readFileSync(BRIDGE_SCRIPT, 'utf8');
    assert.match(src, /npm audit --json/);
    assert.match(src, /high\/critical/);
    assert.match(src, /DO NOT bridge with known high\/critical vulnerabilities/);
    assert.match(src, /audit_tree_high_critical/);
    assert.match(src, /hub\/gateway/);
    assert.match(src, /hub\/bridge/);
    assert.ok(
      src.includes("int(v.get('high', 0)) + int(v.get('critical', 0))"),
      'bridge must sum high+critical from audit metadata',
    );
  });

  test('muse-bridge-deploy.sh pairs --push with --force-push for git-export', () => {
    const src = fs.readFileSync(BRIDGE_SCRIPT, 'utf8');
    const re = /\n"\$\{MUSE_PYTHON\}" "\$\{GIT_EXPORT_WRAPPER\}" \\\n/;
    const m = re.exec(src);
    assert.ok(m, 'must find SIGPIPE-safe git-export wrapper invocation');
    const exportBlock = src.slice(m.index + 1);
    const end = exportBlock.search(/\nEXPORT_EC=|\nverify_sentinels/);
    const block = end === -1 ? exportBlock.slice(0, 1200) : exportBlock.slice(0, end);
    assert.match(block, /--push\b/, 'git-export must pass --push (CLI default is local-only)');
    assert.match(block, /--force-push\b/, 'git-export must pass --force-push for muse-mirror');
    const pushIdx = block.search(/--push\b/);
    const forceIdx = block.search(/--force-push\b/);
    assert.ok(pushIdx >= 0 && forceIdx >= 0 && pushIdx < forceIdx,
      '--push must appear before/with --force-push so Muse CLI accepts the force');
  });
});

describe('bridge audit overrides — stress', () => {
  test('override pin reads are stable across many iterations', () => {
    const first = readOverridePins();
    for (let i = 0; i < 200; i += 1) {
      const next = readOverridePins();
      assert.deepEqual(next, first);
    }
  });
});

describe('bridge audit overrides — data-integrity', () => {
  test('no lock packages entry keeps brace-expansion or undici below floors', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    for (const [key, meta] of Object.entries(lock.packages || {})) {
      if (!meta || !meta.version) continue;
      const base = key === '' ? '' : path.posix.basename(key.replace(/\\/g, '/'));
      const name = meta.name || base;
      if (name === 'brace-expansion') {
        assert.ok(
          cmpSemverCore(meta.version, MIN_BRACE) >= 0,
          `${key} brace-expansion@${meta.version} below ${MIN_BRACE}`,
        );
      }
      if (name === 'undici') {
        assert.ok(
          cmpSemverCore(meta.version, MIN_UNDICI) >= 0,
          `${key} undici@${meta.version} below ${MIN_UNDICI}`,
        );
      }
    }
  });
});

describe('bridge audit overrides — performance', () => {
  test('pin and lock parse complete under 250ms', () => {
    const t0 = performance.now();
    readOverridePins();
    JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 250, `parse took ${elapsed.toFixed(1)}ms`);
  });
});

describe('bridge audit overrides — security', () => {
  /**
   * @param {string} cwd
   * @param {string} label
   */
  function assertNoHighCritical(cwd, label) {
    const res = spawnSync('npm', ['audit', '--json', '--omit=dev'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    const raw = res.stdout || '';
    assert.ok(raw.trim().length > 0, `${label}: npm audit --json must emit JSON`);
    const report = JSON.parse(raw);
    const meta = report.metadata?.vulnerabilities || {};
    const high = Number(meta.high || 0);
    const critical = Number(meta.critical || 0);
    assert.equal(critical, 0, `${label}: critical must be 0, got ${critical}`);
    assert.equal(high, 0, `${label}: high must be 0 (CI gate), got ${high}`);
  }

  test('npm audit reports zero high and zero critical findings', () => {
    assertNoHighCritical(ROOT, 'root');
    assertNoHighCritical(path.join(ROOT, 'hub/gateway'), 'hub/gateway');
    assertNoHighCritical(path.join(ROOT, 'hub/bridge'), 'hub/bridge');
  });

  test('hub gateway/bridge pin body-parser, proxy-addr, qs floors', () => {
    for (const rel of ['hub/gateway/package.json', 'hub/bridge/package.json']) {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      assert.equal(pkg.overrides?.['body-parser'], '1.20.9', rel);
      assert.equal(pkg.overrides?.['proxy-addr'], '2.0.8', rel);
      assert.equal(pkg.overrides?.qs, '6.16.2', rel);
    }
  });
});
