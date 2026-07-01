/**
 * Phase 8 P1b-b — CLI helpers for auth subcommands (§4, §8).
 */

import readline from 'readline';
import { loadConfig } from '../../lib/config.mjs';
import {
  generateSetupToken,
  bootstrapAdminCli,
  pruneExpiredBootstrapRecord,
} from './local-auth-bootstrap.mjs';
import { issueCliLocalToken } from './local-auth.mjs';
import { readOfflineLockedAuthEnvGate, resolveOfflineLockedAuthPosture } from './local-auth-gate.mjs';

/**
 * Prompt for passphrase on TTY (muted — not echoed, §4.2).
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export function promptPassphraseTTY(prompt = 'Passphrase: ') {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Passphrase must be entered on a TTY (not piped)'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const onData = (buf) => {
      const c = buf.toString('utf8');
      for (const ch of c) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          rl.close();
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

/**
 * Resolve data dir from config.
 * @returns {string}
 */
export function resolveCliDataDir() {
  const config = loadConfig();
  return config.data_dir;
}

/**
 * Parse --expires-in for CLI token (§8.2), capped at 168h.
 * @param {string|null} raw
 * @returns {string}
 */
export function parseTokenExpiresIn(raw) {
  if (!raw) return '24h';
  const s = String(raw).trim();
  const m = s.match(/^(\d+)(m|h|d)$/i);
  if (!m) throw new Error('--expires-in must be like 24h, 7d, or 30m');
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  let hours = unit === 'd' ? n * 24 : unit === 'h' ? n : n / 60;
  if (hours > 168) throw new Error('--expires-in capped at 168h (7 days)');
  if (hours < 1 / 60) throw new Error('--expires-in too short');
  return s;
}

/**
 * @param {string[]} args - argv slice after `auth`
 * @returns {Promise<number>} exit code
 */
export async function runAuthCli(args) {
  const sub = args[0];
  const getOpt = (name) => {
    const i = args.indexOf('--' + name);
    if (i === -1) return null;
    const v = args[i + 1];
    if (v == null || v.startsWith('--')) return null;
    return v;
  };
  const shortOpt = (letter) => {
    const i = args.indexOf('-' + letter);
    if (i === -1) return null;
    const v = args[i + 1];
    if (v == null || v.startsWith('-')) return null;
    return v;
  };

  let dataDir;
  try {
    dataDir = resolveCliDataDir();
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  pruneExpiredBootstrapRecord(dataDir);
  const envGate = readOfflineLockedAuthEnvGate();
  const { active: offlineLockedActive } = resolveOfflineLockedAuthPosture(envGate);
  const sessionSecret =
    process.env.SESSION_SECRET || process.env.HUB_JWT_SECRET || 'change-me-in-production';

  if (sub === 'generate-setup-token') {
    const username = getOpt('username') || 'admin';
    const expiresIn = getOpt('expires-in') || '15m';
    try {
      const { token } = generateSetupToken(dataDir, username, expiresIn);
      process.stdout.write(token + '\n');
      return 0;
    } catch (e) {
      console.error(e.message === 'ALREADY_BOOTSTRAPPED' ? 'Already bootstrapped' : e.message);
      return 1;
    }
  }

  if (sub === 'bootstrap-admin') {
    const username = getOpt('username') || 'admin';
    try {
      const passphrase = await promptPassphraseTTY('Passphrase: ');
      const confirm = await promptPassphraseTTY('Confirm passphrase: ');
      if (passphrase !== confirm) {
        console.error('Passphrases do not match');
        return 1;
      }
      const result = await bootstrapAdminCli(dataDir, username, passphrase);
      console.log(JSON.stringify(result));
      return 0;
    } catch (e) {
      const code = e.code || e.message;
      console.error(code === 'WEAK_PASSPHRASE' ? 'Passphrase too weak' : e.message);
      return 1;
    }
  }

  if (sub === 'token') {
    const username = getOpt('username') || shortOpt('u');
    const vaultId = getOpt('vault-id') || shortOpt('v') || 'default';
    const hubUrl =
      getOpt('hub-url') ||
      process.env.KNOWTATION_HUB_URL ||
      process.env.HUB_BASE_URL ||
      'http://localhost:3333';
    let expiresIn;
    try {
      expiresIn = parseTokenExpiresIn(getOpt('expires-in'));
    } catch (e) {
      console.error(e.message);
      return 1;
    }
    if (!username) {
      console.error('auth token requires --username');
      return 1;
    }
    try {
      const passphrase = await promptPassphraseTTY('Passphrase: ');
      const result = await issueCliLocalToken(dataDir, username, passphrase, {
        sessionSecret,
        jwtExpiry: expiresIn,
        offlineLockedActive,
      });
      if (!result.ok) {
        console.error(result.code);
        return 1;
      }
      process.stdout.write(`KNOWTATION_HUB_URL=${hubUrl.replace(/\/$/, '')}\n`);
      process.stdout.write(`KNOWTATION_HUB_TOKEN=${result.token}\n`);
      process.stdout.write(`KNOWTATION_HUB_VAULT_ID=${vaultId}\n`);
      return 0;
    } catch (e) {
      console.error(e.message);
      return 1;
    }
  }

  console.error('Usage: knowtation auth <generate-setup-token|bootstrap-admin|token> [options]');
  return 1;
}
