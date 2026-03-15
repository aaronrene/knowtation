/**
 * Optional vault Git sync: when vault.git.auto_commit (and optionally auto_push) is enabled,
 * run git add + commit (and push) after vault writes. Used by Hub and optionally CLI.
 * Failures are logged but do not throw — so write/approve never fail because of git.
 */

import { execSync } from 'child_process';
import { readConnection } from './github-connection.mjs';

/**
 * If config has vault_git.enabled and auto_commit, run git add, commit (and push if auto_push).
 * @param {{ vault_path: string, vault_git?: { enabled?: boolean, remote?: string, auto_commit?: boolean, auto_push?: boolean } }} config - Loaded config (vault_path, vault_git)
 * @param {{ log?: (msg: string) => void }} options - log defaults to console.error
 */
export function maybeAutoSync(config, options = {}) {
  const log = options.log || ((msg) => console.error(msg));
  const vg = config.vault_git;
  if (!vg?.enabled || !vg?.auto_commit) return;

  const vaultPath = config.vault_path;
  if (!vaultPath) return;

  try {
    execSync('git add -A', { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const msg = 'vault auto-sync ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
      execSync('git commit -m ' + JSON.stringify(msg), { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      if (e.status !== 0 && !/nothing to commit|no changes/.test((e.message || '') + (e.stderr || ''))) {
        log('vault-git-sync: commit failed: ' + (e.message || e.stderr || e));
      }
      return;
    }
    if (vg.auto_push && vg.remote) {
      try {
        pushWithOptionalToken(vaultPath, vg.remote, config.data_dir);
      } catch (e) {
        log('vault-git-sync: push failed: ' + (e.message || e.stderr || e));
      }
    }
  } catch (e) {
    log('vault-git-sync: ' + (e.message || e));
  }
}

function pushWithOptionalToken(vaultPath, remoteUrl, dataDir) {
  let originUrl = remoteUrl;
  try {
    originUrl = execSync('git config --get remote.origin.url', { cwd: vaultPath, encoding: 'utf8' }).trim();
  } catch (_) {
    execSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  const conn = dataDir ? readConnection(dataDir) : null;
  const token = conn?.access_token;
  if (token && originUrl && originUrl.startsWith('https://')) {
    const authUrl = originUrl.replace(/^https:\/\//, 'https://x-access-token:' + token + '@');
    execSync('git', ['remote', 'set-url', 'origin', authUrl], { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      execSync('git push', { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
    } finally {
      execSync('git', ['remote', 'set-url', 'origin', originUrl], { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
    }
  } else {
    execSync('git push', { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

/**
 * Run full manual vault sync (add, commit, push). Used by CLI and Hub "Back up now".
 * If data_dir has a stored GitHub token (Connect GitHub), uses it for push.
 * @param {{ vault_path: string, data_dir?: string, vault_git?: { enabled?: boolean, remote?: string } }} config
 * @returns {{ ok: true, message: string }}
 * @throws Error if not configured or git fails
 */
export function runVaultSync(config) {
  const vg = config.vault_git;
  if (!vg?.enabled || !vg?.remote) {
    throw new Error('vault.git.enabled and vault.git.remote must be set in config.');
  }
  const vaultPath = config.vault_path;
  if (!vaultPath) throw new Error('vault_path is required.');

  execSync('git add -A', { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const msg = 'vault sync ' + new Date().toISOString().slice(0, 10);
    execSync('git commit -m ' + JSON.stringify(msg), { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.status !== 0 && /nothing to commit|no changes/.test((e.message || '') + (e.stderr || ''))) {
      return { ok: true, message: 'Nothing to commit' };
    }
    throw e;
  }
  pushWithOptionalToken(vaultPath, vg.remote, config.data_dir);
  return { ok: true, message: 'Synced' };
}
