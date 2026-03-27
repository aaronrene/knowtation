/**
 * Simple file-based proposal store. Phase 11.
 * Stores proposals in data_dir/hub_proposals.json.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { notePathMatchesPrefix, normalizePathPrefix } from '../lib/write.mjs';

const FILENAME = 'hub_proposals.json';

export function getProposalsPath(dataDir) {
  return path.join(dataDir, FILENAME);
}

function loadProposals(dataDir) {
  const filePath = getProposalsPath(dataDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function saveProposals(dataDir, proposals) {
  const filePath = getProposalsPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(proposals, null, 2), 'utf8');
}

/**
 * @param {string} dataDir
 * @param {{ status?: string, vault_id?: string, limit?: number, offset?: number }} options
 * @returns {{ proposals: object[], total: number }}
 */
export function listProposals(dataDir, options = {}) {
  const all = loadProposals(dataDir);
  let list = all;
  if (options.status) list = list.filter((p) => p.status === options.status);
  if (options.vault_id != null) {
    list = list.filter((p) => (p.vault_id ?? 'default') === options.vault_id);
  }
  const total = list.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  list = list.slice(offset, offset + limit);
  return { proposals: list, total };
}

/**
 * @param {string} dataDir
 * @param {string} id
 */
export function getProposal(dataDir, id) {
  const all = loadProposals(dataDir);
  return all.find((p) => p.proposal_id === id) ?? null;
}

/**
 * @param {string} dataDir
 * @param {{ path?: string, body?: string, frontmatter?: object, intent?: string, base_state_id?: string, vault_id?: string, proposed_by?: string }} input
 * @returns {{ proposal_id: string, path: string, status: string, vault_id?: string, intent?: string, base_state_id?: string, body?: string, frontmatter?: object, proposed_by?: string, created_at: string, updated_at: string }}
 */
export function createProposal(dataDir, input) {
  const all = loadProposals(dataDir);
  const now = new Date().toISOString();
  const proposedBy =
    typeof input.proposed_by === 'string' && input.proposed_by.trim() ? input.proposed_by.trim() : undefined;
  const proposal = {
    proposal_id: randomUUID(),
    path: input.path || `inbox/proposal-${Date.now()}.md`,
    status: 'proposed',
    vault_id: typeof input.vault_id === 'string' && input.vault_id.trim() ? input.vault_id.trim() : 'default',
    intent: input.intent ?? undefined,
    base_state_id: input.base_state_id ?? undefined,
    body: input.body ?? '',
    frontmatter: input.frontmatter ?? {},
    ...(proposedBy && { proposed_by: proposedBy }),
    created_at: now,
    updated_at: now,
  };
  all.push(proposal);
  saveProposals(dataDir, all);
  return proposal;
}

/**
 * @param {string} dataDir
 * @param {string} id
 * @param {'approved'|'discarded'}} status
 * @returns {object|null} Updated proposal or null
 */
export function updateProposalStatus(dataDir, id, status) {
  const all = loadProposals(dataDir);
  const idx = all.findIndex((p) => p.proposal_id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  all[idx] = { ...all[idx], status, updated_at: now };
  saveProposals(dataDir, all);
  return all[idx];
}


/**
 * Discard proposals in "proposed" state whose path is under path_prefix in the given vault.
 * @param {string} dataDir
 * @param {{ vault_id?: string, path_prefix: string }} opts
 * @returns {number} count discarded
 */
export function discardProposalsUnderPathPrefix(dataDir, opts) {
  const pathPrefixRaw = opts && opts.path_prefix != null ? String(opts.path_prefix) : '';
  const prefixNorm = normalizePathPrefix(pathPrefixRaw);
  const vid = opts.vault_id != null && String(opts.vault_id).trim() ? String(opts.vault_id).trim() : 'default';
  const all = loadProposals(dataDir);
  const now = new Date().toISOString();
  let n = 0;
  const next = all.map((p) => {
    if (p.status !== 'proposed') return p;
    const pv = p.vault_id != null && String(p.vault_id).trim() ? String(p.vault_id).trim() : 'default';
    if (pv !== vid) return p;
    if (!notePathMatchesPrefix(p.path, prefixNorm)) return p;
    n += 1;
    return { ...p, status: 'discarded', updated_at: now };
  });
  saveProposals(dataDir, next);
  return n;
}
