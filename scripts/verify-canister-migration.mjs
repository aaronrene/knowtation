#!/usr/bin/env node
/**
 * Static checks that hub/icp stable-memory migration contracts are still present.
 * Fails fast if Migration.mo or main.mo drift in ways that risk an incompatible upgrade.
 *
 * Run: node scripts/verify-canister-migration.mjs
 * (Also invoked from scripts/canister-predeploy.sh)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(REPO_ROOT, 'hub/icp/src/hub/Migration.mo');
const MAIN = path.join(REPO_ROOT, 'hub/icp/src/hub/main.mo');

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8');
}

const migrationChecks = [
  {
    name: 'StableStorageV0: vaultEntries is (userId, pathMap) — pre–Phase-15.1',
    ok: (s) => s.includes('vaultEntries : [(Text, [(Text, (Text, Text))])];'),
  },
  {
    name: 'StableStorage V1: vaultEntries is (userId, vaultId, pathMap)',
    ok: (s) => s.includes('vaultEntries : [(Text, Text, [(Text, (Text, Text))])];'),
  },
  {
    name: 'StableStorage V1: billingByUser reserved (HOSTED-STORAGE-BILLING-ROADMAP)',
    ok: (s) => s.includes('billingByUser : [(Text, BillingRecord)];'),
  },
  {
    name: 'ProposalRecordV1 includes vault_id field (pre–evaluation)',
    ok: (s) => s.includes('external_ref : Text;\n    vault_id : Text;\n    created_at : Text;'),
  },
  {
    name: 'ProposalRecord (V2) includes evaluation_status',
    ok: (s) => s.includes('evaluation_status : Text;') && s.includes('evaluation_waiver_json : Text;'),
  },
  {
    name: 'migrateFromV0ToV1(old : { var storage : StableStorageV0 }) — historical V0→V1',
    ok: (s) => s.includes('migrateFromV0ToV1(old : { var storage : StableStorageV0 })'),
  },
  {
    name: 'migration(old : { var storage : StableStorageV4 }) — V5 suggested frontmatter upgrade',
    ok: (s) => s.includes('migration(old : { var storage : StableStorageV4 })'),
  },
  {
    name: 'StableStorageV4 type (pre-V5 proposals)',
    ok: (s) => s.includes('public type StableStorageV4') && s.includes('[ProposalRecordV4]'),
  },
  {
    name: 'ProposalRecord includes enrich + suggested frontmatter JSON (V5)',
    ok: (s) =>
      s.includes('assistant_notes : Text;') &&
      s.includes('suggested_labels_json : Text;') &&
      s.includes('assistant_suggested_frontmatter_json : Text;'),
  },
  {
    name: 'V0 → V1 maps notes into vault "default"',
    ok: (s) => s.includes('(entry.0, "default", entry.1)'),
  },
  {
    name: 'V0 proposals gain vault_id "default"',
    ok: (s) => s.includes('vault_id = "default"') && s.includes('v0ToProposalV1'),
  },
];

const mainChecks = [
  {
    name: 'Actor uses Migration.migration hook',
    ok: (s) => s.includes('(with migration = Migration.migration)'),
  },
  {
    name: 'persistent actor Hub',
    ok: (s) => s.includes('persistent actor Hub'),
  },
  {
    name: 'Imports Migration module',
    ok: (s) => s.includes('import Migration "Migration"'),
  },
  {
    name: 'Stable storage type matches Migration.StableStorage',
    ok: (s) => s.includes('type StableStorage = Migration.StableStorage'),
  },
];

let failed = 0;

for (const { name, ok } of migrationChecks) {
  const text = readUtf8(MIGRATION);
  if (!ok(text)) {
    console.error(`FAIL: ${name}\n  file: ${MIGRATION}`);
    failed++;
  }
}

for (const { name, ok } of mainChecks) {
  const text = readUtf8(MAIN);
  if (!ok(text)) {
    console.error(`FAIL: ${name}\n  file: ${MAIN}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\nverify-canister-migration: ${failed} check(s) failed.`);
  process.exit(1);
}

console.log('verify-canister-migration: OK (Migration.mo + main.mo contracts).');
