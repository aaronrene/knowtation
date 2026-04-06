import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  populateConsolSettingsForm,
  buildConsolSettingsPayload,
  renderConsolidationHistory,
  formatCostMeter,
} from '../web/hub/consolidation-ui-logic.mjs';
import { normalizeBillingUser, defaultUserRecord } from '../hub/gateway/billing-logic.mjs';

describe('populateConsolSettingsForm', () => {
  function makeForm() {
    return {
      'consol-interval': { value: '' },
      'consol-idle-only': { checked: false },
      'consol-idle-threshold': { value: '' },
      'consol-run-on-start': { checked: false },
      'pass-consolidate': { checked: false },
      'pass-verify': { checked: false },
      'pass-discover': { checked: false },
      'consol-llm-provider': { value: '' },
      'consol-llm-model': { value: '' },
      'consol-llm-base-url': { value: '' },
      'consol-cost-cap': { value: '' },
      'consol-hosted-interval': { value: '120' },
    };
  }

  it('returns off for null settings', () => {
    assert.equal(populateConsolSettingsForm(null, makeForm()), 'off');
  });

  it('returns off when daemon is missing', () => {
    assert.equal(populateConsolSettingsForm({}, makeForm()), 'off');
  });

  it('returns daemon when daemon.enabled is true', () => {
    const settings = { daemon: { enabled: true, interval_minutes: 60 } };
    const form = makeForm();
    assert.equal(populateConsolSettingsForm(settings, form), 'daemon');
    assert.equal(form['consol-interval'].value, 60);
  });

  it('returns hosted when vault_path_display is canister', () => {
    const settings = { daemon: { enabled: false }, vault_path_display: 'canister' };
    assert.equal(populateConsolSettingsForm(settings, makeForm()), 'hosted');
  });

  it('returns hosted when hosted_delegating is true', () => {
    const settings = { daemon: { enabled: false }, hosted_delegating: true };
    assert.equal(populateConsolSettingsForm(settings, makeForm()), 'hosted');
  });

  it('syncs consol-hosted-interval when interval matches schedule options', () => {
    const settings = {
      daemon: { enabled: false, interval_minutes: 360 },
      hosted_delegating: true,
    };
    const form = makeForm();
    populateConsolSettingsForm(settings, form);
    assert.equal(form['consol-hosted-interval'].value, '360');
  });

  it('populates all form fields from daemon config', () => {
    const settings = {
      daemon: {
        enabled: true,
        interval_minutes: 240,
        idle_only: false,
        idle_threshold_minutes: 30,
        run_on_start: true,
        max_cost_per_day_usd: 0.05,
        passes: { consolidate: true, verify: false, discover: true },
        llm: { provider: 'openai', model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1' },
      },
    };
    const form = makeForm();
    populateConsolSettingsForm(settings, form);
    assert.equal(form['consol-interval'].value, 240);
    assert.equal(form['consol-idle-only'].checked, false);
    assert.equal(form['consol-idle-threshold'].value, 30);
    assert.equal(form['consol-run-on-start'].checked, true);
    assert.equal(form['pass-consolidate'].checked, true);
    assert.equal(form['pass-verify'].checked, false);
    assert.equal(form['pass-discover'].checked, true);
    assert.equal(form['consol-llm-provider'].value, 'openai');
    assert.equal(form['consol-llm-model'].value, 'gpt-4o-mini');
    assert.equal(form['consol-llm-base-url'].value, 'https://api.openai.com/v1');
    assert.equal(form['consol-cost-cap'].value, 0.05);
  });

  it('uses defaults for missing daemon fields', () => {
    const form = makeForm();
    populateConsolSettingsForm({ daemon: {} }, form);
    assert.equal(form['consol-interval'].value, 120);
    assert.equal(form['consol-idle-only'].checked, true);
    assert.equal(form['consol-idle-threshold'].value, 15);
    assert.equal(form['consol-run-on-start'].checked, false);
    assert.equal(form['pass-consolidate'].checked, true);
    assert.equal(form['pass-verify'].checked, true);
    assert.equal(form['pass-discover'].checked, false);
    assert.equal(form['consol-cost-cap'].value, '');
  });
});

describe('buildConsolSettingsPayload', () => {
  function makeForm(overrides = {}) {
    return {
      'consol-interval': { value: '120' },
      'consol-hosted-interval': { value: '120' },
      'consol-idle-only': { checked: true },
      'consol-idle-threshold': { value: '15' },
      'consol-run-on-start': { checked: false },
      'pass-consolidate': { checked: true },
      'pass-verify': { checked: true },
      'pass-discover': { checked: false },
      'consol-llm-provider': { value: '' },
      'consol-llm-model': { value: '' },
      'consol-llm-base-url': { value: '' },
      'consol-cost-cap': { value: '' },
      ...overrides,
    };
  }

  it('builds daemon payload', () => {
    const payload = buildConsolSettingsPayload(makeForm(), 'daemon');
    assert.equal(payload.mode, 'daemon');
    assert.equal(payload.enabled, true);
    assert.equal(payload.interval_minutes, 120);
    assert.equal(payload.idle_only, true);
    assert.equal(payload.idle_threshold_minutes, 15);
    assert.equal(payload.run_on_start, false);
    assert.deepEqual(payload.passes, { consolidate: true, verify: true, discover: false });
    assert.deepEqual(payload.llm, { provider: '', model: '', base_url: '' });
    assert.equal(payload.max_cost_per_day_usd, null);
  });

  it('builds off payload', () => {
    const payload = buildConsolSettingsPayload(makeForm(), 'off');
    assert.equal(payload.mode, 'off');
    assert.equal(payload.enabled, false);
  });

  it('builds hosted payload (not enabled as daemon, mode=hosted)', () => {
    const payload = buildConsolSettingsPayload(makeForm(), 'hosted');
    assert.equal(payload.mode, 'hosted');
    assert.equal(payload.enabled, false);
  });

  it('uses consol-hosted-interval for interval_minutes when mode is hosted', () => {
    const payload = buildConsolSettingsPayload(
      makeForm({ 'consol-hosted-interval': { value: '360' }, 'consol-interval': { value: '120' } }),
      'hosted',
    );
    assert.equal(payload.interval_minutes, 360);
  });

  it('includes cost cap when set', () => {
    const form = makeForm({ 'consol-cost-cap': { value: '0.10' } });
    const payload = buildConsolSettingsPayload(form, 'daemon');
    assert.equal(payload.max_cost_per_day_usd, 0.10);
  });

  it('null cost cap when value is empty', () => {
    const form = makeForm({ 'consol-cost-cap': { value: '' } });
    const payload = buildConsolSettingsPayload(form, 'daemon');
    assert.equal(payload.max_cost_per_day_usd, null);
  });

  it('includes LLM overrides', () => {
    const form = makeForm({
      'consol-llm-provider': { value: 'ollama' },
      'consol-llm-model': { value: 'llama3' },
      'consol-llm-base-url': { value: 'http://localhost:11434' },
    });
    const payload = buildConsolSettingsPayload(form, 'daemon');
    assert.deepEqual(payload.llm, { provider: 'ollama', model: 'llama3', base_url: 'http://localhost:11434' });
  });

  it('clamps interval_minutes to at least 1', () => {
    const form = makeForm({ 'consol-interval': { value: '-5' } });
    const payload = buildConsolSettingsPayload(form, 'daemon');
    assert.equal(payload.interval_minutes, 1);
  });

  it('floors non-integer interval', () => {
    const form = makeForm({ 'consol-interval': { value: '123.7' } });
    const payload = buildConsolSettingsPayload(form, 'daemon');
    assert.equal(payload.interval_minutes, 123);
  });
});

describe('renderConsolidationHistory', () => {
  function makeContainer() {
    return { innerHTML: '' };
  }

  it('renders empty message for no events', () => {
    const c = makeContainer();
    const count = renderConsolidationHistory([], c);
    assert.equal(count, 0);
    assert.ok(c.innerHTML.includes('No consolidation history'));
  });

  it('renders empty message for null events', () => {
    const c = makeContainer();
    const count = renderConsolidationHistory(null, c);
    assert.equal(count, 0);
  });

  it('renders correct number of rows (ts field from real memory events)', () => {
    const events = [
      { ts: '2026-04-01T10:00:00Z', data: { topics_count: 3, total_events: 15, cost_usd: 0.004 } },
      { ts: '2026-04-02T10:00:00Z', data: { topics_count: 5, total_events: 22, cost_usd: 0.007, dry_run: true } },
      { ts: '2026-04-03T10:00:00Z', data: { topics_count: 2, total_events: 8, cost_usd: 0.003, error: 'LLM timeout' } },
    ];
    const c = makeContainer();
    const count = renderConsolidationHistory(events, c);
    assert.equal(count, 3);
    assert.ok(c.innerHTML.includes('<table'));
    assert.ok(c.innerHTML.includes('</table>'));
    const trCount = (c.innerHTML.match(/<tr>/g) || []).length;
    assert.equal(trCount, 4); // 1 header + 3 data rows
  });

  it('renders date using legacy timestamp field as fallback', () => {
    const events = [{ timestamp: '2026-04-01T10:00:00Z', data: { topics_count: 1 } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    // The date cell must contain a human-readable date, not '—'.
    // Extract just the first <td> value from the rendered HTML.
    const firstTd = c.innerHTML.match(/<td>([^<]*)<\/td>/);
    assert.ok(firstTd && firstTd[1] !== '—', 'date cell should not be — when timestamp is present');
  });

  it('shows events merged from event_count fallback (per-topic shape)', () => {
    const events = [{ ts: '2026-04-01T10:00:00Z', data: { topic: 'AI', event_count: 7 } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    assert.ok(c.innerHTML.includes('7'), 'event_count should render in Events Merged column');
  });

  it('handles topics_count as array (legacy malformed events) by rendering .length', () => {
    const topicsArray = [{ topic: 'AI' }, { topic: 'UX' }, { topic: 'Security' }];
    const events = [{ ts: '2026-04-01T10:00:00Z', data: { topics_count: topicsArray, total_events: 10 } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    assert.ok(c.innerHTML.includes('3'), 'array topics_count should render as its length (3)');
    assert.ok(!c.innerHTML.includes('[object Object]'), 'should not render [object Object]');
  });

  it('shows dry-run status', () => {
    const events = [{ ts: '2026-04-01T10:00:00Z', data: { dry_run: true } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    assert.ok(c.innerHTML.includes('dry-run'));
  });

  it('shows error status', () => {
    const events = [{ ts: '2026-04-01T10:00:00Z', data: { error: 'fail' } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    assert.ok(c.innerHTML.includes('error'));
  });

  it('shows complete status for normal events', () => {
    const events = [{ ts: '2026-04-01T10:00:00Z', data: { topics_count: 1 } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    assert.ok(c.innerHTML.includes('complete'));
  });

  it('returns 0 for null container', () => {
    assert.equal(renderConsolidationHistory([{ data: {} }], null), 0);
  });

  it('escapes HTML in event data', () => {
    const events = [{ ts: '2026-04-01T10:00:00Z', data: { topics_count: '<script>alert(1)</script>' } }];
    const c = makeContainer();
    renderConsolidationHistory(events, c);
    assert.ok(!c.innerHTML.includes('<script>'));
    assert.ok(c.innerHTML.includes('&lt;script&gt;'));
  });
});

describe('formatCostMeter', () => {
  it('returns no meter when cap is null', () => {
    const r = formatCostMeter(0.005, null);
    assert.equal(r.showMeter, false);
    assert.equal(r.fillPercent, 0);
    assert.equal(r.display, '$0.005 today');
    assert.equal(r.capLabel, '');
  });

  it('returns no meter when cap is 0', () => {
    const r = formatCostMeter(0.003, 0);
    assert.equal(r.showMeter, false);
  });

  it('calculates fill percent correctly', () => {
    const r = formatCostMeter(0.025, 0.05);
    assert.equal(r.showMeter, true);
    assert.equal(r.fillPercent, 50);
    assert.equal(r.display, '$0.025 today');
    assert.equal(r.capLabel, 'cap: $0.05');
  });

  it('caps fill percent at 100', () => {
    const r = formatCostMeter(0.10, 0.05);
    assert.equal(r.fillPercent, 100);
    assert.equal(r.showMeter, true);
  });

  it('handles zero cost with cap', () => {
    const r = formatCostMeter(0, 0.05);
    assert.equal(r.fillPercent, 0);
    assert.equal(r.showMeter, true);
    assert.equal(r.display, '$0.000 today');
  });

  it('handles negative cost gracefully', () => {
    const r = formatCostMeter(-1, 0.05);
    assert.equal(r.fillPercent, 0);
    assert.equal(r.display, '$0.000 today');
  });

  it('handles NaN cost gracefully', () => {
    const r = formatCostMeter(NaN, 0.10);
    assert.equal(r.fillPercent, 0);
    assert.equal(r.display, '$0.000 today');
  });

  it('handles undefined inputs', () => {
    const r = formatCostMeter(undefined, undefined);
    assert.equal(r.showMeter, false);
    assert.equal(r.display, '$0.000 today');
  });
});

describe('gateway consolidation settings — billing store logic', () => {
  it('defaultUserRecord includes consolidation_passes', () => {
    const u = defaultUserRecord('test-user');
    assert.deepEqual(u.consolidation_passes, { consolidate: true, verify: true, discover: false });
    assert.equal(u.consolidation_enabled, false);
    assert.equal(u.consolidation_interval_minutes, null);
  });

  it('normalizeBillingUser adds consolidation_passes when missing', () => {
    const u = normalizeBillingUser({ user_id: 'x' });
    assert.deepEqual(u.consolidation_passes, { consolidate: true, verify: true, discover: false });
  });

  it('normalizeBillingUser preserves existing consolidation_passes', () => {
    const u = normalizeBillingUser({
      user_id: 'x',
      consolidation_passes: { consolidate: false, verify: true, discover: true },
    });
    assert.deepEqual(u.consolidation_passes, { consolidate: false, verify: true, discover: true });
  });

  it('normalizeBillingUser sets consolidation_enabled=false when undefined', () => {
    const u = normalizeBillingUser({ user_id: 'x' });
    assert.equal(u.consolidation_enabled, false);
  });

  it('buildConsolSettingsPayload mode=hosted sends mode field for gateway to distinguish from off', () => {
    const form = {
      'consol-interval': { value: '120' },
      'consol-idle-only': { checked: true },
      'consol-idle-threshold': { value: '15' },
      'consol-run-on-start': { checked: false },
      'pass-consolidate': { checked: true },
      'pass-verify': { checked: true },
      'pass-discover': { checked: false },
      'consol-llm-provider': { value: '' },
      'consol-llm-model': { value: '' },
      'consol-llm-base-url': { value: '' },
      'consol-cost-cap': { value: '' },
    };
    const hosted = buildConsolSettingsPayload(form, 'hosted');
    const off = buildConsolSettingsPayload(form, 'off');
    assert.equal(hosted.mode, 'hosted');
    assert.equal(off.mode, 'off');
    assert.notEqual(hosted.mode, off.mode, 'hosted and off must be distinguishable');
  });
});
