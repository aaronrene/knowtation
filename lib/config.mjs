/**
 * Config loader: config/local.yaml + env overrides. SPEC §4.4.
 * Env overrides apply after file. vault_path is required.
 * Multi-vault (Phase 15): when hub_vaults.yaml is absent, single vault "default" from vault_path.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { readHubVaults } from './hub-vaults.mjs';
import { getRepoRoot } from './repo-root.mjs';

const projectRoot = getRepoRoot();

const ENV_VAULT = 'KNOWTATION_VAULT_PATH';
const ENV_QDRANT = 'QDRANT_URL';
const ENV_DATA_DIR = 'KNOWTATION_DATA_DIR';
const ENV_VECTOR_STORE = 'KNOWTATION_VECTOR_STORE';
const ENV_MEMORY_URL = 'KNOWTATION_MEMORY_URL';
const ENV_AIR_ENDPOINT = 'KNOWTATION_AIR_ENDPOINT';
const ENV_OLLAMA_URL = 'OLLAMA_URL';

const DEFAULT_IGNORE = ['templates', 'meta', 'node_modules', '.git'];

/**
 * Load config from config/local.yaml (if present) then apply env overrides.
 *
 * **AIR config** (`air` key in local.yaml):
 * ```yaml
 * air:
 *   enabled: true            # master switch; default false
 *   required: true           # hard-fail: throw AttestationRequiredError when endpoint fails; default false
 *   endpoint: https://...    # attestation endpoint URL; falls back to KNOWTATION_AIR_ENDPOINT env var
 * ```
 * When `air.required=true` a write or export is rejected if the attestation endpoint is
 * unreachable or returns a non-OK response. Default (`false`) is non-blocking: a placeholder
 * id is logged and the operation proceeds (backward-compatible).
 *
 * @param {string} [cwd] - Working directory (default: project root)
 * @returns {{ vault_path: string, qdrant_url?: string, vector_store?: string, data_dir: string, embedding?: object, memory?: object, air?: { enabled: boolean, required: boolean, endpoint: string|undefined }, ignore?: string[] }} embedding.ollama_url from YAML or OLLAMA_URL env when set
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

  const embeddingYaml = config.embedding && typeof config.embedding === 'object' ? config.embedding : null;
  const embedding = {
    provider: embeddingYaml?.provider || 'ollama',
    model: embeddingYaml?.model || 'nomic-embed-text',
    ollama_url: embeddingYaml?.ollama_url,
  };
  if (process.env[ENV_OLLAMA_URL]) {
    embedding.ollama_url = process.env[ENV_OLLAMA_URL];
  }

  return {
    vault_path: resolvedVault,
    vaultList,
    resolveVaultPath,
    qdrant_url: config.qdrant_url,
    vector_store: config.vector_store || 'qdrant',
    data_dir: path.resolve(cwd, config.data_dir || 'data'),
    embedding,
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
          retention_days: config.memory.retention_days ?? null,
          capture: Array.isArray(config.memory.capture) ? config.memory.capture : undefined,
          scope: config.memory.scope === 'global' ? 'global' : 'vault',
          encrypt: config.memory.encrypt === true,
          secret: config.memory.secret || undefined,
          supabase_url: config.memory.supabase_url || process.env.KNOWTATION_SUPABASE_URL || undefined,
          supabase_key: config.memory.supabase_key || process.env.KNOWTATION_SUPABASE_KEY || undefined,
        }
      : { enabled: false, provider: 'file', url: undefined, retention_days: null, capture: undefined, scope: 'vault', encrypt: false, secret: undefined, supabase_url: undefined, supabase_key: undefined },
    air: config.air && typeof config.air === 'object'
      ? {
          enabled: config.air.enabled === true,
          required: config.air.required === true,
          endpoint: config.air.endpoint || process.env.KNOWTATION_AIR_ENDPOINT,
        }
      : { enabled: false, required: false, endpoint: undefined },
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
