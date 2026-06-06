/**
 * Companion App — Phase 5 OS keychain adapter.
 *
 * This module is the real custody I/O boundary for the four Phase 3 keychain accounts.
 * It exposes only `{ get, set, delete }`, rejects every unknown account, never lists the
 * store, and never falls back to plaintext files or environment variables.
 *
 * Backend choices:
 *   - macOS: a Security.framework Swift bridge, invoked with secrets over stdin so token
 *     material is not placed in process argv. The bridge stores generic-password items with
 *     kSecAttrAccessibleWhenUnlockedThisDeviceOnly.
 *   - Windows: per-user DPAPI protected blobs. The blob is encrypted by the OS user profile;
 *     LOCAL_MACHINE scope is never used.
 *   - Linux: libsecret through `secret-tool`, with the secret delivered on stdin.
 */

import { execFile as nodeExecFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { KEYCHAIN_ACCOUNTS } from './companion-token-custody.mjs';

const execFileAsync = promisify(nodeExecFile);

export const KEYCHAIN_SERVICE = 'knowtation.companion';
export const KEYCHAIN_MAX_SECRET_LEN = 8192;
export const KEYCHAIN_ALLOWED_ACCOUNTS = Object.freeze(Object.values(KEYCHAIN_ACCOUNTS));

export const KEYCHAIN_ADAPTER_REASONS = Object.freeze({
  UNKNOWN_ACCOUNT: 'unknown_account',
  INVALID_SECRET: 'invalid_secret',
  BACKEND_UNAVAILABLE: 'backend_unavailable',
});

const MACOS_SWIFT_BRIDGE = String.raw`
import Foundation
import Security

struct Request: Decodable {
  let op: String
  let service: String
  let account: String
  let secret: String?
}

func fail(_ code: String) -> Never {
  FileHandle.standardError.write(Data((code + "\n").utf8))
  exit(1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let req = try? JSONDecoder().decode(Request.self, from: input) else { fail("backend_unavailable") }
let serviceData = Data(req.service.utf8)
let accountData = Data(req.account.utf8)

var query: [String: Any] = [
  kSecClass as String: kSecClassGenericPassword,
  kSecAttrService as String: req.service,
  kSecAttrAccount as String: req.account
]

if req.op == "get" {
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  if status == errSecItemNotFound { exit(0) }
  guard status == errSecSuccess, let data = item as? Data, let text = String(data: data, encoding: .utf8) else {
    fail("backend_unavailable")
  }
  FileHandle.standardOutput.write(Data(text.utf8))
  exit(0)
}

if req.op == "set" {
  guard let secret = req.secret else { fail("invalid_secret") }
  let secretData = Data(secret.utf8)
  SecItemDelete(query as CFDictionary)
  query[kSecValueData as String] = secretData
  query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  let status = SecItemAdd(query as CFDictionary, nil)
  guard status == errSecSuccess else { fail("backend_unavailable") }
  exit(0)
}

if req.op == "delete" {
  let status = SecItemDelete(query as CFDictionary)
  guard status == errSecSuccess || status == errSecItemNotFound else { fail("backend_unavailable") }
  exit(0)
}

fail("backend_unavailable")
`;

/**
 * Validate that callers only address the four Phase 3 custody accounts.
 * @param {unknown} account
 * @returns {string}
 */
export function requireKnownKeychainAccount(account) {
  if (typeof account !== 'string' || !KEYCHAIN_ALLOWED_ACCOUNTS.includes(account)) {
    throw new TypeError(KEYCHAIN_ADAPTER_REASONS.UNKNOWN_ACCOUNT);
  }
  return account;
}

/**
 * Validate secret shape before handing it to an OS backend.
 * @param {unknown} secret
 * @returns {string}
 */
export function requireKeychainSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > KEYCHAIN_MAX_SECRET_LEN) {
    throw new TypeError(KEYCHAIN_ADAPTER_REASONS.INVALID_SECRET);
  }
  return secret;
}

/**
 * Create the narrow keychain adapter used by `createTokenCustody`.
 * @param {{ platform?: string, execFile?: Function, baseDir?: string }} [opts]
 * @returns {{ get: Function, set: Function, delete: Function }}
 */
export function createCompanionKeychainAdapter(opts = {}) {
  const backend = selectKeychainBackend(opts);
  return {
    async get(account) {
      return backend.get(requireKnownKeychainAccount(account));
    },
    async set(account, secret) {
      return backend.set(requireKnownKeychainAccount(account), requireKeychainSecret(secret));
    },
    async delete(account) {
      return backend.delete(requireKnownKeychainAccount(account));
    },
  };
}

/**
 * Select the platform backend. Unknown platforms fail closed.
 * @param {{ platform?: string, execFile?: Function, baseDir?: string }} [opts]
 * @returns {{ get: Function, set: Function, delete: Function }}
 */
