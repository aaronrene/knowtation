#!/usr/bin/env node
/**
 * Operator full logical backup: all user ids (paginated index) + per-user notes and proposals.
 * Requires hub canister with operator secret set: `admin_set_operator_export_secret` (controllers).
 *
 * Env:
 *   KNOWTATION_OPERATOR_EXPORT_URL — hub base URL, no trailing slash (or KNOWTATION_CANISTER_URL / KNOWTATION_CANISTER_BACKUP_URL)
 *   KNOWTATION_OPERATOR_EXPORT_KEY — must match canister stable secret (same value sent as X-Operator-Export-Key)
 *   KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX — optional; if set, writes .json.enc
 *   KNOWTATION_CANISTER_BACKUP_S3_BUCKET, AWS_*, KNOWTATION_CANISTER_BACKUP_S3_PREFIX — optional S3
 *   KNOWTATION_CANISTER_BACKUP_SKIP_S3=1 — skip S3
 *   KNOWTATION_OPERATOR_EXPORT_DIR — output directory (default backups)
 *
 * @see docs/OPERATOR-BACKUP.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { resolveBackupS3Prefix, resolveCanisterBackupBaseUrl } from '../lib/canister-export-env.mjs';
import {
  buildFullOperatorExportJson,
  encryptOperatorBackupUtf8,
  putS3Object,
  utcBackupStamp,
} from '../lib/operator-full-export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const operatorKey = (process.env.KNOWTATION_OPERATOR_EXPORT_KEY ?? '').trim();
if (!operatorKey) {
  console.error('ERROR: KNOWTATION_OPERATOR_EXPORT_KEY is required.');
  process.exit(1);
}

const explicitUrl =
  (process.env.KNOWTATION_OPERATOR_EXPORT_URL ?? '').trim() ||
  (process.env.KNOWTATION_CANISTER_URL ?? '').trim() ||
  (process.env.KNOWTATION_CANISTER_BACKUP_URL ?? '').trim();
const baseUrl = explicitUrl
  ? explicitUrl.replace(/\/$/, '')
  : resolveCanisterBackupBaseUrl({ ...process.env, KNOWTATION_CANISTER_BACKUP_USER_ID: 'x' }, repoRoot);
if (!baseUrl) {
  console.error(
    'ERROR: Set KNOWTATION_OPERATOR_EXPORT_URL (or KNOWTATION_CANISTER_URL / KNOWTATION_CANISTER_BACKUP_URL), or hub/icp/canister_ids.json for default hub URL.',
  );
  process.exit(1);
}

const rawDir = (process.env.KNOWTATION_OPERATOR_EXPORT_DIR ?? process.env.KNOWTATION_CANISTER_BACKUP_DIR ?? 'backups')
  .trim() || 'backups';
const outDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(repoRoot, rawDir);
fs.mkdirSync(outDir, { recursive: true });

const keyHex = (process.env.KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX ?? '').trim();
if (keyHex) {
  const k = Buffer.from(keyHex, 'hex');
  if (k.length !== 32) {
    console.error(
      'ERROR: KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX must be exactly 64 hex characters (32-byte AES key).',
      `Decoded length is ${k.length} bytes (hex string length ${keyHex.length}).`,
      'Generate with: openssl rand -hex 32',
    );
    process.exit(1);
  }
}

const s3Bucket = (process.env.KNOWTATION_CANISTER_BACKUP_S3_BUCKET ?? '').trim();
const s3Prefix = resolveBackupS3Prefix(process.env);
const skipS3 = (process.env.KNOWTATION_CANISTER_BACKUP_SKIP_S3 ?? '').trim() === '1';

const stamp = utcBackupStamp();
const baseName = `operator-full-export-${stamp}`;

async function run() {
  const urlSource = explicitUrl
    ? 'KNOWTATION_OPERATOR_EXPORT_URL or CANISTER_* URL env'
    : 'hub/icp/canister_ids.json (raw.icp0.io)';
  console.log(`==> Full operator export — hub ${baseUrl} (from ${urlSource})`);
  console.log(`==> Output directory: ${outDir}`);

  const payload = await buildFullOperatorExportJson(baseUrl, operatorKey, console.log);
  const json = JSON.stringify(payload);

  let outBuf;
  let outFile;
  if (keyHex) {
    outBuf = encryptOperatorBackupUtf8(json, keyHex);
    outFile = `${baseName}.json.enc`;
    console.log(`    Encrypted ${json.length} bytes JSON → ${outBuf.length} bytes (${outFile})`);
  } else {
    outBuf = Buffer.from(json, 'utf8');
    outFile = `${baseName}.json`;
    console.log(`    Wrote ${outBuf.length} bytes (${outFile})`);
  }

  const outPath = path.join(outDir, outFile);
  fs.writeFileSync(outPath, outBuf);

  if (s3Bucket && !skipS3) {
    const key = `${s3Prefix}${outFile}`;
    console.log(`    S3: s3://${s3Bucket}/${key}`);
    await putS3Object({
      bucket: s3Bucket,
      key,
      body: outBuf,
      region: process.env.AWS_REGION,
    });
  }

  console.log(`canister-operator-full-export: OK (${outPath})`);
}

try {
  await run();
} catch (err) {
  const msg = err && typeof err.message === 'string' ? err.message : String(err);
  console.error('canister-operator-full-export: FAILED');
  console.error(msg);
  if (err && err.stack) console.error(err.stack);
  if (/^export \d+/.test(msg) || /^proposals list \d+/.test(msg) || /^proposal .+ \d+/.test(msg)) {
    console.error(
      'Hint: Per-user GET /api/v1/export and /api/v1/proposals failed. Confirm hub base URL uses https://<canister-id>.raw.icp0.io (not .icp0.io without raw).',
    );
  }
  if (msg.includes('operator user index')) {
    console.error(
      'Hint: For 401, KNOWTATION_OPERATOR_EXPORT_KEY must match admin_set_operator_export_secret exactly.',
    );
  }
  if (/S3|AWS|credentials|AccessDenied|PutObject/i.test(msg)) {
    console.error(
      'Hint: S3 upload failed. Check AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, bucket name, and IAM policy (s3:PutObject on prefix/*). Or set KNOWTATION_CANISTER_BACKUP_SKIP_S3=1 to skip S3.',
    );
  }
  process.exit(1);
}
