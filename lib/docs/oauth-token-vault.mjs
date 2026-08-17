/**
 * Encrypted refresh-token vault for document connectors.
 *
 * AES-256-GCM provides authenticated encryption and scrypt derives a
 * per-blob key from the server-side wrapping secret. Secrets are never logged
 * or included in error messages.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SCRYPT_N = 16384;
const MIN_SECRET_LEN = 32;
const CONNECTOR_ID_RE = /^conn_[A-Za-z0-9_-]{8,64}$/;

/**
 * @typedef {Object} OAuthTokenPayload
 * @property {string} refresh_token
 * @property {string} scope
 * @property {string} token_type
 * @property {string} obtained_at
 * @property {string} account_sub
 */

function deriveKey(secret, salt) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LEN) {
    throw new TypeError('OAuth vault secret must be at least 32 characters');
  }
  return crypto.scryptSync(secret, salt, KEY_LENGTH, { N: SCRYPT_N });
}

function encryptPayload(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptPayload(line, key) {
  const parts = line.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted OAuth blob');
  const iv = Buffer.from(parts[0], 'base64url');
  const authTag = Buffer.from(parts[1], 'base64url');
  const encrypted = Buffer.from(parts[2], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
}

/**
 * Resolve the isolated docs OAuth path for a connector.
 * @param {string} dataDir
 * @param {string} connectorId
 */
export function oauthTokenVaultPath(dataDir, connectorId) {
  if (typeof connectorId !== 'string' || !CONNECTOR_ID_RE.test(connectorId)) {
    throw new TypeError('Invalid connector id for OAuth vault path');
  }
  return path.join(dataDir, 'docs_oauth', `${connectorId}.enc`);
}

/**
 * Encrypt and persist refresh material.
 * @param {string} dataDir
 * @param {string} connectorId
 * @param {string} secret
 * @param {OAuthTokenPayload} payload
 */
export function writeOAuthTokenVault(dataDir, connectorId, secret, payload) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const blob = `${salt.toString('base64url')}:${encryptPayload(JSON.stringify(payload), key)}`;
  const filePath = oauthTokenVaultPath(dataDir, connectorId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, blob, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Decrypt stored refresh material.
 * @param {string} dataDir
 * @param {string} connectorId
 * @param {string} secret
 * @returns {OAuthTokenPayload}
 */
export function readOAuthTokenVault(dataDir, connectorId, secret) {
  const filePath = oauthTokenVaultPath(dataDir, connectorId);
  if (!fs.existsSync(filePath)) throw new Error('OAuth token blob not found');
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const colon = raw.indexOf(':');
  if (colon <= 0) throw new Error('Malformed encrypted OAuth blob');
  const salt = Buffer.from(raw.slice(0, colon), 'base64url');
  const parsed = JSON.parse(decryptPayload(raw.slice(colon + 1), deriveKey(secret, salt)));
  if (
    !parsed
    || typeof parsed.refresh_token !== 'string'
    || typeof parsed.scope !== 'string'
    || typeof parsed.token_type !== 'string'
    || typeof parsed.obtained_at !== 'string'
    || typeof parsed.account_sub !== 'string'
  ) {
    throw new Error('Invalid OAuth token payload shape');
  }
  return /** @type {OAuthTokenPayload} */ (parsed);
}

/**
 * Idempotently delete one encrypted blob.
 * @param {string} dataDir
 * @param {string} connectorId
 */
export function deleteOAuthTokenVault(dataDir, connectorId) {
  const filePath = oauthTokenVaultPath(dataDir, connectorId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * Exercise the cryptographic round trip without filesystem I/O.
 * @param {string} secret
 * @param {OAuthTokenPayload} payload
 * @returns {OAuthTokenPayload}
 */
export function oauthTokenVaultRoundTrip(secret, payload) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  return JSON.parse(decryptPayload(encryptPayload(JSON.stringify(payload), key), key));
}
