/**
 * Proposal LLM + evaluation policy for self-hosted Hub (data/hub_proposal_policy.json).
 * Precedence per field: explicit env (1/true or 0/false) overrides file; else file; else default false.
 *
 * Env keys:
 * - HUB_PROPOSAL_EVALUATION_REQUIRED
 * - KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS
 * - KNOWTATION_HUB_PROPOSAL_ENRICH
 */

import fs from 'fs';
import path from 'path';

const POLICY_FILE = 'hub_proposal_policy.json';

/** @param {unknown} v */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * @param {string} dataDir
 * @returns {{ proposal_evaluation_required?: boolean, review_hints_enabled?: boolean, enrich_enabled?: boolean }}
 */
export function readProposalPolicyFile(dataDir) {
  const fp = path.join(dataDir, POLICY_FILE);
  if (!fs.existsSync(fp)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return {};
    const out = {};
    if (typeof j.proposal_evaluation_required === 'boolean') out.proposal_evaluation_required = j.proposal_evaluation_required;
    if (typeof j.review_hints_enabled === 'boolean') out.review_hints_enabled = j.review_hints_enabled;
    if (typeof j.enrich_enabled === 'boolean') out.enrich_enabled = j.enrich_enabled;
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getProposalEvaluationRequired(dataDir) {
  const fromEnv = envTriState(process.env.HUB_PROPOSAL_EVALUATION_REQUIRED);
  if (fromEnv !== null) return fromEnv;
  const file = readProposalPolicyFile(dataDir);
  return file.proposal_evaluation_required === true;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getProposalReviewHintsEnabled(dataDir) {
  const fromEnv = envTriState(process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS);
  if (fromEnv !== null) return fromEnv;
  return readProposalPolicyFile(dataDir).review_hints_enabled === true;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getProposalEnrichEnabled(dataDir) {
  const fromEnv = envTriState(process.env.KNOWTATION_HUB_PROPOSAL_ENRICH);
  if (fromEnv !== null) return fromEnv;
  return readProposalPolicyFile(dataDir).enrich_enabled === true;
}

/**
 * When true, that field is fixed by env and must not be edited via Settings file API.
 * @returns {{
 *   proposal_evaluation_required: boolean,
 *   review_hints_enabled: boolean,
 *   enrich_enabled: boolean,
 * }}
 */
export function proposalPolicyEnvLocked() {
  return {
    proposal_evaluation_required: envTriState(process.env.HUB_PROPOSAL_EVALUATION_REQUIRED) !== null,
    review_hints_enabled: envTriState(process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS) !== null,
    enrich_enabled: envTriState(process.env.KNOWTATION_HUB_PROPOSAL_ENRICH) !== null,
  };
}

/**
 * Merge partial policy into hub_proposal_policy.json (only keys present in partial; skips env-locked keys).
 * @param {string} dataDir
 * @param {{
 *   proposal_evaluation_required?: boolean,
 *   review_hints_enabled?: boolean,
 *   enrich_enabled?: boolean,
 * }} partial
 */
export function writeProposalPolicyMerge(dataDir, partial) {
  const locks = proposalPolicyEnvLocked();
  const fp = path.join(dataDir, POLICY_FILE);
  let existing = {};
  if (fs.existsSync(fp)) {
    try {
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (j && typeof j === 'object') existing = j;
    } catch {
      existing = {};
    }
  }
  const next = { ...existing };
  if (partial.proposal_evaluation_required !== undefined && !locks.proposal_evaluation_required) {
    next.proposal_evaluation_required = Boolean(partial.proposal_evaluation_required);
  }
  if (partial.review_hints_enabled !== undefined && !locks.review_hints_enabled) {
    next.review_hints_enabled = Boolean(partial.review_hints_enabled);
  }
  if (partial.enrich_enabled !== undefined && !locks.enrich_enabled) {
    next.enrich_enabled = Boolean(partial.enrich_enabled);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(next, null, 2), 'utf8');
}
