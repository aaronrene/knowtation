/**
 * Whether new proposals must start in evaluation_status pending (mirrors Node + gateway).
 * Precedence: HUB_PROPOSAL_EVALUATION_REQUIRED=1 → true; =0 → false; else data/hub_proposal_policy.json proposal_evaluation_required.
 */

import fs from 'fs';
import path from 'path';

const POLICY_FILE = 'hub_proposal_policy.json';

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getProposalEvaluationRequired(dataDir) {
  const env = process.env.HUB_PROPOSAL_EVALUATION_REQUIRED;
  if (env === '1' || env === 'true') return true;
  if (env === '0' || env === 'false') return false;
  const fp = path.join(dataDir, POLICY_FILE);
  if (!fs.existsSync(fp)) return false;
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return j && j.proposal_evaluation_required === true;
  } catch {
    return false;
  }
}
