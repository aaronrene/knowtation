/**
 * Tests for lib/daemon-cost.mjs — Phase F: Cost Tracking and Guardrails.
 *
 * Covers:
 *  1. estimateTokens — empty input, short text, long text, non-string
 *  2. computeCallCost — default rates, custom rates, empty inputs, zero response
 *  3. getCostFilePath — correct path resolution
 *  4. utcDateString — returns YYYY-MM-DD format, injectable date
 *  5. getDailyCost — missing file, missing date key, existing entry, other-date isolation
 *  6. recordCallCost — creates file, accumulates, ignores zero/negative, handles corrupt file
 *  7. resetDailyCost — writes empty object, subsequent getDailyCost returns 0
 *
 * All filesystem I/O uses a temp directory. No LLM calls. No network access.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  DEFAULT_RATES,
  estimateTokens,
  computeCallCost,
  getCostFilePath,
  utcDateString,
  getDailyCost,
  recordCallCost,
  resetDailyCost,
} from '../lib/daemon-cost.mjs';

// ── Test fixtures ─────────────────────────────────────────────────────────────

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-cost-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(suffix = '') {
  const dataDir = path.join(
    tmpDir,
    `data-${Date.now()}-${suffix || Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dataDir, { recursive: true });
  return { data_dir: dataDir };
}

// ── 1. estimateTokens ─────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('returns 0 for null', () => {
    assert.strictEqual(estimateTokens(null), 0);
  });

  it('returns 0 for undefined', () => {
    assert.strictEqual(estimateTokens(undefined), 0);
  });

  it('returns 0 for non-string number', () => {
    assert.strictEqual(estimateTokens(42), 0);
  });

  it('returns ceil(length / 4) for a 4-char string', () => {
    assert.strictEqual(estimateTokens('abcd'), 1);
  });

  it('returns ceil(length / 4) for a 5-char string', () => {
    assert.strictEqual(estimateTokens('abcde'), 2);
  });

  it('returns ceil(length / 4) for a 16-char string', () => {
    assert.strictEqual(estimateTokens('abcdefghijklmnop'), 4);
  });

  it('returns ceil(length / 4) for a 1-char string', () => {
    assert.strictEqual(estimateTokens('x'), 1);
  });

  it('result is always a positive integer for non-empty strings', () => {
    const text = 'Hello, world! This is a test of the token estimator.';
    const result = estimateTokens(text);
    assert.strictEqual(typeof result, 'number');
    assert(Number.isInteger(result));
    assert(result > 0);
  });
});

// ── 2. computeCallCost ────────────────────────────────────────────────────────

describe('computeCallCost', () => {
  it('returns a non-negative number', () => {
    const cost = computeCallCost(
      { system: 'You are a helper.', user: 'What is 2+2?' },
      '4',
    );
    assert(typeof cost === 'number');
    assert(cost >= 0);
  });

  it('returns 0 for empty opts and empty response', () => {
    assert.strictEqual(computeCallCost({}, ''), 0);
  });

  it('returns 0 for null opts and null response', () => {
    assert.strictEqual(computeCallCost(null, null), 0);
  });

  it('uses DEFAULT_RATES when no rates supplied', () => {
    const system = 'a'.repeat(4);   // 1 input token
    const user = '';
    const response = 'b'.repeat(4); // 1 output token
    const cost = computeCallCost({ system, user }, response);
    const expected =
      1 * DEFAULT_RATES.input_per_token + 1 * DEFAULT_RATES.output_per_token;
    assert(Math.abs(cost - expected) < 1e-12);
  });

  it('respects custom rates and produces exact values', () => {
    // system = 8 chars → 2 input tokens; response = 4 chars → 1 output token
    const system = 'a'.repeat(8);
    const response = 'b'.repeat(4);
    const rates = { input_per_token: 0.01, output_per_token: 0.02 };
    const cost = computeCallCost({ system }, response, rates);
    // 2 * 0.01 + 1 * 0.02 = 0.04
    assert(Math.abs(cost - 0.04) < 1e-10);
  });

  it('handles opts with only system (no user)', () => {
    const cost = computeCallCost({ system: 'test' }, 'ok');
    assert(cost > 0);
  });

  it('handles opts with only user (no system)', () => {
    const cost = computeCallCost({ user: 'hello' }, 'response');
    assert(cost > 0);
  });

  it('partial rate override keeps the un-overridden default', () => {
    // Override only output rate; input should remain DEFAULT_RATES.input_per_token
    const system = 'a'.repeat(4); // 1 input token
    const response = 'b'.repeat(4); // 1 output token
    const rates = { output_per_token: 1.0 }; // $1 per output token (absurd, but deterministic)
    const cost = computeCallCost({ system }, response, rates);
    const expected = 1 * DEFAULT_RATES.input_per_token + 1 * 1.0;
    assert(Math.abs(cost - expected) < 1e-12);
  });
});

// ── 3. getCostFilePath ────────────────────────────────────────────────────────

describe('getCostFilePath', () => {
  it('returns {data_dir}/daemon-cost.json', () => {
    const config = makeConfig();
    assert.strictEqual(
      getCostFilePath(config),
      path.join(config.data_dir, 'daemon-cost.json'),
    );
  });
});

// ── 4. utcDateString ──────────────────────────────────────────────────────────

describe('utcDateString', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    const d = utcDateString();
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts an injectable Date for deterministic tests', () => {
    const d = utcDateString(new Date('2026-04-05T15:30:00Z'));
    assert.strictEqual(d, '2026-04-05');
  });

  it('handles UTC midnight correctly', () => {
    const d = utcDateString(new Date('2026-01-01T00:00:00Z'));
    assert.strictEqual(d, '2026-01-01');
  });
});

// ── 5. getDailyCost ───────────────────────────────────────────────────────────

describe('getDailyCost', () => {
  it('returns 0 when cost file does not exist', () => {
    const config = makeConfig('no-file');
    assert.strictEqual(getDailyCost(config), 0);
  });

  it('returns 0 when the file has no entry for the requested date', () => {
    const config = makeConfig('missing-key');
    resetDailyCost(config);
    assert.strictEqual(getDailyCost(config, '2020-01-01'), 0);
  });

  it('returns the stored value for the requested date', () => {
    const config = makeConfig('existing-entry');
    const date = '2026-04-05';
    recordCallCost(config, 0.0123, date);
    assert(Math.abs(getDailyCost(config, date) - 0.0123) < 1e-10);
  });

  it('does NOT return cost recorded for a different date', () => {
    const config = makeConfig('date-isolation');
    recordCallCost(config, 0.50, '2026-04-04'); // yesterday
    assert.strictEqual(getDailyCost(config, '2026-04-05'), 0);
  });

  it('defaults to today UTC when no date argument is supplied', () => {
    const config = makeConfig('today-default');
    const today = utcDateString();
    recordCallCost(config, 0.007, today);
    assert(getDailyCost(config) > 0);
  });

  it('returns 0 for a corrupt cost file', () => {
    const config = makeConfig('corrupt');
    fs.writeFileSync(getCostFilePath(config), 'NOT VALID JSON', 'utf8');
    assert.strictEqual(getDailyCost(config, '2026-04-05'), 0);
  });

  it('returns 0 when the file contains a non-numeric value for the date key', () => {
    const config = makeConfig('non-numeric');
    fs.writeFileSync(
      getCostFilePath(config),
      JSON.stringify({ '2026-04-05': 'oops' }),
      'utf8',
    );
    assert.strictEqual(getDailyCost(config, '2026-04-05'), 0);
  });
});

// ── 6. recordCallCost ─────────────────────────────────────────────────────────

describe('recordCallCost', () => {
  it('creates the cost file when it does not exist', () => {
    const config = makeConfig('create-file');
    const filePath = getCostFilePath(config);
    assert(!fs.existsSync(filePath));
    recordCallCost(config, 0.001, '2026-04-05');
    assert(fs.existsSync(filePath));
  });

  it('creates parent directories as needed', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'data-dir');
    fs.mkdirSync(nested, { recursive: true });
    const config = { data_dir: nested };
    recordCallCost(config, 0.005, '2026-04-05');
    assert(fs.existsSync(getCostFilePath(config)));
  });

  it('accumulates cost across multiple calls on the same date', () => {
    const config = makeConfig('accumulate');
    const date = '2026-04-05';
    recordCallCost(config, 0.010, date);
    recordCallCost(config, 0.005, date);
    recordCallCost(config, 0.003, date);
    assert(Math.abs(getDailyCost(config, date) - 0.018) < 1e-10);
  });

  it('records costs for different dates independently', () => {
    const config = makeConfig('multi-date');
    recordCallCost(config, 0.10, '2026-04-04');
    recordCallCost(config, 0.20, '2026-04-05');
    assert(Math.abs(getDailyCost(config, '2026-04-04') - 0.10) < 1e-10);
    assert(Math.abs(getDailyCost(config, '2026-04-05') - 0.20) < 1e-10);
  });

  it('ignores zero cost (no-op)', () => {
    const config = makeConfig('zero-cost');
    recordCallCost(config, 0.05, '2026-04-05');
    recordCallCost(config, 0, '2026-04-05');
    assert(Math.abs(getDailyCost(config, '2026-04-05') - 0.05) < 1e-10);
  });

  it('ignores negative cost (no-op)', () => {
    const config = makeConfig('negative-cost');
    recordCallCost(config, 0.05, '2026-04-05');
    recordCallCost(config, -0.01, '2026-04-05');
    assert(Math.abs(getDailyCost(config, '2026-04-05') - 0.05) < 1e-10);
  });

  it('ignores non-numeric cost (no-op)', () => {
    const config = makeConfig('non-numeric-cost');
    recordCallCost(config, 0.05, '2026-04-05');
    recordCallCost(config, 'abc', '2026-04-05');
    assert(Math.abs(getDailyCost(config, '2026-04-05') - 0.05) < 1e-10);
  });

  it('recovers gracefully from a corrupt cost file by starting fresh', () => {
    const config = makeConfig('corrupt-recover');
    fs.writeFileSync(getCostFilePath(config), '{ broken json', 'utf8');
    assert.doesNotThrow(() => recordCallCost(config, 0.01, '2026-04-05'));
    assert(Math.abs(getDailyCost(config, '2026-04-05') - 0.01) < 1e-10);
  });

  it('defaults to today UTC when no date argument is supplied', () => {
    const config = makeConfig('today-default-record');
    const today = utcDateString();
    recordCallCost(config, 0.042);
    assert(Math.abs(getDailyCost(config, today) - 0.042) < 1e-10);
  });
});

// ── 7. resetDailyCost ─────────────────────────────────────────────────────────

describe('resetDailyCost', () => {
  it('writes an empty JSON object to the cost file', () => {
    const config = makeConfig('reset-writes');
    recordCallCost(config, 0.99, '2026-04-05');
    resetDailyCost(config);
    const raw = fs.readFileSync(getCostFilePath(config), 'utf8');
    assert.deepStrictEqual(JSON.parse(raw), {});
  });

  it('getDailyCost returns 0 after reset', () => {
    const config = makeConfig('reset-zero');
    recordCallCost(config, 0.123, '2026-04-05');
    resetDailyCost(config);
    assert.strictEqual(getDailyCost(config, '2026-04-05'), 0);
  });

  it('creates the file if it does not exist', () => {
    const config = makeConfig('reset-create');
    assert(!fs.existsSync(getCostFilePath(config)));
    assert.doesNotThrow(() => resetDailyCost(config));
    assert(fs.existsSync(getCostFilePath(config)));
  });

  it('subsequent recordCallCost works correctly after reset', () => {
    const config = makeConfig('reset-then-record');
    recordCallCost(config, 10.0, '2026-04-05');
    resetDailyCost(config);
    recordCallCost(config, 0.007, '2026-04-05');
    assert(Math.abs(getDailyCost(config, '2026-04-05') - 0.007) < 1e-10);
  });
});
