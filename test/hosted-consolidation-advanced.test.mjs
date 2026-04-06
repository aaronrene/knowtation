import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeConsolidateRequestBodyWithBillingDefaults,
  validateHostedSettingsConsolidationAdvanced,
  hostedAdvancedFromBillingUser,
  clampConsolidationInt,
} from '../lib/hosted-consolidation-advanced.mjs';
import { normalizeBillingUser, defaultUserRecord } from '../hub/gateway/billing-logic.mjs';

describe('hostedAdvancedFromBillingUser', () => {
  it('returns defaults for null user', () => {
    const d = hostedAdvancedFromBillingUser(null);
    assert.equal(d.lookback_hours, 24);
    assert.equal(d.max_events_per_pass, 200);
    assert.equal(d.max_topics_per_pass, 10);
    assert.equal(d.llm_max_tokens, 1024);
  });

  it('reads normalized billing fields', () => {
    const d = hostedAdvancedFromBillingUser({
      consolidation_lookback_hours: 72,
      consolidation_max_events_per_pass: 50,
      consolidation_max_topics_per_pass: 3,
      consolidation_llm_max_tokens: 512,
    });
    assert.equal(d.lookback_hours, 72);
    assert.equal(d.max_events_per_pass, 50);
    assert.equal(d.max_topics_per_pass, 3);
    assert.equal(d.llm_max_tokens, 512);
  });
});

describe('mergeConsolidateRequestBodyWithBillingDefaults', () => {
  const u = {
    consolidation_lookback_hours: 48,
    consolidation_max_events_per_pass: 120,
    consolidation_max_topics_per_pass: 7,
    consolidation_llm_max_tokens: 1536,
  };

  it('fills missing keys from billing user', () => {
    const out = mergeConsolidateRequestBodyWithBillingDefaults({ passes: { consolidate: true } }, u);
    assert.equal(out.lookback_hours, 48);
    assert.equal(out.max_events_per_pass, 120);
    assert.equal(out.max_topics_per_pass, 7);
    assert.equal(out.llm.max_tokens, 1536);
    assert.equal(out.passes.consolidate, true);
  });

  it('request body overrides billing defaults', () => {
    const out = mergeConsolidateRequestBodyWithBillingDefaults(
      { lookback_hours: 12, max_events_per_pass: 80, llm: { max_tokens: 256 } },
      u,
    );
    assert.equal(out.lookback_hours, 12);
    assert.equal(out.max_events_per_pass, 80);
    assert.equal(out.max_topics_per_pass, 7);
    assert.equal(out.llm.max_tokens, 256);
  });

  it('preserves extra llm keys from body', () => {
    const out = mergeConsolidateRequestBodyWithBillingDefaults({ llm: { foo: 1 } }, u);
    assert.equal(out.llm.foo, 1);
    assert.equal(out.llm.max_tokens, 1536);
  });
});

