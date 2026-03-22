/**
 * Optional vault Git sync: when vault.git.auto_commit (and optionally auto_push) is enabled,
 * run git add + commit (and push) after vault writes. Used by Hub and optionally CLI.
 * Failures are logged but do not throw — so write/approve never fail because of git.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { readConnection } from './github-connection.mjs';

/** Git exits 1 with this text when there is nothing new to commit after `git add`. */
function isBenignNoCommitOutput(text) {
  return /nothing to commit|no changes added to commit|working tree clean/i.test(text || '');
}

/** Compare two remote URLs (https vs .git, trailing slash). */
function normalizeRemoteUrl(u) {
  if (!u || typeof u !== 'string') return '';
  let s = u.trim().replace(/\/+$/, '');
  if (s.toLowerCase().endsWith('.git')) s = s.slice(0, -4);
  return s.toLowerCase();
}

/**
 * Make `origin` match Hub-configured remote. If origin already pointed elsewhere (e.g. old
 * backup repo), pushes were going to the wrong GitHub repository while the UI showed a new URL.
 */
function ensureOriginMatchesConfig(vaultPath, configuredRemote) {
  const configured = (configuredRemote || '').trim();
  if (!configured) throw new Error('vault.git.remote is empty.');
  const maxBuffer = 10 * 1024 * 1024;
  const cur = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: vaultPath,
    encoding: 'utf8',
    maxBuffer,
  });
  if (cur.status !== 0 || !cur.stdout.trim()) {
    spawnGit(['remote', 'add', 'origin', configured], vaultPath);
    return configured;
  }
  const existing = cur.stdout.trim();
  if (normalizeRemoteUrl(existing) !== normalizeRemoteUrl(configured)) {
    spawnGit(['remote', 'set-url', 'origin', configured], vaultPath);
    return configured;
  }
  return existing;
}

function spawnGit(args, cwd) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const errText = `${r.stderr || ''}\n${r.stdout || ''}`.trim();
    throw new Error(errText || `git ${args[0]} failed (exit ${r.status})`);
  }
  return r;
}

function assertGitRepo(vaultPath) {
  const gitDir = path.join(vaultPath, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(
      'Vault folder is not a Git repository (no .git). From a terminal: cd to your vault path, run `git init`, add/commit once, then use Back up now. See hub/README.md (Git backup).'
    );
  }
}

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
    if (!fs.existsSync(path.join(vaultPath, '.git'))) return;
    spawnGit(['add', '-A'], vaultPath);
    const autoMsg = 'vault auto-sync ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
    const commitR = spawnSync('git', ['commit', '-m', autoMsg], {
      cwd: vaultPath,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (commitR.status !== 0) {
      const out = `${commitR.stderr || ''}\n${commitR.stdout || ''}`;
      if (!isBenignNoCommitOutput(out)) {
        log('vault-git-sync: commit failed: ' + (out.trim() || commitR.error?.message || 'git commit'));
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
  const maxBuffer = 10 * 1024 * 1024;
  const originUrl = ensureOriginMatchesConfig(vaultPath, remoteUrl);

  const conn = dataDir ? readConnection(dataDir) : null;
  const token = conn?.access_token;
  const cleanOrigin = originUrl;
  const useAuth = Boolean(token && originUrl.startsWith('https://'));

  if (useAuth) {
    const authUrl = originUrl.replace(/^https:\/\//, 'https://x-access-token:' + token + '@');
    spawnGit(['remote', 'set-url', 'origin', authUrl], vaultPath);
  }

  try {
    // `-u origin HEAD` sets upstream on first push (plain `git push` fails with "no upstream").
    let push = spawnSync('git', ['push', '-u', 'origin', 'HEAD'], {
      cwd: vaultPath,
      encoding: 'utf8',
      maxBuffer,
    });
    if (push.status !== 0) {
      const errA = `${push.stderr || ''}\n${push.stdout || ''}`.trim();
      push = spawnSync('git', ['push'], { cwd: vaultPath, encoding: 'utf8', maxBuffer });
      if (push.status !== 0) {
        const errB = `${push.stderr || ''}\n${push.stdout || ''}`.trim();
        throw new Error(errB || errA || 'git push failed');
      }
    }

    // Detect false success: push exited 0 but nothing reachable on origin (wrong remote, etc.).
    const verify = spawnSync('git', ['ls-remote', 'origin'], {
      cwd: vaultPath,
      encoding: 'utf8',
      maxBuffer,
    });
    if (verify.status !== 0) {
      throw new Error(
        `${verify.stderr || ''}\n${verify.stdout || ''}`.trim() || 'git ls-remote origin failed after push',
      );
    }
    if (!(verify.stdout || '').trim()) {
      throw new Error(
        'Push reported success but `git ls-remote origin` returned no refs. ' +
          'Check that Settings → Backup → Git remote URL matches the GitHub repo you opened. ' +
          'In the vault folder run: git remote -v',
      );
    }
  } finally {
    if (useAuth) {
      try {
        spawnGit(['remote', 'set-url', 'origin', cleanOrigin], vaultPath);
      } catch (_) {
        /* avoid masking push error if restore fails */
      }
    }
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

  assertGitRepo(vaultPath);
  spawnGit(['add', '-A'], vaultPath);
  const msg = 'vault sync ' + new Date().toISOString().slice(0, 10);
  const commitR = spawnSync('git', ['commit', '-m', msg], {
    cwd: vaultPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  let committed = false;
  if (commitR.status === 0) {
    committed = true;
  } else {
    const commitOut = `${commitR.stderr || ''}\n${commitR.stdout || ''}`;
    if (!isBenignNoCommitOutput(commitOut)) {
      throw new Error(
        commitOut.trim() ||
          commitR.error?.message ||
          `git commit failed (exit ${commitR.status}). Configure user.name and user.email in this repo if Git asks for identity.`,
      );
    }
  }
  pushWithOptionalToken(vaultPath, vg.remote, config.data_dir);
  const sha = safeRevParse(vaultPath);
  const message = committed
    ? 'Synced'
    : 'No new changes to commit; push completed (or remote already up to date).';
  return { ok: true, committed, pushed: true, sha, message };
}

function safeRevParse(vaultPath) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: vaultPath,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim();
}
