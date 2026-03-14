/**
 * CLI tests: exit codes and JSON output for list-notes, get-note (with fixture vault).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');

function runCli(args, env = {}) {
  const cmd = `node cli/index.mjs ${args.join(' ')}`;
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: projectRoot,
    env: { ...process.env, KNOWTATION_VAULT_PATH: fixtureVault, ...env },
  });
}

function runCliExitCode(args, env = {}) {
  try {
    runCli(args, env);
    return 0;
  } catch (e) {
    return e.status ?? e.code ?? 1;
  }
}

describe('CLI', () => {
  describe('list-notes', () => {
    it('exits 0 with --json and outputs valid JSON with notes and total', () => {
      const out = runCli(['list-notes', '--limit', '2', '--json']);
      const data = JSON.parse(out);
      assert(Array.isArray(data.notes));
      assert(typeof data.total === 'number');
      assert(data.notes.length <= 2);
    });

    it('--count-only --json outputs only total', () => {
      const out = runCli(['list-notes', '--count-only', '--json']);
      const data = JSON.parse(out);
      assert(typeof data.total === 'number');
      assert.strictEqual(data.notes, undefined);
    });
  });

  describe('get-note', () => {
    it('exits 0 with --json and outputs path, frontmatter, body', () => {
      const out = runCli(['get-note', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      assert.strictEqual(data.path, 'inbox/one.md');
      assert(data.body && data.body.includes('Inbox one'));
      assert(typeof data.frontmatter === 'object');
    });

    it('exits non-zero for missing note', () => {
      const code = runCliExitCode(['get-note', 'inbox/nonexistent.md', '--json']);
      assert(code !== 0);
    });
  });

  describe('help', () => {
    it('--help exits 0', () => {
      const code = runCliExitCode(['--help']);
      assert.strictEqual(code, 0);
    });
  });
});
