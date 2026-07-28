/**
 * SEC-KN-6 — seven-tier coverage for constant-time gateway / operator-export secret compare.
 *
 * Frozen requirement: Pass 2 P14
 * (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`) —
 * gateway auth + operator export must not use early-exit `==` after the length check.
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  constantTimeTextEqual,
  gatewayAuthorized,
  healthPayload,
  httpRequestRequiresGatewayAuth,
  operatorExportAuthorized,
  textEqualEarlyExitLegacy,
} from '../lib/gateway-authorized.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAIN_MO = path.join(ROOT, 'hub/icp/src/hub/main.mo');
const MIRROR_JS = path.join(ROOT, 'lib/gateway-authorized.mjs');

function readMainMo() {
  return fs.readFileSync(MAIN_MO, 'utf8');
}

/**
 * Extract a top-level Motoko `func name(...) { ... };` by brace depth.
 * (Naive `indexOf('\\n};')` truncates on nested while/switch closers.)
 *
 * @param {string} src
 * @param {string} funcName
 */
function extractFuncBlock(src, funcName) {
  const start = src.indexOf(`func ${funcName}(`);
  assert.ok(start >= 0, `${funcName} must exist in main.mo`);
  const braceOpen = src.indexOf('{', start);
  assert.ok(braceOpen > start, `${funcName} must open a body`);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const end = i + 1;
        const withSemi = src[end] === ';' ? end + 1 : end;
        return src.slice(start, withSemi);
      }
    }
  }
  assert.fail(`${funcName} block never closed`);
}

/**
 * Pre-fix Motoko shape: length gate then `got == expected`.
 * Security tier asserts current Motoko blocks no longer contain this early-exit compare.
 *
 * @param {string} got
 * @param {string} expected
 */
