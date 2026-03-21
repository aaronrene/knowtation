/**
 * Config loader: config/local.yaml + env overrides. SPEC §4.4.
 * Env overrides apply after file. vault_path is required.
 * Multi-vault (Phase 15): when hub_vaults.yaml is absent, single vault "default" from vault_path.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { readHubVaults } from './hub-vaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const ENV_VAULT = 'KNOWTATION_VAULT_PATH';
const ENV_QDRANT = 'QDRANT_URL';
const ENV_DATA_DIR = 'KNOWTATION_DATA_DIR';
const ENV_VECTOR_STORE = 'KNOWTATION_VECTOR_STORE';
const ENV_MEMORY_URL = 'KNOWTATION_MEMORY_URL';
const ENV_AIR_ENDPOINT = 'KNOWTATION_AIR_ENDPOINT';

const DEFAULT_IGNORE = ['templates', 'meta', 'node_modules', '.git'];

/**
 * Load config from config/local.yaml (if present) then apply env overrides.
 * @param {string} [cwd] - Working directory (default: project root)
 * @returns {{ vault_path: string, qdrant_url?: string, vector_store?: string, data_dir: string, embedding?: object, memory?: object, air?: object, ignore?: string[] }}
 * @throws if vault_path is missing after load
 */
export function loadConfig(cwd = projectRoot) {
  const configPath = path.join(cwd, 'config', 'local.yaml');
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = yaml.load(raw) || {};
    } catch (e) {
      throw new Error(`Invalid config at ${configPath}: ${e.message}`);
    }
  }

  // Env overrides (SPEC: env overrides, then config)
  if (process.env[ENV_VAULT]) config.vault_path = process.env[ENV_VAULT];
  if (process.env[ENV_QDRANT]) config.qdrant_url = process.env[ENV_QDRANT];
  if (process.env[ENV_DATA_DIR]) config.data_dir = process.env[ENV_DATA_DIR];
  if (process.env[ENV_VECTOR_STORE]) config.vector_store = process.env[ENV_VECTOR_STORE];
  if (process.env[ENV_MEMORY_URL]) config.memory = { ...(config.memory || {}), url: process.env[ENV_MEMORY_URL] };
  if (process.env[ENV_AIR_ENDPOINT]) config.air = { ...config.air, endpoint: process.env[ENV_AIR_ENDPOINT] };

  // Hub Setup overrides (optional): data_dir/hub_setup.yaml can set vault_path and vault.git
  const dataDirPath = path.resolve(cwd, config.data_dir || 'data');
  const hubSetupPath = path.join(dataDirPath, 'hub_setup.yaml');
  if (fs.existsSync(hubSetupPath)) {
    try {
      const setupRaw = fs.readFileSync(hubSetupPath, 'utf8');
      const setup = yaml.load(setupRaw) || {};
      // Hub writes vault_path here; operator/tests use KNOWTATION_VAULT_PATH — that must win (SPEC: env overrides).
      if (setup.vault_path != null && !process.env[ENV_VAULT]) {
        config.vault_path = setup.vault_path;
      }
      if (setup.vault?.git && typeof setup.vault.git === 'object') {
        config.vault = config.vault || {};
        config.vault.git = { ...(config.vault.git || {}), ...setup.vault.git };
      }
    } catch (_) { /* ignore invalid hub_setup */ }
  }

  const vaultPath = config.vault_path;
  if (!vaultPath || typeof vaultPath !== 'string') {
    throw new Error('vault_path is required. Set in config/local.yaml or env KNOWTATION_VAULT_PATH.');
  }

  const resolvedVault = path.isAbsolute(vaultPath) ? vaultPath : path.resolve(cwd, vaultPath);
  if (!fs.existsSync(resolvedVault) || !fs.statSync(resolvedVault).isDirectory()) {
    throw new Error(`Vault path does not exist or is not a directory: ${resolvedVault}`);
  }

  let vaultList = readHubVaults(dataDirPath, cwd);
  if (vaultList.length === 0) {
    vaultList = [{ id: 'default', path: resolvedVault, label: undefined }];
  }

  /**
   * Resolve vault id to absolute path. Returns undefined if vault id not in list.
   * @param {string} vaultId
   * @returns {string | undefined}
   */
  function resolveVaultPath(vaultId) {
    const v = vaultList.find((e) => e.id === vaultId);
    return v ? v.path : undefined;
  }

  return {
    vault_path: resolvedVault,
    vaultList,
    resolveVaultPath,
    qdrant_url: config.qdrant_url,
    vector_store: config.vector_store || 'qdrant',
    data_dir: path.resolve(cwd, config.data_dir || 'data'),
    embedding: config.embedding && typeof config.embedding === 'object'
      ? {
          provider: config.embedding.provider || 'ollama',
          model: config.embedding.model || 'nomic-embed-text',
          ollama_url: config.embedding.ollama_url,
        }
      : { provider: 'ollama', model: 'nomic-embed-text' },
    indexer: config.indexer && typeof config.indexer === 'object'
      ? {
          chunk_size: config.indexer.chunk_size ?? 2048,
          chunk_overlap: config.indexer.chunk_overlap ?? 256,
        }
      : { chunk_size: 2048, chunk_overlap: 256 },
    transcription: config.transcription && typeof config.transcription === 'object'
      ? {
          provider: config.transcription.provider || 'openai',
          model: config.transcription.model || 'whisper-1',
        }
      : { provider: 'openai', model: 'whisper-1' },
    memory: config.memory && typeof config.memory === 'object'
      ? {
          enabled: config.memory.enabled === true,
          provider: config.memory.provider || 'file',
          url: config.memory.url || process.env.KNOWTATION_MEMORY_URL,
        }
      : { enabled: false, provider: 'file', url: undefined },
    air: config.air && typeof config.air === 'object'
      ? { enabled: config.air.enabled === true, endpoint: config.air.endpoint || process.env.KNOWTATION_AIR_ENDPOINT }
      : { enabled: false, endpoint: undefined },
    vault_git: config.vault?.git && typeof config.vault.git === 'object'
      ? {
          enabled: config.vault.git.enabled === true,
          remote: config.vault.git.remote || undefined,
          auto_commit: config.vault.git.auto_commit === true,
          auto_push: config.vault.git.auto_push === true,
        }
      : { enabled: false, remote: undefined, auto_commit: false, auto_push: false },
    mcp: (() => {
      const mcpRaw = config.mcp && typeof config.mcp === 'object' ? config.mcp : {};
      const envPort = process.env.KNOWTATION_MCP_HTTP_PORT;
      const http_port =
        envPort != null && String(envPort).trim() !== ''
          ? parseInt(String(envPort), 10) || 3334
          : mcpRaw.http_port ?? 3334;
      const http_host = mcpRaw.http_host || '127.0.0.1';
      return { http_port, http_host };
    })(),
    ignore: config.ignore || DEFAULT_IGNORE,
  };
}
