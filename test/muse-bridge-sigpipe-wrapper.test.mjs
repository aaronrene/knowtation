/**
 * muse-bridge-git-export.py — SIGPIPE-safe wrapper contract (seven tiers).
 *
 * Observed 2026-11-15: bare `muse bridge git-export` exits 141 during
 * `git check-ignore -z --stdin` on large path lists (CPython SIG_DFL).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WRAPPER = path.join(ROOT, 'scripts/muse-bridge-git-export.py');
const DEPLOY = path.join(ROOT, 'scripts/muse-bridge-deploy.sh');

/**
 * @returns {string|null} Muse venv Python path, or null when Muse is not installed.
 */
function musePythonOrNull() {
  const museBin = spawnSync('bash', ['-lc', 'command -v muse'], {
    encoding: 'utf8',
  });
  if (museBin.status !== 0 || !museBin.stdout.trim()) return null;
  const bin = museBin.stdout.trim();
  const head = fs.readFileSync(bin, 'utf8').split('\n')[0] || '';
  if (!head.startsWith('#!')) return null;
  return head.slice(2).trim();
}

/**
 * @returns {string}
 */
function systemPython() {
  const res = spawnSync('bash', ['-lc', 'command -v python3'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, 'python3 must be on PATH');
  return res.stdout.trim();
}

/**
 * @returns {string}
 */
function readDeploy() {
  return fs.readFileSync(DEPLOY, 'utf8');
}

/**
 * @param {string} src
 * @returns {string}
 */
function exportInvocation(src) {
  const re = /\n"\$\{MUSE_PYTHON\}" "\$\{GIT_EXPORT_WRAPPER\}" \\\n/;
  const m = re.exec(src);
  assert.ok(m, 'deploy script must invoke the SIGPIPE-safe wrapper');
  const rest = src.slice(m.index + 1);
  const end = rest.search(/\nEXPORT_EC=|\nsuccess "git-export|\nverify_sentinels/);
  return end === -1 ? rest.slice(0, 1600) : rest.slice(0, end);
}

describe('muse-bridge SIGPIPE wrapper — unit', () => {
  test('wrapper exists and documents SIGPIPE / check-ignore', () => {
    assert.ok(fs.existsSync(WRAPPER));
    const src = fs.readFileSync(WRAPPER, 'utf8');
    assert.match(src, /SIGPIPE/);
    assert.match(src, /check-ignore/);
    assert.match(src, /signal\.SIG_IGN/);
    assert.match(src, /subprocess\.run/);
  });
});

describe('muse-bridge SIGPIPE wrapper — integration', () => {
  test('deploy script wires wrapper + Muse venv python resolver', () => {
    const src = readDeploy();
    assert.match(src, /GIT_EXPORT_WRAPPER=/);
    assert.match(src, /resolve_muse_python/);
    assert.match(src, /MUSE_PYTHON=/);
    const block = exportInvocation(src);
    assert.match(block, /--push\b/);
    assert.match(block, /--force-push\b/);
    assert.match(block, /\.cursor\/hooks\.json/);
    assert.match(block, /\.cursor\/hooks\/\*\*/);
  });
});

describe('muse-bridge SIGPIPE wrapper — end-to-end', () => {
  test('wrapper --help reaches muse git-export help', (t) => {
    const py = musePythonOrNull();
    if (!py) {
      t.skip('muse CLI not on PATH (expected in GitHub Actions)');
      return;
    }
    const res = spawnSync(py, [WRAPPER, '--help'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    assert.equal(res.status, 0, out);
    assert.match(out, /git-export|Local-only by default/i);
  });
});

describe('muse-bridge SIGPIPE wrapper — stress', () => {
  test('export-invocation parse stable across many reads', () => {
    const first = exportInvocation(readDeploy());
    for (let i = 0; i < 100; i += 1) {
      assert.equal(exportInvocation(readDeploy()), first);
    }
  });
});

describe('muse-bridge SIGPIPE wrapper — data-integrity', () => {
  test('wrapper always prefixes muse bridge git-export argv', () => {
    const src = fs.readFileSync(WRAPPER, 'utf8');
    assert.match(
      src,
      /sys\.argv\s*=\s*\[["']muse["'],\s*["']bridge["'],\s*["']git-export["']/,
    );
  });
});

describe('muse-bridge SIGPIPE wrapper — performance', () => {
  test('wrapper module parses under 2s', () => {
    // AST parse only — no bytecode write (avoids cache PermissionError) and no Muse import.
    const py = systemPython();
    const t0 = performance.now();
    const res = spawnSync(
      py,
      [
        '-c',
        'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text()); print("ok")',
        WRAPPER,
      ],
      { encoding: 'utf8', cwd: ROOT },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout || '', /ok/);
    assert.ok(performance.now() - t0 < 2000);
  });
});

describe('muse-bridge SIGPIPE wrapper — security', () => {
  test('deploy still excludes secrets and never pushes origin main', () => {
    const block = exportInvocation(readDeploy());
    assert.match(block, /--strip-muse-metadata/);
    assert.match(block, /config\/local\.yaml/);
    assert.match(block, /\.env/);
    assert.doesNotMatch(block, /git push origin main\b/);
    assert.doesNotMatch(
      readDeploy(),
      /^[^#\n]*\bmuse bridge git-export \\\n/m,
      'bare muse bridge git-export must not remain as the live invocation',
    );
  });
});
