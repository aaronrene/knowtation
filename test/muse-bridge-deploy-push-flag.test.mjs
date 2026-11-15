/**
 * muse-bridge-deploy.sh — git-export push flag contract (seven tiers).
 *
 * Muse CLI 0.2.2+ makes `muse bridge git-export` local-only by default and
 * requires `--push` whenever `--force-push` is set. A missing `--push` aborts
 * the Knowtation GitHub mirror after MuseHub land (observed 2026-11-15 on C3).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/muse-bridge-deploy.sh');

/**
 * @returns {string}
 */
function readScript() {
  return fs.readFileSync(SCRIPT, 'utf8');
}

/**
 * Extract the real git-export invocation (not the header comment mention).
 * @param {string} src
 * @returns {string}
 */
function exportInvocation(src) {
  // Live call is the SIGPIPE-safe Python wrapper (not bare `muse bridge`).
  const re = /\n"\$\{MUSE_PYTHON\}" "\$\{GIT_EXPORT_WRAPPER\}" \\\n/;
  const m = re.exec(src);
  assert.ok(m, 'script must invoke SIGPIPE-safe git-export wrapper with continuations');
  const rest = src.slice(m.index + 1);
  const end = rest.search(/\nEXPORT_EC=|\nsuccess "git-export|\nverify_sentinels/);
  return end === -1 ? rest.slice(0, 1600) : rest.slice(0, end);
}

describe('muse-bridge-deploy push flag — unit', () => {
  test('script exists and is executable-ish shell', () => {
    assert.ok(fs.existsSync(SCRIPT));
    const src = readScript();
    assert.match(src, /^#!/);
    assert.match(src, /set -euo pipefail/);
  });
});

describe('muse-bridge-deploy push flag — integration', () => {
  test('git-export block includes --push and --force-push', () => {
    const block = exportInvocation(readScript());
    assert.match(block, /--git-remote origin/);
    assert.match(block, /--push\b/);
    assert.match(block, /--force-push\b/);
  });
});

describe('muse-bridge-deploy push flag — end-to-end', () => {
  test('muse CLI help documents --force-push requires --push', () => {
    const res = spawnSync('muse', ['bridge', 'git-export', '--help'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    assert.equal(res.status, 0, out);
    assert.match(out, /--force-push/);
    assert.match(
      out,
      /--force-push[\s\S]{0,120}Requires\s+--push/i,
      'CLI help must state --force-push requires --push',
    );
    assert.match(out, /Local-only by default/i);
  });
});

describe('muse-bridge-deploy push flag — stress', () => {
  test('export-invocation parse is stable across many reads', () => {
    const first = exportInvocation(readScript());
    for (let i = 0; i < 100; i += 1) {
      assert.equal(exportInvocation(readScript()), first);
    }
  });
});

describe('muse-bridge-deploy push flag — data-integrity', () => {
  test('no alternate git-export call omits --push while using --force-push', () => {
    const src = readScript();
    const block = exportInvocation(src);
    assert.match(block, /--force-push/);
    assert.match(block, /--push\b/, 'forced export must also push');
    assert.match(src, /GIT_EXPORT_WRAPPER=/);
  });
});

describe('muse-bridge-deploy push flag — performance', () => {
  test('script read + parse under 50ms', () => {
    const t0 = performance.now();
    exportInvocation(readScript());
    assert.ok(performance.now() - t0 < 50);
  });
});

describe('muse-bridge-deploy push flag — security', () => {
  test('export still strips Muse metadata and excludes secrets paths', () => {
    const block = exportInvocation(readScript());
    assert.match(block, /--strip-muse-metadata/);
    assert.match(block, /config\/local\.yaml/);
    assert.match(block, /\.env/);
    assert.doesNotMatch(block, /git push origin main\b/);
  });

  test('default mirror dir is outside the repo (avoids Cursor .cursor locks)', () => {
    const src = readScript();
    assert.match(src, /DEFAULT_MIRROR_DIR=.*"\$\{TMPDIR:-\/tmp\}\/knowtation-muse-mirror-/);
    assert.match(src, /--muse-ref "\$\{MUSE_REF\}"/);
  });

  test('script captures EXPORT_EC, clears hooks path, excludes hooks from export', () => {
    const src = readScript();
    const block = exportInvocation(src);
    assert.match(src, /EXPORT_EC=\$\?/);
    assert.match(src, /rm -f "\$\{MIRROR_DIR_ABS\}\/\.cursor\/hooks\.json"/);
    assert.match(src, /exit 141/);
    assert.match(block, /\.cursor\/hooks\.json/);
    // No active mktemp redirect of muse output (comment prose may mention the bug).
    assert.doesNotMatch(
      src,
      /^EXPORT_LOG=.*mktemp.*XXXXXX\.log/m,
      'must not redirect muse into a macOS-invalid mktemp ….XXXXXX.log path',
    );
  });
});
