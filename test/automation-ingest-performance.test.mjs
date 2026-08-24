/**
 * AIP-b performance: routeAutomationIngest p95 on 32 rules (local budget).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeAutomationIngest, normalizeRuleForSave } from '../lib/automation-ingest-policy.mjs';

const P95_BUDGET_MS = 25;

describe('automation ingest performance', () => {
  it('routeAutomationIngest p95 under local 25ms budget on 32 rules', () => {
    const rules = [];
    for (let i = 0; i < 32; i++) {
      rules.push(normalizeRuleForSave({
        label: `r${i}`,
        priority: 100 - i,
        disposition: i === 31 ? 'direct_note' : 'review_queue',
        enabled: true,
        match: { path_prefix: i === 31 ? 'inbox/trends/' : `inbox/other${i}/` },
        content_class: 'research',
      }));
    }
    const samples = [];
    for (let n = 0; n < 200; n++) {
      const t0 = performance.now();
      const routed = routeAutomationIngest(
        {
          path: 'inbox/trends/perf.md',
          body: 'x',
          content_class: 'research',
          credential_name: 'bot',
        },
        rules
      );
      samples.push(performance.now() - t0);
      assert.equal(routed.disposition, 'direct_note');
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    assert.ok(p95 < P95_BUDGET_MS, `p95 ${p95}ms exceeded local budget ${P95_BUDGET_MS}ms`);
  });
});