describe('validateHostedSettingsConsolidationAdvanced', () => {
  it('accepts empty body', () => {
    assert.equal(validateHostedSettingsConsolidationAdvanced({}).ok, true);
  });

  it('rejects lookback out of range', () => {
    const r = validateHostedSettingsConsolidationAdvanced({ lookback_hours: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /lookback_hours/);
  });

  it('rejects max_events_per_pass out of range (above)', () => {
    const r = validateHostedSettingsConsolidationAdvanced({ max_events_per_pass: 10001 });
    assert.equal(r.ok, false);
    assert.match(r.error, /max_events_per_pass/);
  });

  it('rejects max_topics_per_pass out of range (below)', () => {
    const r = validateHostedSettingsConsolidationAdvanced({ max_topics_per_pass: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /max_topics_per_pass/);
  });

  it('rejects max_tokens out of range', () => {
    const r = validateHostedSettingsConsolidationAdvanced({ llm: { max_tokens: 10 } });
    assert.equal(r.ok, false);
    assert.match(r.error, /max_tokens/);
  });

  it('rejects NaN / non-numeric lookback_hours', () => {
    assert.equal(validateHostedSettingsConsolidationAdvanced({ lookback_hours: 'garbage' }).ok, false);
    assert.equal(validateHostedSettingsConsolidationAdvanced({ lookback_hours: NaN }).ok, false);
  });

  it('rejects NaN max_events_per_pass', () => {
    assert.equal(validateHostedSettingsConsolidationAdvanced({ max_events_per_pass: 'abc' }).ok, false);
  });

  it('rejects NaN max_topics_per_pass', () => {
    assert.equal(validateHostedSettingsConsolidationAdvanced({ max_topics_per_pass: undefined }).ok, true,
      'undefined fields should be skipped (not present)');
    assert.equal(validateHostedSettingsConsolidationAdvanced({ max_topics_per_pass: null }).ok, false,
      'null should fail as it is defined but not numeric');
  });

  it('rejects NaN llm.max_tokens', () => {
    assert.equal(validateHostedSettingsConsolidationAdvanced({ llm: { max_tokens: 'foo' } }).ok, false);
  });

  it('accepts boundary values', () => {
    assert.equal(
      validateHostedSettingsConsolidationAdvanced({
        lookback_hours: 8760,
        max_events_per_pass: 10000,
        max_topics_per_pass: 500,
        llm: { max_tokens: 8192 },
      }).ok,
      true,
    );
  });

  it('accepts minimum boundary values', () => {
    assert.equal(
      validateHostedSettingsConsolidationAdvanced({
        lookback_hours: 1,
        max_events_per_pass: 1,
        max_topics_per_pass: 1,
        llm: { max_tokens: 64 },
      }).ok,
      true,
    );
  });
});

describe('clampConsolidationInt', () => {
  it('clamps to range', () => {
    assert.equal(clampConsolidationInt(5000, 1, 8760, 24), 5000);
    assert.equal(clampConsolidationInt(999999, 1, 8760, 24), 8760);
    assert.equal(clampConsolidationInt('bad', 1, 10, 3), 3);
  });

  it('clamps below-min to min', () => {
    assert.equal(clampConsolidationInt(-5, 1, 100, 50), 1);
  });

  it('uses fallback for undefined, NaN, Infinity (non-finite)', () => {
    assert.equal(clampConsolidationInt(undefined, 1, 100, 50), 50);
    assert.equal(clampConsolidationInt(NaN, 1, 100, 50), 50);
    assert.equal(clampConsolidationInt(Infinity, 1, 100, 50), 50);
    assert.equal(clampConsolidationInt(-Infinity, 1, 100, 50), 50);
  });

  it('clamps null (Number(null)===0) to min, not fallback', () => {
    assert.equal(clampConsolidationInt(null, 1, 100, 50), 1);
  });
});

describe('normalizeBillingUser — advanced field migration (old records)', () => {
  it('adds default advanced fields to a record that lacks them', () => {
    const old = { user_id: 'legacy', tier: 'plus', consolidation_enabled: true };
    const u = normalizeBillingUser(old);
    assert.equal(u.consolidation_lookback_hours, 24);
    assert.equal(u.consolidation_max_events_per_pass, 200);
    assert.equal(u.consolidation_max_topics_per_pass, 10);
    assert.equal(u.consolidation_llm_max_tokens, 1024);
  });

  it('clamps out-of-range advanced values to valid range', () => {
    const bad = {
      user_id: 'clamped',
      consolidation_lookback_hours: 99999,
      consolidation_max_events_per_pass: -5,
      consolidation_max_topics_per_pass: 0,
      consolidation_llm_max_tokens: 50000,
    };
    const u = normalizeBillingUser(bad);
    assert.equal(u.consolidation_lookback_hours, 8760);
    assert.equal(u.consolidation_max_events_per_pass, 1);
    assert.equal(u.consolidation_max_topics_per_pass, 1);
    assert.equal(u.consolidation_llm_max_tokens, 8192);
  });

  it('preserves valid in-range advanced values', () => {
    const good = {
      user_id: 'preserved',
      consolidation_lookback_hours: 72,
      consolidation_max_events_per_pass: 150,
      consolidation_max_topics_per_pass: 8,
      consolidation_llm_max_tokens: 2048,
    };
    const u = normalizeBillingUser(good);
    assert.equal(u.consolidation_lookback_hours, 72);
    assert.equal(u.consolidation_max_events_per_pass, 150);
    assert.equal(u.consolidation_max_topics_per_pass, 8);
    assert.equal(u.consolidation_llm_max_tokens, 2048);
  });

  it('defaultUserRecord includes all four advanced fields', () => {
    const u = defaultUserRecord('new_user');
    assert.equal(u.consolidation_lookback_hours, 24);
    assert.equal(u.consolidation_max_events_per_pass, 200);
    assert.equal(u.consolidation_max_topics_per_pass, 10);
    assert.equal(u.consolidation_llm_max_tokens, 1024);
  });
});
