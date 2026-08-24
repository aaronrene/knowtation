/**
 * AIP-b security: agent cannot approve/CRUD; session hook isolation; elevated; no vault:write required;
 * self-apply still refuses agent_access; Scooling fingerprints unchanged.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentScopesPermitMethod,
  DEFAULT_AGENT_SCOPES,
  ALLOWED_AGENT_SCOPES,
} from '../hub/lib/agent-credential-core.mjs';
import { roleEligibleForPersonalSelfApply } from '../lib/hub-proposal-personal-self-apply.mjs';
import { filterNotesByListOptions } from '../lib/list-notes.mjs';
import { isIngestContractBody, routeAutomationIngest, normalizeRuleForSave } from '../lib/automation-ingest-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('automation ingest security', () => {
  it('ingest:automation is a known scope and is not a default mint scope', () => {
    assert.equal(ALLOWED_AGENT_SCOPES.includes('ingest:automation'), true);
    assert.equal(DEFAULT_AGENT_SCOPES.includes('ingest:automation'), false);
  });

  it('agent cannot approve or CRUD ingest-rules', () => {
    const scopes = ['ingest:automation', 'vault:read'];
    assert.equal(agentScopesPermitMethod(scopes, 'POST', 'api/v1/proposals/x/approve'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', 'api/v1/proposals/x/discard'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'GET', 'api/v1/automation/ingest-rules'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'PUT', 'api/v1/automation/ingest-rules'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', 'api/v1/automation/ingest-rules'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'DELETE', 'api/v1/automation/ingest-rules/ingr_1'), false);
  });

  it('session proposals with fingerprint are not an ingest contract unless ingest/class marker', () => {
    assert.equal(
      isIngestContractBody({ path: 'a.md', body: 'x', source_fingerprint: 'session-fp-01' }),
      false
    );
  });

  it('elevated body cannot stay direct_note', () => {
    const r = normalizeRuleForSave({
      label: 'direct',
      disposition: 'direct_note',
      match: { path_prefix: 'inbox/trends/' },
    });
    const routed = routeAutomationIngest(
      {
        path: 'inbox/trends/x.md',
        body: 'ssn 123-45-6789 classified',
        content_class: 'research',
        triggers: {
          literal_phrases: [{ match: 'classified', review_severity: 'elevated' }],
          path_prefixes: [],
          label_any: [],
        },
      },
      [r]
    );
    assert.equal(routed.disposition, 'review_queue');
    assert.equal(routed.elevated_override, true);
  });

  it('vault:write is not required for ingest route', () => {
    assert.equal(
      agentScopesPermitMethod(['ingest:automation', 'vault:read'], 'POST', '/api/v1/automation/ingest'),
      true
    );
  });

  it('roleEligibleForPersonalSelfApply still refuses agent_access', () => {
    assert.equal(roleEligibleForPersonalSelfApply('editor', { tokenType: 'agent_access' }), false);
    assert.equal(roleEligibleForPersonalSelfApply('member', { tokenType: 'agent_access' }), false);
  });

  it('content_class list filter exists (pre-AIP missing)', () => {
    const notes = [
      { path: 'a.md', content_class: 'research' },
      { path: 'b.md', frontmatter: { content_class: 'ops' } },
    ];
    const research = filterNotesByListOptions(notes, { content_class: 'research' });
    assert.equal(research.length, 1);
    assert.equal(research[0].path, 'a.md');
  });

  it('Scooling fingerprint constants unchanged (source scan)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/hub-proposal-personal-self-apply.mjs'),
      'utf8'
    );
    assert.match(src, /export const SCOOLING_REVIEW_TRAY_INTENT = 'scooling\.review_tray\.approve'/);
    assert.match(src, /tokenType \|\| ''\)\.trim\(\) === 'agent_access'\) return false/);
    assert.equal(src.includes('ingest:automation'), false);
  });

  it('Hub HTML exposes required ids', () => {
    const html = fs.readFileSync(path.join(__dirname, '../web/hub/index.html'), 'utf8');
    assert.match(html, /data-settings-tab="automation"/);
    assert.match(html, /id="settings-panel-automation"/);
    assert.match(html, /id="agent-cred-scope-ingest"/);
    assert.match(html, /id="filter-content-class"/);
    assert.equal(html.includes('checked /> ingest:automation'), false);
  });
});
