/**
 * CLI memory subcommand integration tests.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'cli', 'index.mjs');
let tmpDir;
let vaultDir;
let dataDir;

function run(cmdArgs, opts = {}) {
  const env = {
    ...process.env,
    KNOWTATION_VAULT_PATH: vaultDir,
    KNOWTATION_DATA_DIR: dataDir,
    KNOWTATION_MEMORY_ENABLED: 'true',
    KNOWTATION_MEMORY_PROVIDER: 'file',
  };
  try {
    const out = execSync(`node ${cliPath} ${cmdArgs}`, {
      cwd: path.join(__dirname, '..'),
      env,
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: opts.stdin,
    });
    return { stdout: out.trim(), exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status };
  }
}

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-cli-mem-'));
  vaultDir = path.join(tmpDir, 'vault');
  dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'config', 'local.yaml'), `vault_path: ${vaultDir}\ndata_dir: ${dataDir}\nmemory:\n  enabled: true\n  provider: file\n`, 'utf8');
  fs.writeFileSync(path.join(vaultDir, 'test.md'), '---\ntitle: test\n---\nHello', 'utf8');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CLI memory subcommand', () => {
  it('memory --help shows actions', () => {
    const r = run('memory --help');
    assert.strictEqual(r.exitCode, 0);
    assert(r.stdout.includes('query'));
    assert(r.stdout.includes('list'));
    assert(r.stdout.includes('store'));
    assert(r.stdout.includes('stats'));
  });

  it('memory without action shows error', () => {
    const r = run('memory');
    assert.notStrictEqual(r.exitCode, 0);
  });

  it('memory query with no events returns null', () => {
    const r = run('memory query search --json');
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.value, null);
  });

  it('memory store + query round-trip', () => {
    const storeR = run('memory store my_key \'{"note":"hello"}\'');
    assert.strictEqual(storeR.exitCode, 0);
    assert(storeR.stdout.includes('Stored:'));

    const queryR = run('memory query user --json');
    assert.strictEqual(queryR.exitCode, 0);
    const data = JSON.parse(queryR.stdout);
    assert.notStrictEqual(data.value, null);
  });

  it('memory store --json outputs id', () => {
    const r = run('memory store test_key \'{"v":1}\' --json');
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    assert.match(data.id, /^mem_/);
  });

  it('memory list returns events', () => {
    run('memory store k1 \'{"x":1}\'');
    const r = run('memory list --json');
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    assert(Array.isArray(data.events));
    assert(data.count > 0);
  });

  it('memory list --type filters', () => {
    const r = run('memory list --type user --json');
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    for (const e of data.events) {
      assert.strictEqual(e.type, 'user');
    }
  });

  it('memory stats returns totals', () => {
    const r = run('memory stats --json');
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(typeof data.total, 'number');
    assert(data.total > 0);
    assert.strictEqual(typeof data.size_bytes, 'number');
  });

  it('memory stats human output', () => {
    const r = run('memory stats');
    assert.strictEqual(r.exitCode, 0);
    assert(r.stdout.includes('Total events:'));
  });

  it('memory export --format jsonl outputs JSONL', () => {
    const r = run('memory export --format jsonl');
    assert.strictEqual(r.exitCode, 0);
    const lines = r.stdout.split('\n').filter(Boolean);
    assert(lines.length > 0);
    for (const line of lines) {
      JSON.parse(line);
    }
  });

  it('memory export --format mif outputs MIF-like', () => {
    const r = run('memory export --format mif');
    assert.strictEqual(r.exitCode, 0);
    assert(r.stdout.includes('---'));
    assert(r.stdout.includes('type:'));
  });

  it('memory clear without --confirm fails', () => {
    const r = run('memory clear');
    assert.notStrictEqual(r.exitCode, 0);
  });

  it('memory clear --confirm clears events', () => {
    run('memory store clearme \'{"v":1}\'');
    const beforeR = run('memory stats --json');
    const beforeTotal = JSON.parse(beforeR.stdout).total;
    assert(beforeTotal > 0);

    const r = run('memory clear --confirm --json');
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    assert(data.cleared > 0);

    const afterR = run('memory stats --json');
    assert.strictEqual(JSON.parse(afterR.stdout).total, 0);
  });

  it('memory search fails gracefully with file provider', () => {
    const r = run('memory search test query');
    assert.notStrictEqual(r.exitCode, 0);
  });
});
