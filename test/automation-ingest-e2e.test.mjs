/**
 * AIP-b e2e: HTTP session CRUD + agent ingest → 201 envelope.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import {
  processAutomationIngest,
  sendIngestError,
  normalizeRuleForSave,
  MAX_USER_RULES,
  listPackTemplates,
} from '../lib/automation-ingest-policy.mjs';
import {
  loadIngestRulesForSub,
  saveIngestRulesForSub,
  getIngestIdempotency,
  putIngestIdempotency,
} from '../hub/gateway/automation-ingest-store.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { writeNote } from '../lib/write.mjs';
import { readNote } from '../lib/vault.mjs';
import { loadReviewTriggers } from '../lib/hub-proposal-review-triggers.mjs';
import { agentScopesPermitMethod } from '../hub/lib/agent-credential-core.mjs';
import { effectiveRequestPath } from '../hub/gateway/request-path.mjs';

const SECRET = 'aip-e2e-secret-value-32-bytes-ok!!';
let tmp;
let vault;
let server;
let base;

function sessionToken() {
  return jwt.sign({ sub: 'github:e2e', type: 'session', role: 'editor' }, SECRET, { expiresIn: '1h' });
}

function agentToken(scopes) {
  return jwt.sign(
    {
      sub: 'github:e2e',
      type: 'agent_access',
      typ: 'kt_agent_access',
      aud: 'knowtation-hub-rest',
      scopes,
      vault_ids: ['default'],
      cid: 'cid-e2e',
      agent: 'videofactory-trend-agent',
    },
    SECRET,
    { expiresIn: '15m' }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'no', code: 'UNAUTHORIZED' });
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'bad', code: 'UNAUTHORIZED' });
  }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aip-e2e-'));
  vault = path.join(tmp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.vault_id = String(req.headers['x-vault-id'] || 'default');
    next();
  });

  app.get('/api/v1/automation/ingest-rules', auth, async (req, res) => {
    if (req.user.type !== 'session') return res.status(401).json({ error: 'no', code: 'UNAUTHORIZED' });
    const loaded = await loadIngestRulesForSub(req.user.sub, tmp);
    res.json(loaded);
  });
  app.put('/api/v1/automation/ingest-rules', auth, async (req, res) => {
    if (req.user.type !== 'session') return res.status(401).json({ error: 'no', code: 'UNAUTHORIZED' });
    const list = Array.isArray(req.body.rules) ? req.body.rules : [];
    if (list.length > MAX_USER_RULES) return res.status(400).json({ error: 'max 32 rules', code: 'BAD_REQUEST' });
    const rules = list.map((row) => normalizeRuleForSave(row));
    await saveIngestRulesForSub(req.user.sub, rules, tmp);
    res.json({ rules, templates: listPackTemplates() });
  });
  app.post('/api/v1/automation/ingest', auth, async (req, res) => {
    if (req.user.type === 'agent_access') {
      if (!agentScopesPermitMethod(req.user.scopes, req.method, effectiveRequestPath(req))) {
        return res.status(401).json({ error: 'no', code: 'UNAUTHORIZED' });
      }
    }
    try {
      const loaded = await loadIngestRulesForSub(req.user.sub, tmp);
      const out = await processAutomationIngest({
        rawBody: req.body,
        idempotencyHeader: req.headers['x-ingest-idempotency-key'],
        actor: {
          sub: req.user.sub,
          vaultId: req.vault_id,
          credentialId: req.user.cid || null,
          credentialName: req.user.agent || null,
          evaluationRequired: false,
          sessionBound: req.user.type === 'session',
        },
        rules: loaded.rules,
        triggers: loadReviewTriggers(tmp),
        io: {
          getIdempotency: (k) => getIngestIdempotency(k, tmp),
          putIdempotency: (k, e) => putIngestIdempotency(k, e, tmp),
          appendAudit: async () => {},
          runBilling: async () => true,
          readExistingNote: async (p) => {
            try { return readNote(vault, p); } catch { return null; }
          },
          writeNote: async (p, payload) => writeNote(vault, p, payload),
          createProposal: async (payload) => createProposal(tmp, payload),
          markProposalApproved: async () => ({ ok: true }),
        },
      });
      res.status(out.status).json(out.body);
    } catch (e) {
      sendIngestError(res, e);
    }
  });

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('automation ingest e2e', () => {
  it('session CRUD + agent ingest 201', async () => {
    const session = sessionToken();
    const put = await fetch(`${base}/api/v1/automation/ingest-rules`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [
          {
            label: 'e2e review',
            disposition: 'review_queue',
            enabled: true,
            match: { credential_name: 'videofactory-trend-agent', path_prefix: 'inbox/trends/' },
            content_class: 'research',
          },
        ],
      }),
    });
    assert.equal(put.status, 200);
    const listed = await (await fetch(`${base}/api/v1/automation/ingest-rules`, {
      headers: { Authorization: `Bearer ${session}` },
    })).json();
    assert.equal(listed.rules.length, 1);

    const agent = agentToken(['ingest:automation', 'vault:read']);
    const ingest = await fetch(`${base}/api/v1/automation/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agent}`,
        'Content-Type': 'application/json',
        'X-Vault-Id': 'default',
      },
      body: JSON.stringify({
        path: 'inbox/trends/e2e.md',
        body: 'trend',
        source_fingerprint: 'e2e-finger-01',
        content_class: 'research',
      }),
    });
    assert.equal(ingest.status, 201);
    const env = await ingest.json();
    assert.equal(env.outcome, 'proposal');
    assert.equal(env.replayed, false);
    assert.ok(env.proposal_id);
  });
});
