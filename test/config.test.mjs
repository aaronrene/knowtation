/**
 * Config load tests: file + env, missing vault_path, vault path validation, hub_setup merge.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const dataDir = path.join(fixturesDir, 'data');
const hubSetupPath = path.join(dataDir, 'hub_setup.yaml');

describe('loadConfig', () => {
  const envBackup = { ...process.env };

  after(() => {
    process.env.KNOWTATION_VAULT_PATH = envBackup.KNOWTATION_VAULT_PATH;
    process.env.KNOWTATION_DATA_DIR = envBackup.KNOWTATION_DATA_DIR;
    process.env.KNOWTATION_VECTOR_STORE = envBackup.KNOWTATION_VECTOR_STORE;
    process.env.OLLAMA_URL = envBackup.OLLAMA_URL;
    delete process.env.KNOWTATION_VAULT_PATH;
    delete process.env.KNOWTATION_DATA_DIR;
    delete process.env.KNOWTATION_VECTOR_STORE;
    delete process.env.OLLAMA_URL;
    delete process.env.MUSE_URL;
    if (envBackup.KNOWTATION_VAULT_PATH !== undefined) process.env.KNOWTATION_VAULT_PATH = envBackup.KNOWTATION_VAULT_PATH;
    if (envBackup.KNOWTATION_DATA_DIR !== undefined) process.env.KNOWTATION_DATA_DIR = envBackup.KNOWTATION_DATA_DIR;
    if (envBackup.KNOWTATION_VECTOR_STORE !== undefined) process.env.KNOWTATION_VECTOR_STORE = envBackup.KNOWTATION_VECTOR_STORE;
    if (envBackup.OLLAMA_URL !== undefined) process.env.OLLAMA_URL = envBackup.OLLAMA_URL;
    if (envBackup.MUSE_URL !== undefined) process.env.MUSE_URL = envBackup.MUSE_URL;
  });

  it('loads from fixture config when cwd is fixtures', () => {
    const prevVault = process.env.KNOWTATION_VAULT_PATH;
    const prevData = process.env.KNOWTATION_DATA_DIR;
    delete process.env.KNOWTATION_VAULT_PATH;
    delete process.env.KNOWTATION_DATA_DIR;
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(typeof config.vault_path, 'string');
      assert(config.vault_path.endsWith('vault-fs') || config.vault_path.includes('vault-fs'));
      assert.strictEqual(config.data_dir, path.resolve(fixturesDir, 'data'));
      assert(Array.isArray(config.ignore));
      assert(config.ignore.includes('templates'));
      assert(config.ignore.includes('meta'));
    } finally {
      if (prevVault !== undefined) process.env.KNOWTATION_VAULT_PATH = prevVault;
      else delete process.env.KNOWTATION_VAULT_PATH;
      if (prevData !== undefined) process.env.KNOWTATION_DATA_DIR = prevData;
      else delete process.env.KNOWTATION_DATA_DIR;
    }
  });

  it('throws when vault_path is missing (no file, no env)', () => {
    const emptyDir = path.join(__dirname, 'fixtures', 'config');
    const prev = process.env.KNOWTATION_VAULT_PATH;
    delete process.env.KNOWTATION_VAULT_PATH;
    try {
      assert.throws(
        () => loadConfig(emptyDir),
        /vault_path is required/
      );
    } finally {
      if (prev !== undefined) process.env.KNOWTATION_VAULT_PATH = prev;
    }
  });

  it('respects KNOWTATION_VAULT_PATH env override', () => {
    const vaultAbs = path.join(fixturesDir, 'vault-fs');
    process.env.KNOWTATION_VAULT_PATH = vaultAbs;
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.vault_path, vaultAbs);
    } finally {
      delete process.env.KNOWTATION_VAULT_PATH;
    }
  });

  it('respects KNOWTATION_VECTOR_STORE env override', () => {
    process.env.KNOWTATION_VAULT_PATH = path.join(fixturesDir, 'vault-fs');
    process.env.KNOWTATION_VECTOR_STORE = 'sqlite-vec';
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.vector_store, 'sqlite-vec');
    } finally {
      delete process.env.KNOWTATION_VAULT_PATH;
      delete process.env.KNOWTATION_VECTOR_STORE;
    }
  });

  it('sets embedding.ollama_url from OLLAMA_URL env (overrides file)', () => {
    const prevOllama = process.env.OLLAMA_URL;
    process.env.KNOWTATION_VAULT_PATH = path.join(fixturesDir, 'vault-fs');
    process.env.OLLAMA_URL = 'http://ollama.example:11434';
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.embedding.ollama_url, 'http://ollama.example:11434');
    } finally {
      delete process.env.KNOWTATION_VAULT_PATH;
      if (prevOllama !== undefined) process.env.OLLAMA_URL = prevOllama;
      else delete process.env.OLLAMA_URL;
    }
  });

  it('sets embedding.provider and default model from EMBEDDING_PROVIDER env', () => {
    const prevProv = process.env.EMBEDDING_PROVIDER;
    const prevModel = process.env.EMBEDDING_MODEL;
    process.env.KNOWTATION_VAULT_PATH = path.join(fixturesDir, 'vault-fs');
    process.env.EMBEDDING_PROVIDER = 'voyage';
    delete process.env.EMBEDDING_MODEL;
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.embedding.provider, 'voyage');
      assert.strictEqual(config.embedding.model, 'voyage-4-lite');
    } finally {
      delete process.env.KNOWTATION_VAULT_PATH;
      if (prevProv !== undefined) process.env.EMBEDDING_PROVIDER = prevProv;
      else delete process.env.EMBEDDING_PROVIDER;
      if (prevModel !== undefined) process.env.EMBEDDING_MODEL = prevModel;
      else delete process.env.EMBEDDING_MODEL;
    }
  });

  it('EMBEDDING_MODEL env overrides default for voyage provider', () => {
    const prevProv = process.env.EMBEDDING_PROVIDER;
    const prevModel = process.env.EMBEDDING_MODEL;
    process.env.KNOWTATION_VAULT_PATH = path.join(fixturesDir, 'vault-fs');
    process.env.EMBEDDING_PROVIDER = 'voyage';
    process.env.EMBEDDING_MODEL = 'voyage-3-lite';
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.embedding.provider, 'voyage');
      assert.strictEqual(config.embedding.model, 'voyage-3-lite');
    } finally {
      delete process.env.KNOWTATION_VAULT_PATH;
      if (prevProv !== undefined) process.env.EMBEDDING_PROVIDER = prevProv;
      else delete process.env.EMBEDDING_PROVIDER;
      if (prevModel !== undefined) process.env.EMBEDDING_MODEL = prevModel;
      else delete process.env.EMBEDDING_MODEL;
    }
  });

  it('merges hub_setup.yaml (vault.git) over config when present', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      hubSetupPath,
      'vault:\n  git:\n    enabled: true\n    remote: https://github.com/test/repo.git\n',
      'utf8'
    );
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.vault_git?.enabled, true);
      assert.strictEqual(config.vault_git?.remote, 'https://github.com/test/repo.git');
    } finally {
      try { fs.unlinkSync(hubSetupPath); } catch (_) {}
      try { fs.rmdirSync(dataDir); } catch (_) {}
    }
  });

  it('does not apply hub_setup vault_path when KNOWTATION_VAULT_PATH is set', () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const vaultAbs = path.join(fixturesDir, 'vault-fs');
    process.env.KNOWTATION_VAULT_PATH = vaultAbs;
    fs.writeFileSync(
      hubSetupPath,
      'vault_path: markdown-import\nvault:\n  git:\n    enabled: false\n',
      'utf8'
    );
    try {
      const config = loadConfig(fixturesDir);
      assert.strictEqual(config.vault_path, vaultAbs);
    } finally {
      delete process.env.KNOWTATION_VAULT_PATH;
      try { fs.unlinkSync(hubSetupPath); } catch (_) {}
      try { fs.rmdirSync(dataDir); } catch (_) {}
    }
  });

  it('merges muse.url from config/local.yaml when MUSE_URL env is unset', () => {
    const prevVault = process.env.KNOWTATION_VAULT_PATH;
    const prevMuse = process.env.MUSE_URL;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-muse-yaml-'));
    const cfgDir = path.join(tmp, 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    const vaultAbs = path.join(fixturesDir, 'vault-fs');
    const dataAbs = path.join(fixturesDir, 'data');
    fs.writeFileSync(
      path.join(cfgDir, 'local.yaml'),
      `vault_path: ${JSON.stringify(vaultAbs)}\ndata_dir: ${JSON.stringify(dataAbs)}\nmuse:\n  url: https://muse.from-yaml.example/\n`,
      'utf8',
    );
    delete process.env.MUSE_URL;
    delete process.env.KNOWTATION_VAULT_PATH;
    try {
      const config = loadConfig(tmp);
      assert.strictEqual(config.muse.url, 'https://muse.from-yaml.example');
    } finally {
      if (prevVault !== undefined) process.env.KNOWTATION_VAULT_PATH = prevVault;
      else delete process.env.KNOWTATION_VAULT_PATH;
      if (prevMuse !== undefined) process.env.MUSE_URL = prevMuse;
      else delete process.env.MUSE_URL;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('MUSE_URL env overrides muse.url in YAML', () => {
    const prevVault = process.env.KNOWTATION_VAULT_PATH;
    const prevMuse = process.env.MUSE_URL;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-muse-env-'));
    const cfgDir = path.join(tmp, 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    const vaultAbs = path.join(fixturesDir, 'vault-fs');
    const dataAbs = path.join(fixturesDir, 'data');
    fs.writeFileSync(
      path.join(cfgDir, 'local.yaml'),
      `vault_path: ${JSON.stringify(vaultAbs)}\ndata_dir: ${JSON.stringify(dataAbs)}\nmuse:\n  url: https://muse.from-yaml.example/\n`,
      'utf8',
    );
    process.env.MUSE_URL = 'https://muse.from-env.example/';
    delete process.env.KNOWTATION_VAULT_PATH;
    try {
      const config = loadConfig(tmp);
      assert.strictEqual(config.muse.url, 'https://muse.from-env.example');
    } finally {
      if (prevVault !== undefined) process.env.KNOWTATION_VAULT_PATH = prevVault;
      else delete process.env.KNOWTATION_VAULT_PATH;
      if (prevMuse !== undefined) process.env.MUSE_URL = prevMuse;
      else delete process.env.MUSE_URL;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
