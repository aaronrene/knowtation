/**
 * SEC-KN-4c — seven-tier coverage for the T4 migration-hook identity restore.
 *
 * Frozen spec: docs/SEC-KN-4C-MIGRATION-HOOK-RESTORE-FREEZE.md (4C-R1–R9)
 *
 * After the one-time V7→`created_by` upgrade (SEC-KN-4 T1) ran on the live hub
 * canister, the actor upgrade hook must be identity on `StableStorage` so repeat
 * deploys succeed (no Compatibility error M0216). These tests pin that restore:
 * the hook shape (4C-R1), removal of the one-shot TODO marker (4C-R2), retention
 * of historical map helpers (4C-R3), the documented post-T1 invariant (4C-R4),
 * verify-script contracts (4C-R5), and the seven-tier matrix (4C-R7).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIGRATION_MO = path.join(ROOT, 'hub/icp/src/hub/Migration.mo');
const MAIN_MO = path.join(ROOT, 'hub/icp/src/hub/main.mo');
const ICP_DIR = path.join(ROOT, 'hub/icp');

const IDENTITY_HOOK_RE =
  /public func migration\(old : \{ var storage : StableStorage \}\) : \{ var storage : StableStorage \}/;

function migrationSource() {
  return fs.readFileSync(MIGRATION_MO, 'utf8');
}

/**
 * Source of the public actor hook only (it is the final declaration in the
 * module), so body-shape assertions cannot be satisfied by historical helpers.
 */
function publicMigrationHookSource(src) {
  const start = src.indexOf('public func migration(');
  assert.notEqual(start, -1, 'public migration hook not found in Migration.mo');
  return src.slice(start);
}

// ---------------------------------------------------------------------------
// Tier 1 — unit (4C-R1, 4C-R2, 4C-R3, 4C-R4)
// ---------------------------------------------------------------------------
describe('SEC-KN-4c unit — identity hook source contracts', () => {
  test('4C-R1: actor hook is identity on StableStorage; no V7 domain, no map in hook', () => {
    const src = migrationSource();
    assert.match(src, IDENTITY_HOOK_RE);
    const hook = publicMigrationHookSource(src);
    assert.doesNotMatch(hook, /StableStorageV7/);
    assert.doesNotMatch(hook, /_proposalV7ToCurrent/);
  });

  test('4C-R2: TODO(SEC-KN-4c) marker removed; locatable SEC-KN-4c comment remains', () => {
    const src = migrationSource();
    assert.doesNotMatch(src, /TODO\(SEC-KN-4c\)/);
    assert.match(src, /SEC-KN-4c/);
  });

  test('4C-R3: historical helpers and V5/V6/V7 type pins retained', () => {
    const src = migrationSource();
    assert.match(src, /func _proposalV7ToCurrent\(p : ProposalRecordV7\) : ProposalRecord/);
    assert.match(
      src,
      /func _proposalBeforeEnrichToCurrent\(p : ProposalRecordBeforeEnrich\) : ProposalRecordV7/,
    );
    assert.match(src, /func _proposalV4ToV5\(p : ProposalRecordV4\) : ProposalRecordV7/);
    assert.match(src, /public type StableStorageV5/);
    assert.match(src, /public type StableStorageV6/);
    assert.match(src, /public type StableStorageV7/);
  });

  test('4C-R4: header documents the post-T1 identity invariant', () => {
    const src = migrationSource();
    // One-time V7→created_by upgrade (T1) then identity — both facts must be stated.
    assert.match(src, /one.*V7.*`?created_by`?.*deploy|V7→`created_by` upgrade/s);
    assert.match(src, /identity/i);
    assert.match(src, /SEC-KN-4 T1/);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (Motoko compile check)
// ---------------------------------------------------------------------------
function dfxAvailable() {
  try {
    execSync('command -v dfx', { stdio: 'pipe', shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

describe('SEC-KN-4c integration — Motoko compile check', () => {
  // CI runners do not install dfx; the compile check is enforced locally and in
  // build-verification (freeze 4C-R7 integration tier). Skipping when the
  // toolchain is absent is explicit, never silent.
  test(
    'dfx build --check hub exits 0 (scrubbed env)',
    { skip: dfxAvailable() ? false : 'dfx not installed on this runner — enforced locally/BV' },
    () => {
      execSync('dfx build --check hub', {
        cwd: ICP_DIR,
        stdio: 'pipe',
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (actor wiring; no new HTTP surface)
// ---------------------------------------------------------------------------
describe('SEC-KN-4c e2e — actor still installs through Migration.migration', () => {
  test('main.mo declares (with migration = Migration.migration)', () => {
    const main = fs.readFileSync(MAIN_MO, 'utf8');
    assert.match(main, /\(with migration = Migration\.migration\)/);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress (hook is O(1); no per-row work on upgrade)
// ---------------------------------------------------------------------------
describe('SEC-KN-4c stress — identity hook is O(1)', () => {
  test('public hook body has no Array.map over proposalEntries', () => {
    const hook = publicMigrationHookSource(migrationSource());
    assert.doesNotMatch(hook, /Array\.map/);
    assert.doesNotMatch(hook, /proposalEntries/);
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity (historical map unchanged; hook does not call it)
// ---------------------------------------------------------------------------
describe('SEC-KN-4c data-integrity — historical V7 map preserved, disconnected', () => {
  test('_proposalV7ToCurrent still sets created_by = "" and is not called by the hook', () => {
    const src = migrationSource();
    const helperStart = src.indexOf('func _proposalV7ToCurrent');
    assert.notEqual(helperStart, -1);
    const helper = src.slice(helperStart, src.indexOf('};', helperStart) + 2);
    assert.match(helper, /created_by = ""/);
    const hook = publicMigrationHookSource(src);
    assert.doesNotMatch(hook, /_proposalV7ToCurrent/);
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance (verify script wall clock)
// ---------------------------------------------------------------------------
describe('SEC-KN-4c performance — verify script completes quickly', () => {
  test('canister:verify-migration exits 0 in under 2s', () => {
    const start = performance.now();
    execSync('npm run canister:verify-migration', { cwd: ROOT, stdio: 'pipe' });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `verify script took ${elapsed.toFixed(0)}ms (limit 2000ms)`);
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (no secrets; no authorship-spoof surface reintroduced)
// ---------------------------------------------------------------------------
describe('SEC-KN-4c security — no new secrets or authorship paths', () => {
  test('Migration.mo introduces no header/body authorship or secret material', () => {
    const src = migrationSource();
    assert.doesNotMatch(src, /X-User-Id/);
    // Secret fields are pass-through storage names only; no literal secret values.
    assert.doesNotMatch(src, /(operator_export_secret|gateway_auth_secret)\s*=\s*"[^"]+"/);
  });

  test('main.mo authorship stays on createdByFromRequest (SEC-KN-4 R contract intact)', () => {
    const main = fs.readFileSync(MAIN_MO, 'utf8');
    assert.match(main, /func createdByFromRequest\(req : HttpRequest\) : Text/);
    assert.doesNotMatch(main, /created_by = userId\(req\)/);
  });
});
