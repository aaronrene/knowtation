/**
 * MCP Phase G — scope hints for clients: initialize `instructions` + optional client roots logging.
 * MCP "roots" are normally declared by the client; we document server filesystem scope in `instructions`.
 */

import { pathToFileURL } from 'node:url';
import { loadConfig } from '../lib/config.mjs';

/**
 * @param {string} absPath
 * @returns {string}
 */
export function fileUriForPath(absPath) {
  return pathToFileURL(absPath).href;
}

/**
 * @param {{ vault_path: string, data_dir: string, vaultList?: Array<{ id: string, path: string, label?: string }> }} config
 * @returns {string}
 */
export function buildKnowtationMcpInstructions(config) {
  const vaultUri = fileUriForPath(config.vault_path);
  const dataUri = fileUriForPath(config.data_dir);
  const lines = [
    'Knowtation is a personal knowledge assistant: it searches, reads, and writes Markdown notes in your vault, keeps a search index under your data directory, and exposes the same operations through MCP tools and resources as the CLI.',
    'The server reads and writes only the configured vault paths and index data below—not arbitrary paths on your machine unless a tool is given an explicit vault-relative path inside that vault.',
    '',
    'Authoritative filesystem scope (add these as MCP client workspace roots when your client supports roots, so the model knows what this server is tied to):',
    `- Vault (notes, media): ${vaultUri}`,
    `- Data directory (index, sidecars): ${dataUri}`,
  ];
  if (config.vaultList && config.vaultList.length > 1) {
    lines.push('', 'Configured vaults (multi-vault):');
    for (const v of config.vaultList) {
      const label = v.label || v.id;
      lines.push(`- ${label} (${v.id}): ${fileUriForPath(v.path)}`);
    }
  }
  return lines.join('\n');
}

/**
 * @returns {string}
 */
export function tryBuildKnowtationMcpInstructions() {
  try {
    return buildKnowtationMcpInstructions(loadConfig());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return [
      'Knowtation MCP needs a valid vault before it can describe scope.',
      'Set vault_path in config/local.yaml or KNOWTATION_VAULT_PATH, then restart the server.',
      `Current error: ${msg}`,
    ].join('\n');
  }
}
