/**
 * PATCH semantics for SourceCalendar display/agent toggles (Calendar Events v0).
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — PATCH /api/v1/calendar/source-calendars/:id
 */

import {
  loadCalendarStore,
  saveCalendarStore,
  sourceCalendarForClient,
} from './event-store.mjs';
import {
  AGENT_CONTEXT_TIERS,
} from './source-calendar-defaults.mjs';
import {
  isAgentTierWithinPolicyCap,
  readCalendarAgentTierCap,
} from './calendar-policy.mjs';

/** @typedef {import('./source-calendar-defaults.mjs').AgentContextTier} AgentContextTier */

/** @type {readonly ('personal'|'work'|'school'|'other')[]} */
export const SOURCE_CALENDAR_USER_GROUPS = Object.freeze(['personal', 'work', 'school', 'other']);

/**
 * @typedef {Object} SourceCalendarPatchInput
 * @property {boolean} [enabled_for_display]
 * @property {boolean} [enabled_for_agents]
 * @property {AgentContextTier} [agent_context_tier_max]
 * @property {'personal'|'work'|'school'|'other'|null} [user_group]
 */

/**
 * @typedef {Object} SourceCalendarPatchResult
 * @property {ReturnType<typeof sourceCalendarForClient>} source_calendar
 * @property {AgentContextTier} policy_agent_context_tier_max_cap
 */

/**
 * Parse and validate a PATCH body. Throws RangeError/TypeError on invalid input.
 *
 * @param {unknown} body
 * @returns {SourceCalendarPatchInput}
 */
export function parseSourceCalendarPatchBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('Request body must be a JSON object');
  }

  /** @type {SourceCalendarPatchInput} */
  const patch = {};
  const record = /** @type {Record<string, unknown>} */ (body);

  if ('enabled_for_display' in record) {
    if (typeof record.enabled_for_display !== 'boolean') {
      throw new TypeError('enabled_for_display must be a boolean');
    }
    patch.enabled_for_display = record.enabled_for_display;
  }

  if ('enabled_for_agents' in record) {
    if (typeof record.enabled_for_agents !== 'boolean') {
      throw new TypeError('enabled_for_agents must be a boolean');
    }
    patch.enabled_for_agents = record.enabled_for_agents;
  }

  if ('agent_context_tier_max' in record) {
    const tier = record.agent_context_tier_max;
    if (!Number.isInteger(tier) || !AGENT_CONTEXT_TIERS.includes(/** @type {AgentContextTier} */ (tier))) {
      throw new RangeError('agent_context_tier_max must be an integer 0–4');
    }
    patch.agent_context_tier_max = /** @type {AgentContextTier} */ (tier);
  }

  if ('user_group' in record) {
    const group = record.user_group;
    if (group === null) {
      patch.user_group = null;
    } else if (typeof group === 'string' && SOURCE_CALENDAR_USER_GROUPS.includes(/** @type {*} */ (group))) {
      patch.user_group = /** @type {'personal'|'work'|'school'|'other'} */ (group);
    } else {
      throw new RangeError('user_group must be personal, work, school, other, or null');
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new TypeError('At least one patch field is required');
  }

  return patch;
}

/**
 * Apply toggle patch to one source calendar in a vault store.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} sourceCalendarId
 * @param {SourceCalendarPatchInput} patch
 * @returns {SourceCalendarPatchResult}
 */
export function patchSourceCalendar(dataDir, vaultId, sourceCalendarId, patch) {
  const id = String(sourceCalendarId ?? '').trim();
  if (!id) {
    throw new TypeError('source_calendar_id is required');
  }

  const policyCap = readCalendarAgentTierCap(dataDir);
  const store = loadCalendarStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = { source_calendars: [], events: [] };
  }
  const vaultStore = store.vaults[vaultId];
  const calendar = vaultStore.source_calendars.find((c) => c.source_calendar_id === id);
  if (!calendar) {
    throw new Error(`Source calendar not found: ${id}`);
  }

  if (patch.enabled_for_display !== undefined) {
    calendar.enabled_for_display = patch.enabled_for_display;
  }
  if (patch.enabled_for_agents !== undefined) {
    calendar.enabled_for_agents = patch.enabled_for_agents;
  }
  if (patch.user_group !== undefined) {
    calendar.user_group = patch.user_group;
  }
  if (patch.agent_context_tier_max !== undefined) {
    if (!isAgentTierWithinPolicyCap(patch.agent_context_tier_max, policyCap)) {
      const err = new RangeError(
        `agent_context_tier_max ${patch.agent_context_tier_max} exceeds policy cap ${policyCap}`,
      );
      err.code = 'POLICY_CAP_EXCEEDED';
      throw err;
    }
    calendar.agent_context_tier_max = patch.agent_context_tier_max;
  }

  const effectiveTier = calendar.agent_context_tier_max;
  if (calendar.enabled_for_agents && !isAgentTierWithinPolicyCap(effectiveTier, policyCap)) {
    const err = new RangeError(
      `enabled_for_agents requires agent_context_tier_max ≤ policy cap ${policyCap}`,
    );
    err.code = 'POLICY_CAP_EXCEEDED';
    throw err;
  }

  saveCalendarStore(dataDir, store);
  return {
    source_calendar: sourceCalendarForClient(calendar),
    policy_agent_context_tier_max_cap: policyCap,
  };
}
