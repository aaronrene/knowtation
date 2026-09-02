#!/usr/bin/env node
/**
 * Live capture flywheel smoke (9-apply / 9-kn-c re-run driver).
 *
 * Exchanges the durable kt_agent_ credential for an access JWT, then drives the
 * hosted capture path: POST observe (fresh candidate) → GET candidates (blob
 * persistence check) → POST propose (canister proposal for the operator to
 * approve in the Hub tray). Never prints secrets. Exit 0 only on full PASS.
 *
 * Content-minimized session meta only (ids / hashes / counts — no raw content),
 * matching the FLOW-CAPTURE-FLYWHEEL contract.
 *
 * Usage:
 *   KNOWTATION_HUB_AGENT_CREDENTIAL_FILE=~/.config/knowtation/agent_cred \
 *     node scripts/verify-capture-flywheel-live-smoke.mjs
 *
 * Optional env:
 *   KNOWTATION_HUB_URL      (default https://api.knowtation.store)
 *   KNOWTATION_HUB_VAULT_ID (default: first vault_id from the token exchange)
 *   SMOKE_FORCE_NEW_FLOW=1  (bypass structural-overlap dedup with force_new_flow
 *                            when a prior smoke Flow already exists)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const apiBase = (process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');

function resolveCredential() {
  let c = (process.env.KNOWTATION_HUB_AGENT_CREDENTIAL || '').trim();
  const fp = (process.env.KNOWTATION_HUB_AGENT_CREDENTIAL_FILE || '').trim();
  if (!c && fp) {
    const expanded = fp.startsWith('~') ? path.join(process.env.HOME || '', fp.slice(1)) : fp;
    c = fs.readFileSync(expanded, 'utf8').trim();
  }
  return c;
}

function fail(step, detail) {
  console.log(`FAIL ${step}: ${detail}`);
  process.exit(1);
}

async function jfetch(step, url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { step, res, json, text };
}

const credential = resolveCredential();
if (!credential) fail('setup', 'set KNOWTATION_HUB_AGENT_CREDENTIAL or _FILE');
if (!credential.startsWith('kt_agent_')) fail('setup', 'credential must start with kt_agent_');

console.log(`api=${apiBase}`);

// 1. Exchange credential → access JWT.
const exch = await jfetch('exchange', `${apiBase}/api/v1/auth/agent/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ credential }),
});
if (!exch.res.ok) fail('exchange', `HTTP ${exch.res.status} ${exch.json.code || ''} ${exch.json.error || ''}`);
const access = exch.json.access_token;
if (!access) fail('exchange', 'missing access_token');
const vaultId =
  process.env.KNOWTATION_HUB_VAULT_ID ||
  (Array.isArray(exch.json.vault_ids) ? exch.json.vault_ids[0] : '') ||
  'default';
console.log(`exchange OK scopes=${JSON.stringify(exch.json.scopes)} vault=${vaultId}`);

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Bearer ${access}`,
  'X-Vault-Id': vaultId,
};

// 2. Fresh observe — content-minimized meta with enough repetition to detect.
const sessionId = crypto.randomBytes(32).toString('hex');
const observe = await jfetch('observe', `${apiBase}/api/v1/flows/capture/observe`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    session_id: sessionId,
    step_sequence_refs: ['flow_weekly_review#1', 'flow_weekly_review#2'],
    skill_ref_ids: ['mcp_prompt:daily-brief'],
    observed_counts: { repetition: 4, repeated_correction: 1 },
    signal_hints: ['repetition'],
    harness: 'overseer-live-smoke',
  }),
});
if (!observe.res.ok) fail('observe', `HTTP ${observe.res.status} ${observe.json.code || ''} ${observe.json.error || ''}`);
if (observe.json.detection_authorized !== true) {
  fail('observe', `detection_authorized=${observe.json.detection_authorized} (FLOW_CAPTURE_DETECTION_ENABLED off hosted-side?)`);
}
const candidate = (observe.json.candidates || [])[0];
if (!candidate) fail('observe', 'no candidate returned');
console.log(`observe OK candidate_id=${candidate.candidate_id} confidence=${candidate.confidence}`);

// 3. Candidates list — with the blob-persistence fix the candidate must be
// visible regardless of which lambda instance serves this read.
const list = await jfetch('candidates', `${apiBase}/api/v1/flows/candidates?limit=50`, { headers });
if (!list.res.ok) fail('candidates', `HTTP ${list.res.status} ${list.json.code || ''}`);
const seen = (list.json.candidates || []).some((c) => c.candidate_id === candidate.candidate_id);
if (!seen) fail('candidates', `candidate ${candidate.candidate_id} not in list — blob persistence NOT live`);
console.log(`candidates OK (${(list.json.candidates || []).length} listed, new candidate present)`);

// 4. Propose — creates the canister proposal for the operator's Hub-tray approve.
const propose = await jfetch(
  'propose',
  `${apiBase}/api/v1/flows/candidates/${encodeURIComponent(candidate.candidate_id)}/propose`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({
      confirmed_scope: 'personal',
      intent: 'Promote captured weekly-review procedure to a saved Flow (9-apply re-run)',
      ...(process.env.SMOKE_FORCE_NEW_FLOW === '1' ? { force_new_flow: true } : {}),
    }),
  },
);
if (!propose.res.ok) fail('propose', `HTTP ${propose.res.status} ${propose.json.code || ''} ${propose.json.error || ''}`);
console.log(`propose OK proposal_id=${propose.json.proposal_id}`);

console.log('');
console.log('PASS capture flywheel live smoke (exchange + observe + candidates + propose)');
console.log(`NEXT: operator approves ${propose.json.proposal_id} in the Hub tray (https://knowtation.store/hub)`);
process.exit(0);