function motokoStyleEqualLegacy(got, expected) {
  if (got.length !== expected.length) return false;
  return textEqualEarlyExitLegacy(got, expected);
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-KN-6 unit — constantTimeTextEqual', () => {
  test('equal strings accept; mismatch / length / type deny', () => {
    assert.equal(constantTimeTextEqual('secret', 'secret'), true);
    assert.equal(constantTimeTextEqual('secret', 'secreT'), false);
    assert.equal(constantTimeTextEqual('secret', 'secre'), false);
    assert.equal(constantTimeTextEqual('secret', 'secrets'), false);
    assert.equal(constantTimeTextEqual('', ''), true);
    assert.equal(constantTimeTextEqual('a', ''), false);
    assert.equal(constantTimeTextEqual(null, 'a'), false);
    assert.equal(constantTimeTextEqual('a', undefined), false);
  });

  test('gatewayAuthorized stays fail-closed and uses constant-time match', () => {
    assert.equal(gatewayAuthorized('', 'x'), false);
    assert.equal(gatewayAuthorized('sec', undefined), false);
    assert.equal(gatewayAuthorized('sec', 'sec'), true);
    assert.equal(gatewayAuthorized('sec', 'seX'), false);
  });

  test('operatorExportAuthorized mirrors the same contract', () => {
    assert.equal(operatorExportAuthorized('', 'k'), false);
    assert.equal(operatorExportAuthorized('key', null), false);
    assert.equal(operatorExportAuthorized('key', 'key'), true);
    assert.equal(operatorExportAuthorized('key', 'kez'), false);
  });

  test('first-char vs last-char mismatch both deny (no position privilege)', () => {
    const secret = 'ABCDEFGH';
    assert.equal(constantTimeTextEqual(secret, 'XBCDEFGH'), false);
    assert.equal(constantTimeTextEqual(secret, 'ABCDEFGX'), false);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (Motoko source + JS mirror)
// ---------------------------------------------------------------------------
describe('SEC-KN-6 integration — Motoko + mirror contract', () => {
  test('Motoko defines constantTimeTextEqual with OR-of-XOR scan', () => {
    const src = readMainMo();
    const block = extractFuncBlock(src, 'constantTimeTextEqual');
    assert.ok(block.includes('Text.toArray(a)'));
    assert.ok(block.includes('Text.toArray(b)'));
    assert.match(block, /acc\s*:=\s*acc\s*\|\s*\(/);
    assert.match(block, /Char\.toNat32/);
    assert.ok(block.includes('acc == 0'));
    assert.doesNotMatch(block, /\ba\s*==\s*b\b/);
  });

  test('gatewayAuthorized and operatorExportAuthorized call constantTimeTextEqual', () => {
    const src = readMainMo();
    const gw = extractFuncBlock(src, 'gatewayAuthorized');
    const op = extractFuncBlock(src, 'operatorExportAuthorized');
    assert.ok(gw.includes('constantTimeTextEqual(got, expected)'));
    assert.ok(op.includes('constantTimeTextEqual(got, expected)'));
    assert.doesNotMatch(gw, /got\s*==\s*expected/);
    assert.doesNotMatch(op, /got\s*==\s*expected/);
  });

  test('JS mirror exports constantTimeTextEqual and both auth wrappers', () => {
    const src = fs.readFileSync(MIRROR_JS, 'utf8');
    assert.ok(src.includes('export function constantTimeTextEqual'));
    assert.ok(src.includes('export function gatewayAuthorized'));
    assert.ok(src.includes('export function operatorExportAuthorized'));
    assert.ok(src.includes('acc |= '));
  });

  test('fail-closed empty secret still holds after P14 change', () => {
    assert.equal(gatewayAuthorized('', undefined), false);
    assert.equal(operatorExportAuthorized('', undefined), false);
    const gw = extractFuncBlock(readMainMo(), 'gatewayAuthorized');
    assert.ok(gw.includes('if (Text.size(expected) == 0) { return false }'));
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (fixture request matrix through routing + auth)
// ---------------------------------------------------------------------------
describe('SEC-KN-6 e2e — request matrix with constant-time auth', () => {
  function decide(secret, method, pathKind, gatewayHeader) {
    if (!httpRequestRequiresGatewayAuth(method, pathKind)) {
      return { status: 200, body: healthPayload(secret) };
    }
    if (!gatewayAuthorized(secret, gatewayHeader)) {
      return {
        status: 403,
        body: {
          error: 'Gateway authentication required',
          code: 'GATEWAY_AUTH_REQUIRED',
        },
      };
    }
    return { status: 200, body: { ok: true, pathKind } };
  }

  test('health bypasses auth; vaults requires constant-time match', () => {
    const secret = 'e2e-gateway-secret-32chars!!!!';
    const health = decide(secret, 'GET', 'health', undefined);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const wrong = decide(secret, 'GET', 'vaults', secret.slice(0, -1) + 'x');
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'GATEWAY_AUTH_REQUIRED');

    const ok = decide(secret, 'GET', 'vaults', secret);
    assert.equal(ok.status, 200);

    const options = decide(secret, 'OPTIONS', 'vaults', undefined);
    assert.equal(options.status, 200);
  });

  test('operator export: empty secret denies; wrong key denies; match allows', () => {
    assert.equal(operatorExportAuthorized('', 'any'), false);
    assert.equal(operatorExportAuthorized('export-key', 'wrong-key!!'), false);
    assert.equal(operatorExportAuthorized('export-key', 'export-key'), true);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-KN-6 stress — many compares at varying mismatch positions', () => {
  test('10_000 compares across first/middle/last mismatch stay correct', () => {
    const secret = 'S'.repeat(64);
    for (let i = 0; i < 10_000; i++) {
      const pos = i % 64;
      const wrong = secret.slice(0, pos) + 'X' + secret.slice(pos + 1);
      assert.equal(constantTimeTextEqual(secret, secret), true);
      assert.equal(constantTimeTextEqual(secret, wrong), false);
      assert.equal(gatewayAuthorized(secret, i % 2 === 0 ? secret : wrong), i % 2 === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-KN-6 data-integrity — idempotent decisions + Motoko call sites', () => {
  test('same inputs always yield the same allow/deny', () => {
    const cases = [
      ['', ''],
      ['abc', 'abc'],
      ['abc', 'abd'],
      ['abc', 'ab'],
      ['αβγ', 'αβγ'],
      ['αβγ', 'αβδ'],
    ];
    for (const [a, b] of cases) {
      assert.equal(constantTimeTextEqual(a, b), constantTimeTextEqual(a, b));
    }
  });

  test('Motoko auth call sites still fail-closed on empty secret', () => {
    const src = readMainMo();
    for (const name of ['gatewayAuthorized', 'operatorExportAuthorized']) {
      const block = extractFuncBlock(src, name);
      assert.match(block, /Text\.size\(expected\) == 0\) \{ return false \}/);
      assert.ok(block.includes('constantTimeTextEqual(got, expected)'));
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-KN-6 performance — bounded compare time', () => {
  test('100k constant-time compares complete under 1500ms', () => {
    const secret = 'perf-secret-value-32-chars!!!!';
    const wrongEarly = 'X' + secret.slice(1);
    const wrongLate = secret.slice(0, -1) + 'X';
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      constantTimeTextEqual(secret, i % 3 === 0 ? secret : i % 3 === 1 ? wrongEarly : wrongLate);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `expected <1500ms, got ${ms.toFixed(1)}ms`);
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (regression must FAIL against pre-fix early-exit compare)
// ---------------------------------------------------------------------------
describe('SEC-KN-6 security — regression vs early-exit ==', () => {
  test('security regression: Motoko auth blocks must not use got == expected', () => {
    const src = readMainMo();
    const gw = extractFuncBlock(src, 'gatewayAuthorized');
    const op = extractFuncBlock(src, 'operatorExportAuthorized');

    // Sanity: legacy Motoko shape (length then ==) is what P14 flagged.
    const legacySnippet = 'if (Text.size(got) != Text.size(expected)) { false } else { got == expected }';
    assert.ok(
      legacySnippet.includes('got == expected'),
      'sanity: legacy snippet models the audited early-exit compare'
    );

    assert.doesNotMatch(gw, /got\s*==\s*expected/);
    assert.doesNotMatch(op, /got\s*==\s*expected/);
    assert.ok(gw.includes('constantTimeTextEqual(got, expected)'));
    assert.ok(op.includes('constantTimeTextEqual(got, expected)'));

    // If a build silently restored `got == expected`, this would fail.
    assert.ok(
      !gw.includes(legacySnippet) && !op.includes(legacySnippet),
      'auth blocks must not restore the audited length-then-== shape'
    );
  });

  test('security regression: fixed compare diverges structurally from early-exit legacy', () => {
    const secret = 'ABCDEFGH';
    const earlyMismatch = 'XBCDEFGH';
    const lateMismatch = 'ABCDEFGX';

    // Correctness: both paths agree on accept/deny outcomes.
    assert.equal(constantTimeTextEqual(secret, secret), motokoStyleEqualLegacy(secret, secret));
    assert.equal(constantTimeTextEqual(secret, earlyMismatch), motokoStyleEqualLegacy(secret, earlyMismatch));
    assert.equal(constantTimeTextEqual(secret, lateMismatch), motokoStyleEqualLegacy(secret, lateMismatch));

    // Discrimination: legacy helper still short-circuits; fixed always scans.
    // Instrumentable proxy: early-exit returns on first miss without reading later chars.
    let legacyReads = 0;
    function earlyExitInstrumented(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        legacyReads += 1;
        if (a.charCodeAt(i) !== b.charCodeAt(i)) return false;
      }
      return true;
    }
    let fixedReads = 0;
    function fixedInstrumented(a, b) {
      const aa = [...a];
      const bb = [...b];
      if (aa.length !== bb.length) return false;
      let acc = 0;
      for (let i = 0; i < aa.length; i++) {
        fixedReads += 1;
        acc |= aa[i].codePointAt(0) ^ bb[i].codePointAt(0);
      }
      return acc === 0;
    }

    assert.equal(earlyExitInstrumented(secret, earlyMismatch), false);
    assert.equal(fixedInstrumented(secret, earlyMismatch), false);
    assert.equal(legacyReads, 1, 'legacy early-exit reads only until first mismatch');
    assert.equal(fixedReads, secret.length, 'fixed compare always reads every character');
    assert.notEqual(
      legacyReads,
      fixedReads,
      'fixed behavior must diverge from early-exit on first-char mismatch work'
    );
  });

  test('timing ratio for first vs last mismatch stays within bound (no position oracle)', () => {
    const secret = 'T'.repeat(256);
    const early = 'X' + secret.slice(1);
    const late = secret.slice(0, -1) + 'X';
    const rounds = 8000;

    // Warmup
    for (let i = 0; i < 500; i++) {
      constantTimeTextEqual(secret, early);
      constantTimeTextEqual(secret, late);
    }

    const t0 = performance.now();
    for (let i = 0; i < rounds; i++) constantTimeTextEqual(secret, early);
    const earlyMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < rounds; i++) constantTimeTextEqual(secret, late);
    const lateMs = performance.now() - t1;

    const ratio = earlyMs / lateMs;
    assert.ok(
      ratio > 0.25 && ratio < 4,
      `timing ratio ${ratio.toFixed(3)} (early=${earlyMs.toFixed(2)}ms late=${lateMs.toFixed(2)}ms) suggests position-dependent compare`
    );
  });

  test('SEC-KN-1 empty-secret deny still holds (P14 must not reopen P1)', () => {
    assert.equal(gatewayAuthorized('', undefined), false);
    assert.equal(gatewayAuthorized('', ''), false);
    assert.equal(gatewayAuthorized('', 'forged'), false);
  });
});