export function selectKeychainBackend(opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') return createMacOSKeychainBackend(opts);
  if (platform === 'win32') return createWindowsDpapiBackend(opts);
  if (platform === 'linux') return createLinuxSecretServiceBackend(opts);
  throw new Error(KEYCHAIN_ADAPTER_REASONS.BACKEND_UNAVAILABLE);
}

/**
 * macOS Keychain backend through a Swift Security.framework bridge.
 * @param {{ execFile?: Function }} [opts]
 */
export function createMacOSKeychainBackend(opts = {}) {
  const execFile = opts.execFile ?? execFileAsync;
  async function run(op, account, secret) {
    try {
      const input = JSON.stringify({ op, service: KEYCHAIN_SERVICE, account, secret });
      const result = await execFile('/usr/bin/swift', ['-e', MACOS_SWIFT_BRIDGE], {
        input,
        encoding: 'utf8',
        maxBuffer: KEYCHAIN_MAX_SECRET_LEN + 4096,
      });
      return typeof result === 'string' ? result : result.stdout;
    } catch {
      throw new Error(KEYCHAIN_ADAPTER_REASONS.BACKEND_UNAVAILABLE);
    }
  }
  return {
    async get(account) {
      const value = await run('get', account, null);
      return value === '' ? null : value;
    },
    async set(account, secret) {
      await run('set', account, secret);
    },
    async delete(account) {
      await run('delete', account, null);
    },
  };
}

/**
 * Windows per-user DPAPI backend. The persisted bytes are DPAPI ciphertext only.
 * @param {{ baseDir?: string }} [opts]
 */
export function createWindowsDpapiBackend(opts = {}) {
  const execFile = opts.execFile ?? execFileAsync;
  const baseDir = opts.baseDir ?? path.join(os.homedir(), 'AppData', 'Local', 'Knowtation', 'Companion', 'dpapi');
  const accountFile = (account) => path.join(baseDir, Buffer.from(account, 'utf8').toString('base64url'));
  async function dpapiProtect(secret) {
    const script = [
      'Add-Type -AssemblyName System.Security;',
      '$i=[Console]::In.ReadToEnd();',
      '$b=[Text.Encoding]::UTF8.GetBytes($i);',
      '$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
      '[Console]::Out.Write([Convert]::ToBase64String($p));',
    ].join('');
    const result = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: secret,
      encoding: 'utf8',
      maxBuffer: KEYCHAIN_MAX_SECRET_LEN + 4096,
    });
    return typeof result === 'string' ? result : result.stdout;
  }
  async function dpapiUnprotect(encoded) {
    const script = [
      'Add-Type -AssemblyName System.Security;',
      '$i=[Console]::In.ReadToEnd();',
      '$p=[Convert]::FromBase64String($i);',
      '$b=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
      '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b));',
    ].join('');
    const result = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: encoded,
      encoding: 'utf8',
      maxBuffer: KEYCHAIN_MAX_SECRET_LEN + 4096,
    });
    return typeof result === 'string' ? result : result.stdout;
  }
  return {
    async get(account) {
      try {
        const encoded = await readFile(accountFile(account), 'utf8');
        return await dpapiUnprotect(encoded);
      } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw new Error(KEYCHAIN_ADAPTER_REASONS.BACKEND_UNAVAILABLE);
      }
    },
    async set(account, secret) {
      try {
        await mkdir(baseDir, { recursive: true, mode: 0o700 });
        await writeFile(accountFile(account), await dpapiProtect(secret), { mode: 0o600 });
      } catch {
        throw new Error(KEYCHAIN_ADAPTER_REASONS.BACKEND_UNAVAILABLE);
      }
    },
    async delete(account) {
      await rm(accountFile(account), { force: true });
    },
  };
}

/**
 * Linux Secret Service backend through `secret-tool`.
 * @param {{ execFile?: Function }} [opts]
 */
export function createLinuxSecretServiceBackend(opts = {}) {
  const execFile = opts.execFile ?? execFileAsync;
  async function run(args, input) {
    try {
      const result = await execFile('/usr/bin/secret-tool', args, {
        input,
        encoding: 'utf8',
        maxBuffer: KEYCHAIN_MAX_SECRET_LEN + 4096,
      });
      return typeof result === 'string' ? result : result.stdout;
    } catch (err) {
      if (err && err.code === 1) return '';
      throw new Error(KEYCHAIN_ADAPTER_REASONS.BACKEND_UNAVAILABLE);
    }
  }
  return {
    async get(account) {
      const value = await run(['lookup', 'service', KEYCHAIN_SERVICE, 'account', account], undefined);
      return value === '' ? null : value.replace(/\n$/, '');
    },
    async set(account, secret) {
      await run(['store', '--label', KEYCHAIN_SERVICE, 'service', KEYCHAIN_SERVICE, 'account', account], secret);
    },
    async delete(account) {
      await run(['clear', 'service', KEYCHAIN_SERVICE, 'account', account], undefined);
    },
  };
}
