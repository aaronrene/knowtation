#!/usr/bin/env node
/**
 * Phase 2F-b-d-kn-d — seed dev/staging media write policy (external link + attach gates).
 *
 * Writes to the configured data_dir (never production defaults):
 *   - hub_media_write_policy.json  — both gates on (link unchanged from 2F-b-d-kn-c)
 *   - hub_media_connector_policy.json — gdrive allowlisted for the target vault (admin seed)
 *
 * Usage:
 *   node scripts/seed-media-write-staging.mjs
 *   KNOWTATION_HUB_VAULT_ID=default node scripts/seed-media-write-staging.mjs
 *
 * @see docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md §16.2
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../lib/config.mjs';
import {
  MEDIA_WRITE_POLICY_FILE,
  readMediaWritePolicyFile,
  getMediaExternalLinkEnabled,
  getMediaAttachEnabled,
} from '../lib/attachments/attachment-write.mjs';
import {
  saveMediaConnectorPolicy,
  loadMediaConnectorPolicy,
  getEnabledConnector,
} from '../lib/attachments/media-connector-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';
const connectorId = process.env.MEDIA_STAGING_CONNECTOR_ID || 'gdrive';

function resolveDataDir() {
  const fromEnv = (process.env.KNOWTATION_DATA_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  const config = loadConfig(repoRoot);
  const dir = config?.data_dir || 'data/';
  return path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
}

function seedWritePolicy(dataDir) {
  const fp = path.join(dataDir, MEDIA_WRITE_POLICY_FILE);
  const payload = {
    media_external_link_enabled: true,
    media_attach_enabled: true,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return fp;
}

function seedConnectorAllowlist(dataDir, vault, connector) {
  const store = loadMediaConnectorPolicy(dataDir);
  if (!store.vaults[vault]) store.vaults[vault] = { connectors: {} };
  const now = new Date().toISOString();
  store.vaults[vault].connectors[connector] = {
    enabled: true,
    display_name: 'Google Drive (staging)',
    updated: now,
  };
  saveMediaConnectorPolicy(dataDir, store);
  return getMediaConnectorPolicyPath(dataDir);
}

function getMediaConnectorPolicyPath(dataDir) {
  return path.join(dataDir, 'hub_media_connector_policy.json');
}

function main() {
  const dataDir = resolveDataDir();
  console.log(`2F-b-d-kn-d media write staging seed — data_dir=${dataDir} vault=${vaultId}`);

  const writeFp = seedWritePolicy(dataDir);
  const connectorFp = seedConnectorAllowlist(dataDir, vaultId, connectorId);

  delete process.env.MEDIA_EXTERNAL_LINK_ENABLED;
  delete process.env.MEDIA_ATTACH_ENABLED;

  const linkOn = getMediaExternalLinkEnabled(dataDir);
  const attachOn = getMediaAttachEnabled(dataDir);
  const connectorOk = getEnabledConnector(dataDir, vaultId, connectorId) !== null;
  const policy = readMediaWritePolicyFile(dataDir);

  console.log(`  wrote ${writeFp}`);
  console.log(`  wrote ${connectorFp}`);
  console.log(`  link gate (policy file): ${linkOn ? 'ON' : 'OFF'}`);
  console.log(`  attach gate (policy file): ${attachOn ? 'ON' : 'OFF'}`);
  console.log(`  connector ${connectorId}: ${connectorOk ? 'allowlisted' : 'MISSING'}`);

  if (!linkOn || !attachOn || !connectorOk) {
    console.error('Seed verification failed — aborting.');
    process.exit(1);
  }
  if (policy.media_external_link_enabled !== true) {
    console.error('KN-MD-4 violation: external-link gate must remain on.');
    process.exit(1);
  }

  console.log('2F-b-d-kn-d staging seed PASS (link + attach gates on; external-link unchanged)');
}

main();
