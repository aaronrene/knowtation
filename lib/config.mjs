/**
 * Config loader: config/local.yaml + env overrides. SPEC §4.4.
 * Env overrides apply after file. vault_path is required.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const ENV_VAULT = 'KNOWTATION_VAULT_PATH';
const ENV_QDRANT = 'QDRANT_URL';
const ENV_DATA_DIR = 'KNOWTATION_DATA_DIR';
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
  if (process.env[ENV_MEMORY_URL]) config.memory = { ...config.memory, url: process.env[ENV_MEMORY_URL] };
  if (process.env[ENV_AIR_ENDPOINT]) config.air = { ...config.air, endpoint: process.env[ENV_AIR_ENDPOINT] };

  const vaultPath = config.vault_path;
  if (!vaultPath || typeof vaultPath !== 'string') {
    throw new Error('vault_path is required. Set in config/local.yaml or env KNOWTATION_VAULT_PATH.');
  }

  const resolvedVault = path.isAbsolute(vaultPath) ? vaultPath : path.resolve(cwd, vaultPath);
  if (!fs.existsSync(resolvedVault) || !fs.statSync(resolvedVault).isDirectory()) {
    throw new Error(`Vault path does not exist or is not a directory: ${resolvedVault}`);
  }

  return {
    vault_path: resolvedVault,
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
    memory: config.memory,
    air: config.air,
    ignore: config.ignore || DEFAULT_IGNORE,
  };
}
