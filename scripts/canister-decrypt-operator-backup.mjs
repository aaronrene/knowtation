#!/usr/bin/env node
/**
 * Decrypt a .json.enc operator backup to stdout or a file.
 * Usage: KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX=... node scripts/canister-decrypt-operator-backup.mjs <file.json.enc> [out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { decryptOperatorBackupToUtf8 } from '../lib/operator-canister-backup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const keyHex = (process.env.KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX ?? '').trim();
if (!keyHex) {
  console.error('ERROR: KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX is required.');
  process.exit(1);
}
const encPath = process.argv[2];
if (!encPath || !fs.existsSync(encPath)) {
  console.error('Usage: node scripts/canister-decrypt-operator-backup.mjs <file.json.enc> [out.json]');
  process.exit(1);
}
const outPath = process.argv[3];
const buf = fs.readFileSync(encPath);
const utf8 = decryptOperatorBackupToUtf8(buf, keyHex);
if (outPath) {
  fs.writeFileSync(outPath, utf8, 'utf8');
  console.error(`Wrote ${outPath} (${utf8.length} chars)`);
} else {
  process.stdout.write(utf8);
}
