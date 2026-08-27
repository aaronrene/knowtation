#!/usr/bin/env node
/**
 * RHF-b-KN0 hosted deploy proof — session + legacy_session grant mint denial.
 *
 * Uses hub-session-auth (refresh) for type:session; optional SESSION_SECRET for legacy_session.
 * Records status + JSON code only (no JWTs).
 *
 * Usage:
 *   node scripts/hub-session-refresh.mjs --save-refresh '<ktn_refresh>'   # once
 *   node scripts/verify-rhf-kn0-deploy-proof.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
  ensureHostedSessionAccessToken,
  mintLegacySessionAccessToken,
} from './lib/hub-session-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const apiBase = (process.env.KNOWTATION_HUB_API || process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';

/** @type {{ probe: string, status: number, code: string | null, pass: boolean, note?: string }[]} */
const rows = [];

/**
 * @param {string} probe
 * @param {string} accessToken
 */
async function probeGrantMint(probe, accessToken) {
  const res = await fetch(`${apiBase}/api/v1/delegation/grants`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Vault-Id': vaultId,
    },
    body: JSON.stringify({
      consent_id: 'deploy-proof-smoke',
      actor_agent_id: 'agent_deploy_proof',
      task_ref: 'kn0-deploy-proof',
    }),
    signal: AbortSignal.timeout(20_000),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  const code = typeof json.code === 'string' ? json.code : null;
  const pass = res.status === 403 && code === 'DELEGATION_HELPER_ACTOR_DENIED';
  rows.push({ probe, status: res.status, code, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${probe} HTTP ${res.status} code=${code ?? '(none)'}`);
}

const session = await ensureHostedSessionAccessToken();
if (!session.ok) {
  console.error(`session auth: ${session.code} — ${session.detail}`);
  process.exit(1);
}
await probeGrantMint('type:session', session.accessToken);

const legacy = mintLegacySessionAccessToken();
if (legacy.ok) {
  await probeGrantMint('legacy_session', legacy.accessToken);
} else {
  rows.push({
    probe: 'legacy_session',
    status: 0,
    code: null,
    pass: false,
    note: legacy.detail,
  });
  console.log(`[SKIP] legacy_session — ${legacy.code}: ${legacy.detail}`);
}

const allRequiredPass = rows.filter((r) => r.probe !== 'legacy_session' || legacy.ok).every((r) => r.pass);
const verdict = allRequiredPass ? 'PASS' : 'FINDINGS';
console.log(`\nVerdict: ${verdict}`);
process.exit(allRequiredPass ? 0 : 1);
