/**
 * Org/vault calendar agent-tier policy caps (Calendar Events v0).
 *
 * Self-hosted operators may cap the maximum `agent_context_tier_max` users can set
 * per source calendar (e.g. minors/classrooms → tier 0–1 only).
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — Security checklist #4
 */

import fs from 'fs';
import path from 'path';
import { AGENT_CONTEXT_TIERS } from './source-calendar-defaults.mjs';

/** @typedef {import('./source-calendar-defaults.mjs').AgentContextTier} AgentContextTier */

const POLICY_FILENAME = 'hub_calendar_policy.json';

/**
 * Read the org policy cap for agent_context_tier_max (inclusive upper bound).
 * Default 4 = no restriction beyond v0 tier enum.
 *
 * @param {string} dataDir
 * @returns {AgentContextTier}
 */
export function readCalendarAgentTierCap(dataDir) {
  const envRaw = process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
  if (envRaw != null && String(envRaw).trim() !== '') {
    const parsed = Number.parseInt(String(envRaw).trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 4) {
      return /** @type {AgentContextTier} */ (parsed);
    }
  }

  if (dataDir) {
    const filePath = path.join(dataDir, POLICY_FILENAME);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        const cap = data?.agent_context_tier_max_cap;
        if (Number.isInteger(cap) && cap >= 0 && cap <= 4) {
          return /** @type {AgentContextTier} */ (cap);
        }
      } catch {
        /* fall through to default */
      }
    }
  }

  return 4;
}

/**
 * @param {AgentContextTier} requestedTier
 * @param {AgentContextTier} policyCap
 * @returns {boolean}
 */
export function isAgentTierWithinPolicyCap(requestedTier, policyCap) {
  if (!AGENT_CONTEXT_TIERS.includes(requestedTier)) {
    return false;
  }
  return requestedTier <= policyCap;
}
