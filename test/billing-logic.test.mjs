import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryDeduct, inferPackConsolidationPassesFromIndexingTokenBalance } from '../hub/gateway/billing-logic.mjs';

test('tryDeduct: beta tier never blocks', () => {
  const u = {
    tier: 'beta',
    monthly_included_cents: 0,
    monthly_used_cents: 0,
    addon_cents: 0,
  };
  assert.equal(tryDeduct(u, 999999).ok, true);
});

test('tryDeduct: monthly pool only', () => {
  const u = {
    tier: 'starter',
    monthly_included_cents: 1000,
    monthly_used_cents: 0,
    addon_cents: 0,
  };
  assert.equal(tryDeduct(u, 400).ok, true);
  assert.equal(u.monthly_used_cents, 400);
  assert.equal(tryDeduct(u, 600).ok, true);
  assert.equal(u.monthly_used_cents, 1000);
});

test('tryDeduct: spills to addon rollover', () => {
  const u = {
    tier: 'starter',
    monthly_included_cents: 1000,
    monthly_used_cents: 800,
    addon_cents: 500,
  };
  assert.equal(tryDeduct(u, 500).ok, true);
  assert.equal(u.monthly_used_cents, 1000);
  assert.equal(u.addon_cents, 200);
});

test('tryDeduct: free tier uses small monthly pool', () => {
  const u = {
    tier: 'free',
    monthly_included_cents: 0,
    monthly_used_cents: 0,
    addon_cents: 0,
  };
  assert.equal(tryDeduct(u, 100).ok, true);
  assert.equal(u.monthly_used_cents, 100);
  assert.equal(tryDeduct(u, 200).ok, true);
  assert.equal(u.monthly_used_cents, 300);
  assert.equal(tryDeduct(u, 1).ok, false);
});

test('tryDeduct: QUOTA_EXHAUSTED when both pools insufficient', () => {
  const u = {
    tier: 'starter',
    monthly_included_cents: 100,
    monthly_used_cents: 100,
    addon_cents: 50,
  };
  const r = tryDeduct(u, 100);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'QUOTA_EXHAUSTED');
});

test('inferPackConsolidationPassesFromIndexingTokenBalance: 80M → 200 (medium + small)', () => {
  assert.equal(inferPackConsolidationPassesFromIndexingTokenBalance(80_000_000), 200);
});

test('inferPackConsolidationPassesFromIndexingTokenBalance: 60M → 150 (one medium)', () => {
  assert.equal(inferPackConsolidationPassesFromIndexingTokenBalance(60_000_000), 150);
});

test('inferPackConsolidationPassesFromIndexingTokenBalance: 20M → 50 (one small)', () => {
  assert.equal(inferPackConsolidationPassesFromIndexingTokenBalance(20_000_000), 50);
});

test('inferPackConsolidationPassesFromIndexingTokenBalance: remainder uses 400k tokens/pass', () => {
  assert.equal(inferPackConsolidationPassesFromIndexingTokenBalance(10_000_000), 25);
});

test('inferPackConsolidationPassesFromIndexingTokenBalance: zero / NaN', () => {
  assert.equal(inferPackConsolidationPassesFromIndexingTokenBalance(0), 0);
  assert.equal(inferPackConsolidationPassesFromIndexingTokenBalance(NaN), 0);
});
