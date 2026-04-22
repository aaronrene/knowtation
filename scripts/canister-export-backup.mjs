#!/usr/bin/env node
/**
 * Operator backup: canister notes + full proposals → JSON (optional AES-256-GCM, optional S3).
 * Env matches operator notes in .env.example and canister HTTP export expectations.
 *
 * @see scripts/canister-export-backup.sh (invokes this file)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  parseBackupVaultIds,
  resolveBackupS3Prefix,
  resolveCanisterBackupBaseUrl,
} from '../lib/canister-export-env.mjs';
import {
  buildOperatorVaultPayload,
  encryptOperatorBackupUtf8,
  fetchFullProposalsForOperatorExport,
  fetchNotesFromExport,
  putS3Object,
  safeVaultFileToken,
  utcBackupStamp,
} from '../lib/operator-canister-backup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const userId = (process.env.KNOWTATION_CANISTER_BACKUP_USER_ID ?? '').trim();
if (!userId) {
  console.error('ERROR: KNOWTATION_CANISTER_BACKUP_USER_ID is required.');
  process.exit(1);
}

const baseUrl = resolveCanisterBackupBaseUrl(process.env, repoRoot);
if (!baseUrl) {
  console.error('ERROR: Set KNOWTATION_CANISTER_URL or KNOWTATION_CANISTER_BACKUP_URL, or rely on canister_ids.json with BACKUP_USER_ID set.');
  process.exit(1);
}
const hadExplicitUrl =
  Boolean((process.env.KNOWTATION_CANISTER_URL ?? '').trim()) ||
  Boolean((process.env.KNOWTATION_CANISTER_BACKUP_URL ?? '').trim());
if (!hadExplicitUrl) {
  console.log('==> Defaulting KNOWTATION_CANISTER_URL from hub/icp/canister_ids.json');
  console.log(`    ${baseUrl}`);
}

const rawBackupDir = (process.env.KNOWTATION_CANISTER_BACKUP_DIR ?? 'backups').trim() || 'backups';
const backupDir = path.isAbsolute(rawBackupDir)
  ? rawBackupDir
  : path.resolve(repoRoot, rawBackupDir);
fs.mkdirSync(backupDir, { recursive: true });

const stamp = utcBackupStamp();
const vaultIds = parseBackupVaultIds(process.env);
if (vaultIds.length === 0) {
  console.error('ERROR: No vault ids to export.');
  process.exit(1);
}

const keyHex = (process.env.KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX ?? '').trim();
const s3Bucket = (process.env.KNOWTATION_CANISTER_BACKUP_S3_BUCKET ?? '').trim();
const s3Prefix = resolveBackupS3Prefix(process.env);
const skipS3 = (process.env.KNOWTATION_CANISTER_BACKUP_SKIP_S3 ?? '').trim() === '1';

for (const vaultId of vaultIds) {
  if (!vaultId) continue;
  const safe = safeVaultFileToken(vaultId);
  const baseName = `canister-export-${safe}-${stamp}`;
  console.log(`==> Export vault ${vaultId} (${baseUrl})`);

  const notes = await fetchNotesFromExport(baseUrl, userId, vaultId);
  const proposals = await fetchFullProposalsForOperatorExport(baseUrl, userId, vaultId);
  const payload = buildOperatorVaultPayload(vaultId, notes, proposals);
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

  const outPath = path.join(backupDir, outFile);
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
}

console.log(`canister-export-backup: OK (${stamp})`);
