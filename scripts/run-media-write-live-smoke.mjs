#!/usr/bin/env node
/**
 * Operator helper — mint a dev Hub JWT and run verify-media-write-smoke.mjs --live-propose.
 * Avoids passing tokens on the shell command line.
 *
 * Prerequisites: HUB_JWT_SECRET in .env; self-hosted Hub running; seed-media-write-staging.mjs run.
 *
 * Usage:
 *   HUB_PORT=3456 node scripts/run-media-write-live-smoke.mjs
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const secret = process.env.HUB_JWT_SECRET;
if (!secret) {
  console.error('HUB_JWT_SECRET required in .env');
  process.exit(1);
}

const port = process.env.HUB_PORT || '3333';
const token = jwt.sign(
  {
    sub: 'google:smoke-admin',
    name: 'Smoke Admin',
    role: 'admin',
  },
  secret,
  { expiresIn: '1h' },
);

const env = {
  ...process.env,
  KNOWTATION_HUB_API: `http://localhost:${port}`,
  KNOWTATION_HUB_TOKEN: token,
  KNOWTATION_HUB_VAULT_ID: process.env.KNOWTATION_HUB_VAULT_ID || 'default',
};

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'verify-media-write-smoke.mjs'), '--live-propose'],
  { env, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
