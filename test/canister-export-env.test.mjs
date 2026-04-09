import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  hubBaseUrlFromCanisterIds,
  parseBackupVaultIds,
  resolveBackupS3Prefix,
  resolveCanisterBackupBaseUrl,
} from '../lib/canister-export-env.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

describe('hubBaseUrlFromCanisterIds', () => {
  it('reads hub.ic from canister_ids.json in this repo', () => {
    const ids = JSON.parse(readFileSync(join(repoRoot, 'hub/icp/canister_ids.json'), 'utf8'));
    const url = hubBaseUrlFromCanisterIds(repoRoot);
    assert.match(url, /^https:\/\/.+\.raw\.icp0\.io$/);
    assert.strictEqual(url, `https://${ids.hub.ic}.raw.icp0.io`);
  });

  it('throws when hub.ic is missing', () => {
    const dir = join(tmpdir(), `knowt-ce-${Date.now()}`);
    mkdirSync(join(dir, 'hub/icp'), { recursive: true });
    writeFileSync(join(dir, 'hub/icp/canister_ids.json'), JSON.stringify({ hub: {} }));
    try {
      assert.throws(() => hubBaseUrlFromCanisterIds(dir), /Missing hub\.ic/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveBackupS3Prefix', () => {
  it('defaults when unset or empty (GitHub empty var)', () => {
    assert.strictEqual(resolveBackupS3Prefix({}), 'knowtation-canister-backups/');
    assert.strictEqual(resolveBackupS3Prefix({ KNOWTATION_CANISTER_BACKUP_S3_PREFIX: '' }), 'knowtation-canister-backups/');
    assert.strictEqual(resolveBackupS3Prefix({ KNOWTATION_CANISTER_BACKUP_S3_PREFIX: '  ' }), 'knowtation-canister-backups/');
  });

  it('normalizes custom prefix to single trailing slash', () => {
    assert.strictEqual(resolveBackupS3Prefix({ KNOWTATION_CANISTER_BACKUP_S3_PREFIX: 'my/prefix' }), 'my/prefix/');
    assert.strictEqual(resolveBackupS3Prefix({ KNOWTATION_CANISTER_BACKUP_S3_PREFIX: 'my/prefix//' }), 'my/prefix/');
  });
});

describe('parseBackupVaultIds', () => {
  it('defaults to default vault', () => {
    assert.deepStrictEqual(parseBackupVaultIds({}), ['default']);
  });

  it('uses KNOWTATION_CANISTER_BACKUP_VAULT_ID when VAULT_IDS unset', () => {
    assert.deepStrictEqual(parseBackupVaultIds({ KNOWTATION_CANISTER_BACKUP_VAULT_ID: 'team' }), [
      'team',
    ]);
  });

  it('splits KNOWTATION_CANISTER_BACKUP_VAULT_IDS on commas', () => {
    assert.deepStrictEqual(
      parseBackupVaultIds({ KNOWTATION_CANISTER_BACKUP_VAULT_IDS: ' default , second ' }),
      ['default', 'second'],
    );
  });

  it('VAULT_IDS wins over single VAULT_ID', () => {
    assert.deepStrictEqual(
      parseBackupVaultIds({
        KNOWTATION_CANISTER_BACKUP_VAULT_IDS: 'a,b',
        KNOWTATION_CANISTER_BACKUP_VAULT_ID: 'ignored',
      }),
      ['a', 'b'],
    );
  });
});

describe('resolveCanisterBackupBaseUrl', () => {
  it('prefers KNOWTATION_CANISTER_URL', () => {
    const u = resolveCanisterBackupBaseUrl(
      {
        KNOWTATION_CANISTER_URL: 'https://abc.icp0.io/',
        KNOWTATION_CANISTER_BACKUP_URL: 'https://wrong.icp0.io',
        KNOWTATION_CANISTER_BACKUP_USER_ID: 'x',
      },
      repoRoot,
    );
    assert.strictEqual(u, 'https://abc.icp0.io');
  });

  it('uses KNOWTATION_CANISTER_BACKUP_URL when CANISTER_URL unset', () => {
    const u = resolveCanisterBackupBaseUrl(
      {
        KNOWTATION_CANISTER_BACKUP_URL: 'https://xyz.icp0.io/',
        KNOWTATION_CANISTER_BACKUP_USER_ID: 'x',
      },
      repoRoot,
    );
    assert.strictEqual(u, 'https://xyz.icp0.io');
  });

  it('defaults from canister_ids when user id set and no URL', () => {
    const ids = JSON.parse(readFileSync(join(repoRoot, 'hub/icp/canister_ids.json'), 'utf8'));
    const u = resolveCanisterBackupBaseUrl(
      { KNOWTATION_CANISTER_BACKUP_USER_ID: 'google:1' },
      repoRoot,
    );
    assert.strictEqual(u, `https://${ids.hub.ic}.raw.icp0.io`);
  });
});

describe('canister-export-backup.sh', () => {
  it('parses with bash -n', async () => {
    const { spawnSync } = await import('node:child_process');
    const sh = join(repoRoot, 'scripts/canister-export-backup.sh');
    const r = spawnSync('bash', ['-n', sh], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  });
});
