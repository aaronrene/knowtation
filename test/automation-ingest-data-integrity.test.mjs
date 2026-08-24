/**
 * AIP-b data-integrity: replay, conflict, pack disabled, no secrets in audit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAutomationIngest, ingestAuditDetail, listPackTemplates } from '../lib/automation-ingest-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('automation ingest data-integrity', () => {
  it('pack JSON all enabled false', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../hub/automation-ingest-rules-default.json'), 'utf8')
    );
    assert.ok(Array.isArray(raw.templates));
    assert.ok(raw.templates.every((t) => t.enabled === false));
    assert.ok(listPackTemplates().every((t) => t.enabled === false));
  });

  it('replay same key+fingerprint+path; conflict on fingerprint change', async () => {
    const store = new Map();
    const io = {
      async getIdempotency(k) { return store.get(k) || null; },
      async putIdempotency(k, e) { store.set(k, e); },
      async appendAudit() {},
      async runBilling() { return true; },
      async readExistingNote() { return null; },
      async writeNote() {},
      async createProposal() { return { proposal_id: 'prop-1' }; },
      async markProposalApproved() { return { ok: true }; },
    };
    const body = {
      path: 'inbox/trends/a.md',
      body: 'x',
      source_fingerprint: 'same-finger-01',
      content_class: 'research',
    };
    const first = await processAutomationIngest({
      rawBody: body,
      actor: { sub: 's', vaultId: 'default' },
      rules: [],
      triggers: { literal_phrases: [], path_prefixes: [], label_any: [] },
      io,
    });
    assert.equal(first.status, 201);
    const replay = await processAutomationIngest({
      rawBody: body,
      actor: { sub: 's', vaultId: 'default' },
      rules: [],
      triggers: { literal_phrases: [], path_prefixes: [], label_any: [] },
      io,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    await assert.rejects(
      () => processAutomationIngest({
        rawBody: { ...body, source_fingerprint: 'other-finger-01' },
        idempotencyHeader: 'same-finger-01',
        actor: { sub: 's', vaultId: 'default' },
        rules: [],
        triggers: { literal_phrases: [], path_prefixes: [], label_any: [] },
        io,
      }),
      (e) => e.code === 'INGEST_IDEMPOTENCY_CONFLICT'
    );
  });

  it('audit detail has no secret material', () => {
    const detail = ingestAuditDetail({
      ruleId: 'ingr_ab',
      disposition: 'review_queue',
      sourceFingerprint: 'fp',
      notePath: 'inbox/trends/a.md',
      contentClass: 'research',
      vaultId: 'Business',
      credentialId: 'cid-1',
      elevatedOverride: false,
      evaluationBlock: false,
      replayed: false,
    });
    const blob = JSON.stringify(detail);
    assert.equal(blob.includes('kt_agent_'), false);
    assert.equal(blob.includes('Bearer'), false);
    assert.ok(!('authorization' in detail));
  });
});
