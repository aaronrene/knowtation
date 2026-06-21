/**
 * Default toggle values for new SourceCalendar rows (Calendar Events v0).
 *
 * Product rule: synced calendars appear on the timeline by default, but agents
 * receive no calendar context until the user opts in per calendar.
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — Security checklist §Phase 0
 */

/** @typedef {0 | 1 | 2 | 3 | 4} AgentContextTier */

/** @type {readonly AgentContextTier[]} */
export const AGENT_CONTEXT_TIERS = Object.freeze([0, 1, 2, 3, 4]);

/**
 * Canonical defaults applied when a user connects a new external calendar.
 * @type {Readonly<{
 *   enabled_for_sync: boolean,
 *   enabled_for_display: boolean,
 *   enabled_for_agents: boolean,
 *   agent_context_tier_max: AgentContextTier,
 * }>}
 */
export const SOURCE_CALENDAR_DEFAULTS = Object.freeze({
  enabled_for_sync: true,
  enabled_for_display: true,
  enabled_for_agents: false,
  agent_context_tier_max: 0,
});

/**
 * Build a SourceCalendar toggle snapshot with v0 defaults, optionally overridden.
 *
 * @param {Partial<typeof SOURCE_CALENDAR_DEFAULTS>} [overrides]
 * @returns {typeof SOURCE_CALENDAR_DEFAULTS}
 */
export function buildSourceCalendarDefaults(overrides = {}) {
  const tier = overrides.agent_context_tier_max ?? SOURCE_CALENDAR_DEFAULTS.agent_context_tier_max;
  if (!AGENT_CONTEXT_TIERS.includes(/** @type {AgentContextTier} */ (tier))) {
    throw new RangeError('agent_context_tier_max must be 0–4');
  }
  return {
    enabled_for_sync: overrides.enabled_for_sync ?? SOURCE_CALENDAR_DEFAULTS.enabled_for_sync,
    enabled_for_display: overrides.enabled_for_display ?? SOURCE_CALENDAR_DEFAULTS.enabled_for_display,
    enabled_for_agents: overrides.enabled_for_agents ?? SOURCE_CALENDAR_DEFAULTS.enabled_for_agents,
    agent_context_tier_max: /** @type {AgentContextTier} */ (tier),
  };
}

/**
 * Whether agent retrieval may include fields from a calendar at the requested tier.
 *
 * @param {{ enabled_for_agents: boolean, agent_context_tier_max: AgentContextTier }} calendar
 * @param {AgentContextTier} requestedTier
 * @returns {boolean}
 */
export function isAgentTierAllowed(calendar, requestedTier) {
  if (!calendar.enabled_for_agents) {
    return requestedTier === 0;
  }
  if (!AGENT_CONTEXT_TIERS.includes(requestedTier)) {
    return false;
  }
  return requestedTier <= calendar.agent_context_tier_max;
}
