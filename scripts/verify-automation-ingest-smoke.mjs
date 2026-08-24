#!/usr/bin/env node
/**
 * Local/test default smoke for AIP ingest.
 * Does not print credentials or JWTs. Production URL is Operator T2 — this script
 * must not be cited as production smoke.
 *
 * Usage:
 *   KNOWTATION_HUB_URL=http://127.0.0.1:3340 \
 *   KNOWTATION_HUB_SESSION_JWT=… \
 *     node scripts/verify-automation-ingest-smoke.mjs
 */

const apiBase = (process.env.KNOWTATION_HUB_URL || 'http://127.0.0.1:3340').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';

function fail(step, detail) {
  console.log(`FAIL ${step}: ${detail}`);
  process.exit(1);
}

function redact(value) {
  const s = String(value || '');
  if (!s) return '(empty)';
  return `${s.slice(0, 8)}… len=${s.length}`;
}

const session = (process.env.KNOWTATION_HUB_SESSION_JWT || '').trim();
const agentJwt = (process.env.KNOWTATION_HUB_AGENT_ACCESS_JWT || '').trim();
if (session) console.log(`session=${redact(session)}`);
if (agentJwt) console.log(`agent_access=${redact(agentJwt)}`);
if (session.toLowerCase().includes('kt_agent_') || agentJwt.toLowerCase().includes('kt_agent_')) {
  fail('setup', 'refusing to continue: do not pass opaque kt_agent_ credentials on the command line of this script');
}

console.log(`api=${apiBase} (local/test default; not a production-smoke claim)`);
console.log(`vault=${vaultId}`);

const health = await fetch(`${apiBase}/health`);
console.log(`health status=${health.status}`);
if (!health.ok) fail('health', `HTTP ${health.status}`);

if (!session && !agentJwt) {
  console.log('PASS health-only (no session/agent JWT supplied; CRUD/ingest skipped)');
  process.exit(0);
}

if (session) {
  const rules = await fetch(`${apiBase}/api/v1/automation/ingest-rules`, {
    headers: { Authorization: `Bearer ${session}`, Accept: 'application/json' },
  });
  const text = await rules.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { parse: 'failed' }; }
  console.log(`ingest-rules status=${rules.status} code=${json.code || 'ok'} templates=${Array.isArray(json.templates) ? json.templates.length : 0}`);
  if (rules.status !== 200) fail('ingest-rules', `HTTP ${rules.status} code=${json.code || ''}`);
  const enabledPack = Array.isArray(json.templates) && json.templates.some((t) => t && t.enabled === true);
  if (enabledPack) fail('pack', 'packaged templates must stay disabled');
}

if (agentJwt) {
  const ingest = await fetch(`${apiBase}/api/v1/automation/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentJwt}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Vault-Id': vaultId,
    },
    body: JSON.stringify({
      path: 'inbox/trends/smoke-local.md',
      body: 'local smoke',
      source_fingerprint: 'local-smoke-01',
      content_class: 'research',
    }),
  });
  const text = await ingest.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { parse: 'failed' }; }
  console.log(`ingest status=${ingest.status} code=${json.code || 'ok'} disposition=${json.disposition || ''}`);
  if (ingest.status !== 200 && ingest.status !== 201) {
    fail('ingest', `HTTP ${ingest.status} code=${json.code || ''}`);
  }
}

console.log('PASS local/test ingest smoke');
