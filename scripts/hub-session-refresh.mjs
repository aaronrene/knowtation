#!/usr/bin/env node
/**
 * Refresh hosted Hub human session JWT (operator laptop only).
 *
 * One-time bootstrap — copy hub_token from Application → Local Storage, then:
 *   node scripts/hub-session-refresh.mjs --save-access-token '<jwt>'
 * Exchanges the access JWT for a durable refresh token via POST /api/v1/auth/establish-refresh
 * (requires gateway deploy with establish-refresh route).
 *
 * Routine use (auto-rotates refresh token, caches access JWT):
 *   node scripts/hub-session-refresh.mjs
 *
 * Optional env:
 *   KNOWTATION_HUB_API=https://api.knowtation.store
 *   KNOWTATION_HUB_REFRESH_TOKEN_FILE=~/.config/knowtation/hub_refresh
 *   KNOWTATION_HUB_TOKEN_FILE=~/.config/knowtation/hub_session
 *
 * Does not print JWTs unless --print-token (local operator only).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
  DEFAULT_REFRESH_FILE,
  DEFAULT_SESSION_FILE,
  decodeAccessClaims,
  ensureHostedSessionAccessToken,
  establishHostedRefreshFromAccess,
  expandHome,
  refreshHostedSessionAccessToken,
  writeSecretFile,
} from './lib/hub-session-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function usage() {
  console.log(`Usage:
  node scripts/hub-session-refresh.mjs [--force]
  node scripts/hub-session-refresh.mjs --save-refresh '<ktn_refresh value>'
  node scripts/hub-session-refresh.mjs --save-access-token '<hub_token JWT from Local Storage>'
  node scripts/hub-session-refresh.mjs --status
  node scripts/hub-session-refresh.mjs --print-token   # local only; never commit output

Stores:
  refresh → ${DEFAULT_REFRESH_FILE}
  access  → ${DEFAULT_SESSION_FILE}
`);
}

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(0);
}

if (args[0] === '--save-refresh') {
  const token = (args[1] || '').trim();
  if (!token || token.includes(' ')) {
    console.error('Provide the ktn_refresh cookie value: --save-refresh \'<id>.<secret>\'');
    process.exit(2);
  }
  const refreshFile = expandHome(process.env.KNOWTATION_HUB_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_FILE);
  writeSecretFile(refreshFile, token);
  console.log(`saved refresh token → ${refreshFile}`);
  const result = await refreshHostedSessionAccessToken();
  if (!result.ok) {
    console.error(`refresh failed: ${result.code} — ${result.detail}`);
    process.exit(1);
  }
  console.log(`access token cached (${result.claims.type ?? 'session'}, exp in ${result.claims.expiresInSec}s)`);
  process.exit(0);
}

if (args[0] === '--save-access-token') {
  const access = (args[1] || '').trim();
  if (!access || access.split('.').length !== 3) {
    console.error('Paste hub_token from DevTools → Application → Local Storage → hub_token');
    process.exit(2);
  }
  const claims = decodeAccessClaims(access);
  if (claims.expired) {
    console.error('hub_token is expired — sign in again and copy a fresh token');
    process.exit(2);
  }
  const established = await establishHostedRefreshFromAccess(access);
  if (!established.ok) {
    console.error(`establish-refresh failed: ${established.code} — ${established.detail}`);
    process.exit(1);
  }
  const refreshFile = expandHome(process.env.KNOWTATION_HUB_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_FILE);
  const sessionFile = expandHome(process.env.KNOWTATION_HUB_TOKEN_FILE || DEFAULT_SESSION_FILE);
  console.log(`saved refresh token → ${refreshFile}`);
  console.log(`saved access JWT → ${sessionFile} (type=${claims.type ?? 'session'}, exp_in_s=${claims.expiresInSec})`);
  console.log('auto-refresh enabled — run: node scripts/hub-session-refresh.mjs');
  process.exit(0);
}

if (args.includes('--status')) {
  const fs = await import('node:fs');
  const sessionFile = expandHome(process.env.KNOWTATION_HUB_TOKEN_FILE || DEFAULT_SESSION_FILE);
  const refreshFile = expandHome(process.env.KNOWTATION_HUB_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_FILE);
  const envTok = (process.env.KNOWTATION_HUB_TOKEN || '').trim();
  console.log(JSON.stringify({
    refresh_file: refreshFile,
    refresh_present: fs.existsSync(refreshFile),
    session_file: sessionFile,
    session_present: fs.existsSync(sessionFile),
    env_token_present: Boolean(envTok),
    env_token: envTok ? decodeAccessClaims(envTok) : null,
    session_file_claims: fs.existsSync(sessionFile)
      ? decodeAccessClaims(fs.readFileSync(sessionFile, 'utf8').trim())
      : null,
  }, null, 2));
  process.exit(0);
}

const force = args.includes('--force');
const result = await ensureHostedSessionAccessToken({ forceRefresh: force });
if (!result.ok) {
  console.error(`FAIL ${result.code}: ${result.detail}`);
  process.exit(1);
}

const claims = decodeAccessClaims(result.accessToken);
console.log(`OK source=${result.source} refreshed=${result.refreshed} type=${claims.type ?? 'session'} exp_in_s=${claims.expiresInSec}`);

if (args.includes('--print-token')) {
  console.log(result.accessToken);
}
