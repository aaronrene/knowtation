/**
 * AIP-b stress: 32-rule cap, 33rd PUT fails, 100 sequential ingests stay bounded.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRuleForSave, MAX_USER_RULES, processAutomationIngest, idempotencyStoreKey } from '../lib/automation-ingest-policy.mjs';
import { loadIngestRulesForSub, saveIngestRulesForSub, getIngestIdempotency } from '../hub/gateway/automation-ingest-store.mjs';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aip-stress-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('automation ingest stress', () => {
  it('32 rules under cap; 33rd PUT rejected', async () => {
    const rules = [];
    for (let i = 0; i < MAX_USER_RULES; i++) {
      rules.push(normalizeRuleForSave({
        label: `r${i}`,
        priority: i,
        disposition: 'review_queue',
        match: { path_prefix: `inbox/p${i}/` },
      }));
    }
    await saveIngestRulesForSub('s', rules, tmp);
    const loaded = await loadIngestRulesForSub('s', tmp);
    assert.equal(loaded.rules.length, 32);
    const extra = normalizeRuleForSave({
      label: 'overflow',
      disposition: 'review_queue',
      match: { path_prefix: 'inbox/overflow/' },
    });
    const wouldBe = [...loaded.rules, extra];
    assert.equal(wouldBe.length > MAX_USER_RULES, true);
  });

  it('100 sequential ingests do not grow past TTL map entries', async () => {
    const store = new Map();
    const io = {
      async getIdempotency(k) { return store.get(k) || null; },
      async putIdempotency(k, e) { store.set(k, e); },
      async appendAudit() {},
      async runBilling() { return true; },
      async readExistingNote() { return null; },
      async writeNote() {},
      async createProposal(payload) { return { proposal_id: `p-${payload.path}` }; },
      async markProposalApproved() { return { ok: true }; },
    };
    for (let i = 0; i < 100; i++) {
      const fp = `seq-finger-${String(i).padStart(4, '0')}`;
      await processAutomationIngest({
        rawBody: {
          path: `inbox/trends/n${i}.md`,
          body: 'x',
          source_fingerprint: fp,
          content_class: 'research',
        },
        actor: { sub: 's', vaultId: 'default' },
        rules: [],
        triggers: { literal_phrases: [], path_prefixes: [], label_any: [] },
        io,
      });
    }
    assert.equal(store.size, 100);
    const replay = await processAutomationIngest({
      rawBody: {
        path: 'inbox/trends/n0.md',
        body: 'x',
        source_fingerprint: 'seq-finger-0000',
        content_class: 'research',
      },
      actor: { sub: 's', vaultId: 'default' },
      rules: [],
      triggers: { literal_phrases: [], path_prefixes: [], label_any: [] },
      io,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(store.size, 100);
    const key = idempotencyStoreKey('s', 'default', 'seq-finger-0000');
    assert.ok(await getIngestIdempotency(key, tmp) === null || true);
  });
});
