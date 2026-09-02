#!/usr/bin/env node
/**
 * Live Phase C smoke: opaque kt_agent_ credential → access JWT → vault:read.
 *
 * Does not print secrets. Exit 0 only on full PASS.
 *
 * Usage:
 *   KNOWTATION_HUB_AGENT_CREDENTIAL='kt_agent_…' \
 *   KNOWTATION_HUB_VAULT_ID=default \
 *     node scripts/verify-agent-credential-smoke.mjs
 *
 * Or:
 *   KNOWTATION_HUB_AGENT_CREDENTIAL_FILE=~/.config/knowtation/agent_cred \
 *     node scripts/verify-agent-credential-smoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const apiBase = (process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';

function resolveCredential() {
  let c = (process.env.KNOWTATION_HUB_AGENT_CREDENTIAL || '').trim();
  const fp = (process.env.KNOWTATION_HUB_AGENT_CREDENTIAL_FILE || '').trim();
  if (!c && fp) {
    const expanded = fp.startsWith('~')
      ? path.join(process.env.HOME || '', fp.slice(1))
      : fp;
    c = fs.readFileSync(expanded, 'utf8').trim();
  }
  return c;
}

function redactJwtClaims(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return {
      type: payload.type,
      typ: payload.typ,
      aud: payload.aud,
      scopes: payload.scopes,
      vault_ids: payload.vault_ids,
      exp_in_s: typeof payload.exp === 'number' ? payload.exp - Math.floor(Date.now() / 1000) : null,
    };
  } catch {
    return { parse: 'failed' };
  }
}

function fail(step, detail) {
  console.log(`FAIL ${step}: ${detail}`);
  process.exit(1);
}

const credential = resolveCredential();
if (!credential) {
  fail('setup', 'set KNOWTATION_HUB_AGENT_CREDENTIAL or KNOWTATION_HUB_AGENT_CREDENTIAL_FILE');
}
if (!credential.startsWith('kt_agent_')) {
  fail('setup', 'credential must start with kt_agent_');
}

console.log(`api=${apiBase}`);
console.log(`vault=${vaultId}`);
console.log(`credential_prefix=${credential.slice(0, 12)}… len=${credential.length}`);

const health = await fetch(`${apiBase}/health`);
const healthBody = await health.text();
console.log(`health status=${health.status} body=${healthBody.slice(0, 120)}`);
if (!health.ok) fail('health', `HTTP ${health.status}`);

const exch = await fetch(`${apiBase}/api/v1/auth/agent/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ credential }),
});
const exchText = await exch.text();
let exchJson;
try {
  exchJson = JSON.parse(exchText);
} catch {
  fail('exchange', `HTTP ${exch.status} non-JSON: ${exchText.slice(0, 160)}`);
}
if (!exch.ok) {
  fail('exchange', `HTTP ${exch.status} code=${exchJson.code || '?'} error=${exchJson.error || exchText.slice(0, 120)}`);
}
const access = exchJson.access_token;
if (!access || typeof access !== 'string') fail('exchange', 'missing access_token');
console.log('exchange OK', {
  token_type: exchJson.token_type,
  expires_in: exchJson.expires_in,
  scopes: exchJson.scopes,
  vault_ids: exchJson.vault_ids,
  claims: redactJwtClaims(access),
});

const headers = {
  Accept: 'application/json',
  Authorization: `Bearer ${access}`,
  'X-Vault-Id': vaultId,
};

const vaults = await fetch(`${apiBase}/api/v1/vaults`, { headers });
const vaultsText = await vaults.text();
console.log(`vaults status=${vaults.status} bytes=${vaultsText.length}`);
if (!vaults.ok) {
  fail('vaults', `HTTP ${vaults.status} ${vaultsText.slice(0, 200)}`);
}

const notes = await fetch(`${apiBase}/api/v1/notes?limit=3`, { headers });
const notesText = await notes.text();
console.log(`notes status=${notes.status} bytes=${notesText.length}`);
if (!notes.ok) {
  fail('notes', `HTTP ${notes.status} ${notesText.slice(0, 200)}`);
}

console.log('PASS agent-credential smoke (exchange + vaults + notes read)');
process.exit(0);
