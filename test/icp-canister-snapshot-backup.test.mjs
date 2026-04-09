import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts/icp-canister-snapshot-backup.sh');

test('icp-canister-snapshot-backup.sh: bash -n', () => {
  execFileSync('bash', ['-n', script], { stdio: 'pipe' });
});

test('icp-canister-snapshot-backup.sh: --help exits 0', () => {
  execFileSync('bash', [script, '--help'], { stdio: 'pipe' });
});
