#!/usr/bin/env node
/**
 * knowtation doctor — self-hosted vault + optional Hub API checks.
 * Token story: see docs/TOKEN-SAVINGS.md (vault retrieval vs terminal tooling).
 */

import fs from 'fs';
import path from 'path';
import { loadConfig } from '../lib/config.mjs';

/**
 * @param {{ useJson: boolean, hubUrlOpt: string | null }} opts
 * @returns {Promise<number>} exit code (0 ok, 1 config/vault failure, 2 hub unreachable or auth failure)
 */
export async function runDoctor(opts) {
  const { useJson, hubUrlOpt } = opts;
  /** @type {{ id: string, status: 'ok' | 'warn' | 'error', message: string, detail?: string }[]} */
  const checks = [];

  const tokenLayers = {
    vault_retrieval:
      'Vault retrieval (MCP/CLI search, snippets, limits) is the primary in-product token saver — see docs/TOKEN-SAVINGS.md.',
    terminal_tooling:
      'Shrinking shell or terminal logs is optional on your coding host; Knowtation hosted canisters do not run shell hooks for log compaction.',
  };

  let selfHosted = {
    config_loaded: false,
    vault_path: null,
    vault_exists: false,
    vault_readable: false,
    memory_enabled: null,
  };

  try {
    const config = loadConfig();
    selfHosted = {
      config_loaded: true,
      vault_path: config.vault_path,
      vault_exists: fs.existsSync(config.vault_path),
      vault_readable: false,
      memory_enabled: Boolean(config.memory?.enabled),
    };
    if (selfHosted.vault_exists) {
      try {
        fs.accessSync(config.vault_path, fs.constants.R_OK);
        selfHosted.vault_readable = true;
        checks.push({
          id: 'vault_path',
          status: 'ok',
          message: 'Vault path exists and is readable.',
          detail: config.vault_path,
        });
      } catch (e) {
        checks.push({
          id: 'vault_path',
          status: 'error',
          message: 'Vault path exists but is not readable.',
          detail: (e && e.message) || String(e),
        });
      }
    } else {
      checks.push({
        id: 'vault_path',
        status: 'error',
        message: 'Configured vault path does not exist on disk.',
        detail: config.vault_path,
      });
    }
  } catch (e) {
    checks.push({
      id: 'config',
      status: 'error',
      message: 'Failed to load config (config/local.yaml + env).',
      detail: e.message || String(e),
    });
  }

  const hubUrlRaw = hubUrlOpt || process.env.KNOWTATION_HUB_URL;
  const hubToken = process.env.KNOWTATION_HUB_TOKEN;
  const hubVaultId = process.env.KNOWTATION_HUB_VAULT_ID;

  const hubApi = {
    KNOWTATION_HUB_URL: hubUrlRaw || null,
    KNOWTATION_HUB_TOKEN_set: Boolean(hubToken),
    KNOWTATION_HUB_VAULT_ID: hubVaultId || null,
    health_ok: null,
    notes_probe_status: null,
  };

  if (hubUrlRaw) {
    const base = hubUrlRaw.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/health`, { method: 'GET' });
      hubApi.health_ok = res.ok;
      if (res.ok) {
        checks.push({ id: 'hub_health', status: 'ok', message: `Hub health OK at ${base}.` });
      } else {
        checks.push({
          id: 'hub_health',
          status: 'error',
          message: `Hub health returned HTTP ${res.status}.`,
          detail: base,
        });
      }
    } catch (e) {
      hubApi.health_ok = false;
      checks.push({
        id: 'hub_health',
        status: 'error',
        message: 'Hub health request failed (network or DNS).',
        detail: e.message || String(e),
      });
    }

    if (hubToken && hubVaultId) {
      try {
        const res = await fetch(`${base}/api/v1/notes?limit=1`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${hubToken}`,
            'X-Vault-Id': hubVaultId,
            Accept: 'application/json',
          },
        });
        hubApi.notes_probe_status = res.status;
        if (res.ok) {
          checks.push({
            id: 'hub_auth_notes',
            status: 'ok',
            message: 'Hub API notes probe succeeded (token + vault id accepted).',
          });
        } else if (res.status === 401 || res.status === 403) {
          checks.push({
            id: 'hub_auth_notes',
            status: 'error',
            message: `Hub API returned ${res.status} — token may be expired or vault id invalid.`,
          });
        } else {
          checks.push({
            id: 'hub_auth_notes',
            status: 'warn',
            message: `Hub API notes probe returned HTTP ${res.status}.`,
          });
        }
      } catch (e) {
        hubApi.notes_probe_status = 'error';
        checks.push({
          id: 'hub_auth_notes',
          status: 'error',
          message: 'Hub API notes probe failed.',
          detail: e.message || String(e),
        });
      }
    } else if (hubToken || hubVaultId) {
      checks.push({
        id: 'hub_auth_notes',
        status: 'warn',
        message: 'Set both KNOWTATION_HUB_TOKEN and KNOWTATION_HUB_VAULT_ID to probe authenticated Hub API.',
      });
    }
  } else {
    checks.push({
      id: 'hub_health',
      status: 'ok',
      message: 'KNOWTATION_HUB_URL not set — skipping hosted Hub checks (normal for pure self-hosted).',
    });
  }

  const hasWarn = checks.some((c) => c.status === 'warn');
  const ok = !checks.some((c) => c.status === 'error');

  if (useJson) {
    console.log(
      JSON.stringify(
        {
          ok,
          token_layers: tokenLayers,
          self_hosted: selfHosted,
          hub_api: hubApi,
          checks,
        },
        null,
        2
      )
    );
  } else {
    console.log('Knowtation doctor');
    console.log('');
    console.log('Token layers (see docs/TOKEN-SAVINGS.md):');
    console.log(`  Vault / retrieval: ${tokenLayers.vault_retrieval}`);
    console.log(`  Terminal tooling:  ${tokenLayers.terminal_tooling}`);
    console.log('');
    console.log('Self-hosted (CLI / local MCP):');
    if (selfHosted.config_loaded) {
      console.log(`  vault_path: ${selfHosted.vault_path}`);
      console.log(`  exists: ${selfHosted.vault_exists}  readable: ${selfHosted.vault_readable}`);
      console.log(`  memory.enabled: ${selfHosted.memory_enabled}`);
    } else {
      console.log('  (config not loaded — fix errors above)');
    }
    console.log('');
    console.log('Hosted Hub API (optional):');
    if (hubUrlRaw) {
      console.log(`  KNOWTATION_HUB_URL: ${hubUrlRaw}`);
      console.log(`  health: ${hubApi.health_ok === true ? 'ok' : hubApi.health_ok === false ? 'failed' : 'n/a'}`);
      console.log(
        `  token + vault set: ${hubApi.KNOWTATION_HUB_TOKEN_set && hubApi.KNOWTATION_HUB_VAULT_ID ? 'yes' : 'no'}`
      );
      if (hubApi.notes_probe_status != null) {
        console.log(`  GET /api/v1/notes?limit=1 status: ${hubApi.notes_probe_status}`);
      }
    } else {
      console.log('  KNOWTATION_HUB_URL not set — skipped.');
    }
    console.log('');
    for (const c of checks) {
      const tag = c.status.toUpperCase();
      console.log(`[${tag}] ${c.id}: ${c.message}`);
      if (c.detail) console.log(`       ${c.detail}`);
    }
    if (hasWarn && ok) console.log('\nWarnings present — review above.');
  }

  if (!selfHosted.config_loaded || !selfHosted.vault_exists || !selfHosted.vault_readable) {
    return 1;
  }
  for (const c of checks) {
    if (c.status !== 'error') continue;
    if (c.id === 'hub_health' || c.id === 'hub_auth_notes') return 2;
  }
  return 0;
}
