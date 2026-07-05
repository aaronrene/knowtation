/**
 * Encrypted refresh-token vault for Calendar OAuth connectors (Phase 1D).
 *
 * AES-256-GCM + scrypt key derivation — same pattern as memory-provider-encrypted.mjs.
 * Pure crypto round-trip; no logging; secrets never appear in thrown errors.
 *
 * @see docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md — D4
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SCRYPT_N = 16384;
const MIN_SECRET_LEN = 32;

/**
 * @typedef {Object} OAuthTokenPayload
 * @property {string} refresh_token
 * @property {string} scope
 * @property {string} token_type
 * @property {string} obtained_at — ISO8601
 * @property {string} account_sub
 */

/**
 * @param {string} secret
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(secret, salt) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LEN) {
    throw new TypeError('OAuth vault secret must be at least 32 characters');
  }
  return crypto.scryptSync(secret, salt, KEY_LENGTH, { N: SCRYPT_N });
}

/**
 * @param {string} plaintext
 * @param {Buffer} key
 * @returns {string} base64url(iv):base64url(tag):base64url(ciphertext)
 */
function encryptPayload(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * @param {string} line
 * @param {Buffer} key
 * @returns {string}
 */
function decryptPayload(line, key) {
  const parts = line.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted OAuth blob');
  }
  const iv = Buffer.from(parts[0], 'base64url');
  const authTag = Buffer.from(parts[1], 'base64url');
  const encrypted = Buffer.from(parts[2], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
}

/**
 * Resolve on-disk path for one connector token blob.
 *
 * @param {string} dataDir
 * @param {string} connectorId
 * @returns {string}
 */
export function oauthTokenVaultPath(dataDir, connectorId) {
  if (typeof connectorId !== 'string' || !/^conn_[A-Za-z0-9_-]{8,64}$/.test(connectorId)) {
    throw new TypeError('Invalid connector id for OAuth vault path');
  }
  return path.join(dataDir, 'calendar_oauth', `${connectorId}.enc`);
}

/**
 * Encrypt and persist a refresh-token payload for one connector.
 *
 * @param {string} dataDir
 * @param {string} connectorId
 * @param {string} secret — KNOWTATION_CALENDAR_OAUTH_SECRET
 * @param {OAuthTokenPayload} payload
 */
export function writeOAuthTokenVault(dataDir, connectorId, secret, payload) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const json = JSON.stringify(payload);
  const enc = encryptPayload(json, key);
  const blob = `${salt.toString('base64url')}:${enc}`;
  const filePath = oauthTokenVaultPath(dataDir, connectorId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, blob, 'utf8');
}

/**
 * Decrypt a stored refresh-token payload.
 *
 * @param {string} dataDir
 * @param {string} connectorId
 * @param {string} secret
 * @returns {OAuthTokenPayload}
 */
export function readOAuthTokenVault(dataDir, connectorId, secret) {
  const filePath = oauthTokenVaultPath(dataDir, connectorId);
  if (!fs.existsSync(filePath)) {
    throw new Error('OAuth token blob not found');
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const colon = raw.indexOf(':');
  if (colon <= 0) {
    throw new Error('Malformed encrypted OAuth blob');
  }
  const salt = Buffer.from(raw.slice(0, colon), 'base64url');
  const enc = raw.slice(colon + 1);
  const key = deriveKey(secret, salt);
  const json = decryptPayload(enc, key);
  const parsed = JSON.parse(json);
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
 * Delete the encrypted blob for one connector (idempotent).
 *
 * @param {string} dataDir
 * @param {string} connectorId
 */
export function deleteOAuthTokenVault(dataDir, connectorId) {
  const filePath = oauthTokenVaultPath(dataDir, connectorId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * In-memory encrypt/decrypt round-trip for unit tests (no filesystem).
 *
 * @param {string} secret
 * @param {OAuthTokenPayload} payload
 * @returns {OAuthTokenPayload}
 */
export function oauthTokenVaultRoundTrip(secret, payload) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const enc = encryptPayload(JSON.stringify(payload), key);
  const json = decryptPayload(enc, key);
  return /** @type {OAuthTokenPayload} */ (JSON.parse(json));
}
