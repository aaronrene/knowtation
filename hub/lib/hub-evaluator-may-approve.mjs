/**
 * Per-user "evaluator may approve" map (self-hosted Hub data dir).
 * Hosted uses bridge blob `hub_evaluator_may_approve`; same JSON shape: { evaluator_may_approve: { "sub": true, ... } }.
 */

import fs from 'fs';
import path from 'path';

const FILE = 'hub_evaluator_may_approve.json';

/**
 * @param {string} dataDir
 * @returns {Record<string, boolean>}
 */
export function readEvaluatorMayApprove(dataDir) {
  if (!dataDir) return {};
  const filePath = path.join(dataDir, FILE);
  try {
    if (!fs.existsSync(filePath)) return {};
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const m = data?.evaluator_may_approve != null ? data.evaluator_may_approve : data;
    if (typeof m !== 'object' || m === null) return {};
    const out = {};
    for (const [k, v] of Object.entries(m)) {
      if (typeof k === 'string' && k.trim()) out[k.trim()] = Boolean(v);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @param {Record<string, boolean>} map
 */
export function writeEvaluatorMayApprove(dataDir, map) {
  if (!dataDir) throw new Error('data_dir required');
  const filePath = path.join(dataDir, FILE);
  const obj = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof k === 'string' && k.trim()) obj[k.trim()] = Boolean(v);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ evaluator_may_approve: obj }, null, 2), 'utf8');
}

/**
 * Whether the actor may approve proposals (admin always; evaluator from map + env fallback).
 * @param {string} sub
 * @param {string} role - effective role (admin, editor, viewer, evaluator, member)
 * @param {Record<string, boolean>} mayMap
 * @param {boolean} envFallback - HUB_EVALUATOR_MAY_APPROVE === '1'
 */
export function actorMayApproveProposals(sub, role, mayMap, envFallback) {
  if (role === 'admin') return true;
  if (role !== 'evaluator') return false;
  if (Object.prototype.hasOwnProperty.call(mayMap, sub)) return Boolean(mayMap[sub]);
  return envFallback;
}
