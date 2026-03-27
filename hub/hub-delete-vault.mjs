/**
 * Self-hosted Hub: delete a non-default vault (filesystem + hub_vaults.yaml + access/scope/proposals + vectors).
 */

import fs from 'fs';
import path from 'path';
import { readHubVaults, writeHubVaults } from '../lib/hub-vaults.mjs';
import { createVectorStore } from '../lib/vector-store.mjs';
import { readVaultAccess, writeVaultAccess } from './hub_vault_access.mjs';
import { readScope, writeScope } from './hub_scope.mjs';
import { removeProposalsForVault } from './proposals-store.mjs';

function httpError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * @param {{ dataDir: string, projectRoot: string, vaultId: string, config: object }} opts
 * @returns {Promise<{ ok: true, deleted_vault_id: string, proposals_removed: number, vectors_purged: boolean }>}
 */
export async function deleteSelfHostedVault(opts) {
  const { dataDir, projectRoot, config } = opts;
  const id = String(opts.vaultId || '').trim();
  if (!id) throw httpError('vault id required', 'BAD_REQUEST');
  if (id === 'default') throw httpError('Cannot delete the default vault', 'BAD_REQUEST');

  const list = readHubVaults(dataDir, projectRoot);
  const vaultsEffective = Array.isArray(list) ? list : [];
  const target = vaultsEffective.find((v) => v && String(v.id).trim() === id);
  if (!target) {
    throw httpError(`Unknown vault id: ${id}`, 'BAD_REQUEST');
  }

  const pathToIds = new Map();
  for (const v of vaultsEffective) {
    if (!v || !v.path) continue;
    const p = v.path;
    if (!pathToIds.has(p)) pathToIds.set(p, []);
    pathToIds.get(p).push(String(v.id).trim());
  }
  const idsAtPath = pathToIds.get(target.path) || [];
  if (idsAtPath.length > 1) {
    throw httpError(
      'Multiple vault ids share the same directory; fix hub_vaults.yaml before deleting a vault.',
      'BAD_REQUEST',
    );
  }

  const rootResolved = path.resolve(projectRoot);
  let rootReal;
  try {
    rootReal = fs.realpathSync(rootResolved);
  } catch {
    throw httpError('Could not resolve project root path', 'RUNTIME_ERROR');
  }

  let vaultReal = null;
  try {
    vaultReal = fs.realpathSync(target.path);
  } catch {
    /* directory already removed — still drop from registry and vectors */
  }

  if (vaultReal) {
    if (vaultReal === rootReal) {
      throw httpError('Refusing to delete the project root as a vault', 'FORBIDDEN');
    }
    const rel = path.relative(rootReal, vaultReal);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw httpError('Vault directory must resolve inside the project root', 'FORBIDDEN');
    }
    fs.rmSync(vaultReal, { recursive: true, force: true });
  }

  const remaining = vaultsEffective.filter((v) => v && String(v.id).trim() !== id);
  writeHubVaults(dataDir, remaining, projectRoot);

  const access = readVaultAccess(dataDir);
  const nextAccess = {};
  for (const [uid, arr] of Object.entries(access)) {
    if (typeof uid !== 'string' || !uid.trim() || !Array.isArray(arr)) continue;
    const filtered = arr.filter((x) => String(x).trim() !== id);
    if (filtered.length > 0) nextAccess[uid.trim()] = filtered;
  }
  writeVaultAccess(dataDir, nextAccess);

  const scopeRaw = readScope(dataDir);
  const nextScope = {};
  for (const [uid, vmap] of Object.entries(scopeRaw)) {
    if (typeof uid !== 'string' || !uid.trim() || !vmap || typeof vmap !== 'object') continue;
    const inner = {};
    for (const [vid, rules] of Object.entries(vmap)) {
      if (String(vid).trim() === id) continue;
      inner[vid] = rules;
    }
    if (Object.keys(inner).length > 0) nextScope[uid.trim()] = inner;
  }
  writeScope(dataDir, nextScope);

  const proposalsRemoved = removeProposalsForVault(dataDir, id);

  let vectorsPurged = false;
  try {
    const store = await createVectorStore(config);
    if (typeof store.deleteByVaultId === 'function') {
      await store.deleteByVaultId(id);
      vectorsPurged = true;
    }
  } catch {
    /* optional vector backend misconfigured or delete unsupported — vault data already removed */
    vectorsPurged = false;
  }

  return {
    ok: true,
    deleted_vault_id: id,
    proposals_removed: proposalsRemoved,
    vectors_purged: vectorsPurged,
  };
}
