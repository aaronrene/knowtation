/**
 * Phase 13 invite flow — pending invites in data/hub_invites.json.
 * Format: { "invites": { "token": { "role": "editor", "created_at": "ISO" } } }.
 * Tokens expire after INVITE_EXPIRY_MS (default 7 days).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readRolesObject, writeRolesFile } from './roles.mjs';

const INVITES_FILE = 'hub_invites.json';
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {string} dataDir
 * @returns {{ [token: string]: { role: string, created_at: string } }}
 */
export function readInvites(dataDir) {
  if (!dataDir) return {};
  const filePath = path.join(dataDir, INVITES_FILE);
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const invites = data.invites && typeof data.invites === 'object' ? data.invites : {};
    return invites;
  } catch (_) {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @param {{ [token: string]: { role: string, created_at: string } }} invites
 */
export function writeInvites(dataDir, invites) {
  if (!dataDir) throw new Error('data_dir required');
  const filePath = path.join(dataDir, INVITES_FILE);
  const obj = {};
  for (const [token, entry] of Object.entries(invites)) {
    if (typeof token === 'string' && token && entry && typeof entry.role === 'string' && typeof entry.created_at === 'string') {
      obj[token] = { role: entry.role, created_at: entry.created_at };
    }
  }
  fs.writeFileSync(filePath, JSON.stringify({ invites: obj }, null, 2), 'utf8');
}

/**
 * Create a new invite. Returns token and expires_at (ISO string).
 * @param {string} dataDir
 * @param {string} role - viewer | editor | admin
 * @returns {{ token: string, role: string, created_at: string, expires_at: string }}
 */
export function createInvite(dataDir, role) {
  const r = (role || 'editor').toLowerCase();
  if (!['viewer', 'editor', 'admin'].includes(r)) throw new Error('role must be viewer, editor, or admin');
  const invites = readInvites(dataDir);
  const token = crypto.randomBytes(24).toString('base64url');
  const created_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();
  invites[token] = { role: r, created_at };
  writeInvites(dataDir, invites);
  return { token, role: r, created_at, expires_at };
}

/**
 * Consume an invite: add sub to roles with invite's role, remove invite. Returns true if consumed.
 * @param {string} dataDir
 * @param {string} token
 * @param {string} sub - e.g. "google:123"
 * @returns {boolean}
 */
export function consumeInvite(dataDir, token, sub) {
  if (!dataDir || !token || !sub) return false;
  const invites = readInvites(dataDir);
  const entry = invites[token];
  if (!entry) return false;
  const created = new Date(entry.created_at).getTime();
  if (Date.now() - created > INVITE_EXPIRY_MS) {
    delete invites[token];
    writeInvites(dataDir, invites);
    return false;
  }
  const roles = readRolesObject(dataDir);
  roles[sub] = entry.role;
  writeRolesFile(dataDir, roles);
  delete invites[token];
  writeInvites(dataDir, invites);
  return true;
}

/**
 * Revoke an invite by token.
 * @param {string} dataDir
 * @param {string} token
 * @returns {boolean} true if existed and was removed
 */
export function revokeInvite(dataDir, token) {
  if (!dataDir || !token) return false;
  const invites = readInvites(dataDir);
  if (!(token in invites)) return false;
  delete invites[token];
  writeInvites(dataDir, invites);
  return true;
}

/**
 * List pending invites with expiry. Filters out expired.
 * @param {string} dataDir
 * @returns {{ token: string, role: string, created_at: string, expires_at: string }[]}
 */
export function listInvites(dataDir) {
  const invites = readInvites(dataDir);
  const now = Date.now();
  const list = [];
  for (const [token, entry] of Object.entries(invites)) {
    const created = new Date(entry.created_at).getTime();
    const expires_at = new Date(created + INVITE_EXPIRY_MS).toISOString();
    if (now - created <= INVITE_EXPIRY_MS) {
      list.push({ token, role: entry.role, created_at: entry.created_at, expires_at });
    }
  }
  return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
