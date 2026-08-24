/**
 * AIP-b unit: router, match, scopes, D3/D9/D10/D15.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeAutomationIngest,
  isIngestContractBody,
  normalizeIngestBody,
  idempotencyKeyFromRequest,
  normalizeRuleForSave,
  listPackTemplates,
} from '../lib/automation-ingest-policy.mjs';
import {
  agentScopesPermitMethod,
  applyScopeCeiling,
  DEFAULT_AGENT_SCOPES,
  ALLOWED_AGENT_SCOPES,
} from '../hub/lib/agent-credential-core.mjs';

function rule(partial) {
  return normalizeRuleForSave({
    label: partial.label || 'r',
    priority: partial.priority ?? 100,
    disposition: partial.disposition || 'review_queue',
    content_class: partial.content_class || 'research',
    enabled: partial.enabled !== false,
    match: partial.match || { path_prefix: 'inbox/trends/' },
    rule_id: partial.rule_id,
  });
}

describe('automation ingest unit', () => {
  it('normalize + contract body', () => {
    const n = normalizeIngestBody({
      path: '/inbox/trends/a.md',
      body: 'hello',
      source_fingerprint: 'sha256:abcdef12',
      content_class: 'research',
    });
    assert.equal(n.path, 'inbox/trends/a.md');
    assert.equal(n.source, 'automation_ingest');
    assert.equal(isIngestContractBody({ source_fingerprint: 'sha256:abcdef12', ingest: true }), true);
    assert.equal(isIngestContractBody({ source_fingerprint: 'sha256:abcdef12', content_class: 'research' }), true);
    assert.equal(isIngestContractBody({ source_fingerprint: 'sha256:abcdef12' }), false);
    assert.equal(isIngestContractBody({ ingest: true }), false);
  });

  it('first-match by priority then rule_id', () => {
    const a = rule({ rule_id: 'ingr_aaaaaaaaaaaaaaaa', priority: 50, label: 'a', disposition: 'direct_note' });
    const b = rule({ rule_id: 'ingr_bbbbbbbbbbbbbbbb', priority: 10, label: 'b', disposition: 'review_queue' });
    const routed = routeAutomationIngest(
      { path: 'inbox/trends/x.md', body: 'x', content_class: 'research', credential_name: 'bot' },
      [a, b]
    );
    assert.equal(routed.rule_id, b.rule_id);
    assert.equal(routed.disposition, 'review_queue');
  });

  it('D3 empty match rejected on save', () => {
    assert.throws(
      () => normalizeRuleForSave({ label: 'empty', disposition: 'review_queue', match: {} }),
      (e) => e.code === 'INGEST_RULE_MATCH_EMPTY'
    );
  });

  it('D9 elevated override forces review_queue', () => {
    const r = rule({
      rule_id: 'ingr_cccccccccccccccc',
      disposition: 'direct_note',
      match: { path_prefix: 'legal/' },
    });
    const routed = routeAutomationIngest(
      {
        path: 'legal/secret.md',
        body: 'reset password for admin',
        content_class: 'ops',
        triggers: {
          literal_phrases: [{ match: 'reset password', review_severity: 'elevated' }],
          path_prefixes: [],
          label_any: [],
        },
      },
      [r]
    );
    assert.equal(routed.disposition, 'review_queue');
    assert.equal(routed.elevated_override, true);
  });

  it('D10 evaluation block rewrites auto-apply for agents', () => {
    const r = rule({
      rule_id: 'ingr_dddddddddddddddd',
      disposition: 'proposal_auto_apply',
      match: { path_prefix: 'inbox/trends/' },
    });
    const routed = routeAutomationIngest(
      {
        path: 'inbox/trends/x.md',
        body: 'x',
        content_class: 'research',
        evaluationRequired: true,
        sessionBound: false,
      },
      [r]
    );
    assert.equal(routed.disposition, 'review_queue');
    assert.equal(routed.evaluation_block, true);
  });

  it('D15 idempotency key prefers header', () => {
    assert.equal(idempotencyKeyFromRequest('headerkey12', 'fingerprint12'), 'headerkey12');
    assert.equal(idempotencyKeyFromRequest('  ', 'fingerprint12'), 'fingerprint12');
  });

  it('scope allowlist: ingest path needs ingest:automation; propose cannot ingest; ingest cannot approve', () => {
    assert.equal(ALLOWED_AGENT_SCOPES.includes('ingest:automation'), true);
    assert.deepEqual([...DEFAULT_AGENT_SCOPES], ['propose', 'vault:read']);
    const ingest = ['ingest:automation', 'vault:read'];
    const propose = ['propose', 'vault:read'];
    assert.equal(agentScopesPermitMethod(ingest, 'POST', 'api/v1/automation/ingest'), true);
    assert.equal(agentScopesPermitMethod(propose, 'POST', 'api/v1/automation/ingest'), false);
    assert.equal(agentScopesPermitMethod(ingest, 'POST', 'api/v1/proposals/abc/approve'), false);
    assert.equal(agentScopesPermitMethod(ingest, 'GET', 'api/v1/automation/ingest-rules'), false);
    assert.equal(agentScopesPermitMethod(['vault:write'], 'POST', 'api/v1/automation/ingest'), true);
    const ceiling = applyScopeCeiling(['ingest:automation', 'vault:read'], ['vault:read']);
    assert.ok(ceiling.includes('ingest:automation'));
    assert.ok(!ceiling.includes('vault:write'));
  });

  it('pack templates exist and are disabled', () => {
    const t = listPackTemplates();
    assert.equal(t.length, 3);
    assert.ok(t.every((x) => x.enabled === false));
  });
});
