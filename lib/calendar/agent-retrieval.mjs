/**
 * Agent calendar context retrieval with server-side tier enforcement
 * (Calendar Events v0 — Phase 1E).
 *
 * This is the ONLY path through which agents may read calendar context. It
 * enforces, server-side and independently of any client toggle:
 *
 *   1. `enabled_for_agents` — a calendar with agents disabled contributes
 *      nothing, regardless of the requested tier.
 *   2. `agent_context_tier_max` — the per-calendar cap a user set.
 *   3. Org policy cap — `KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP` /
 *      `hub_calendar_policy.json` may further lower the ceiling (minors,
 *      classrooms).
 *   4. v0 ceiling — retrieval exposes tiers 0–2 only. Tier 3 (linked notes)
 *      and tier 4 (location/description) are deferred and never returned here.
 *
 * Agent visibility is intentionally independent of `enabled_for_display`:
 * "Show on timeline" and "Include in agent context" are separate switches
 * (security checklist #7). Calendar text is untrusted prompt content; redaction
 * happens here, never on the client.
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — Agent Context Tiers, Security Gates
 */

import { getVaultCalendarStore, queryStoredEvents } from './event-store.mjs';
import { redactEventForAgentTier } from './agent-context-tier.mjs';
import { readCalendarAgentTierCap } from './calendar-policy.mjs';
import { parseTimelineRange, parseSourceCalendarIds } from './timeline.mjs';

/** @typedef {import('./source-calendar-defaults.mjs').AgentContextTier} AgentContextTier */
/** @typedef {import('./agent-context-tier.mjs').AgentVisibleCalendarEvent} AgentVisibleCalendarEvent */

/**
 * Maximum tier the v0 retrieval API will ever expose. Tiers 3–4 require a
 * separate consent gate and are not implemented in retrieval yet.
 * @type {2}
 */
export const AGENT_RETRIEVAL_MAX_TIER = 2;

/**
 * @typedef {Object} AgentContextCalendarSummary
 * @property {string} source_calendar_id
 * @property {string} display_name
 * @property {'personal'|'work'|'school'|'other'|null} user_group
 * @property {boolean} enabled_for_agents
 * @property {AgentContextTier} agent_context_tier_max — user-set per-calendar cap
 * @property {0|1|2} effective_tier — tier actually applied after all caps
 * @property {number} event_count — events contributed at the effective tier
 */

/**
 * @typedef {AgentVisibleCalendarEvent & { event_id: string, source_calendar_id: string, agent_tier: 1|2 }} AgentContextEventItem
 */

/**
 * @typedef {Object} AgentContextResult
 * @property {'knowtation.calendar_agent_context/v0'} schema
 * @property {string} vault_id
 * @property {string} from — YYYY-MM-DD
 * @property {string} to — YYYY-MM-DD
 * @property {0|1|2} requested_tier
 * @property {0|1|2} effective_tier — requested tier after org policy clamp
 * @property {AgentContextTier} policy_agent_context_tier_max_cap
 * @property {AgentContextCalendarSummary[]} source_calendars — calendars in scope (agent-enabled)
 * @property {AgentContextEventItem[]} items — redacted, tier-enforced events
 */

/**
 * Validate and normalize the requested agent context tier for v0 retrieval.
 *
 * @param {unknown} raw
 * @returns {0|1|2}
 */
export function parseAgentContextTier(raw) {
  const value = typeof raw === 'string' ? Number.parseInt(raw.trim(), 10) : raw;
  if (!Number.isInteger(value)) {
    throw new RangeError('agent_context_tier must be an integer 0, 1, or 2');
  }
  if (value < 0 || value > AGENT_RETRIEVAL_MAX_TIER) {
    throw new RangeError(
      `agent_context_tier must be 0, 1, or 2 (v0 retrieval ceiling is ${AGENT_RETRIEVAL_MAX_TIER})`,
    );
  }
  return /** @type {0|1|2} */ (value);
}

/**
 * Compute the tier actually applied to one source calendar after enforcing the
 * agent toggle, the per-calendar cap, the org policy cap, and the requested
 * tier. Fails closed to 0 (no fields) whenever the calendar is not agent-enabled.
 *
 * @param {{ enabled_for_agents: boolean, agent_context_tier_max: AgentContextTier }} calendar
 * @param {0|1|2} requestedTier — already clamped by org policy
 * @returns {0|1|2}
 */
export function resolveEffectiveTier(calendar, requestedTier) {
  if (!calendar.enabled_for_agents) {
    return 0;
  }
  const capped = Math.min(requestedTier, calendar.agent_context_tier_max, AGENT_RETRIEVAL_MAX_TIER);
  return /** @type {0|1|2} */ (capped < 0 ? 0 : capped);
}

/**
 * Retrieve redacted, tier-enforced calendar context for an agent.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   from: string,
 *   to: string,
 *   agentContextTier: unknown,
 *   sourceCalendarIds?: unknown,
 * }} query
 * @returns {AgentContextResult}
 */
export function retrieveAgentCalendarContext(dataDir, vaultId, query) {
  const range = parseTimelineRange(query.from, query.to);
  const requestedTier = parseAgentContextTier(query.agentContextTier);
  const requestedIds = parseSourceCalendarIds(query.sourceCalendarIds);

  const policyCap = readCalendarAgentTierCap(dataDir);
  // Org policy can only lower the ceiling; clamp requested tier to it.
  const effectiveRequested = /** @type {0|1|2} */ (
    Math.min(requestedTier, policyCap, AGENT_RETRIEVAL_MAX_TIER)
  );

  const vaultStore = getVaultCalendarStore(dataDir, vaultId);
  const requestedIdSet = requestedIds ? new Set(requestedIds) : null;

  /** @type {Map<string, { calendar: import('./event-store.mjs').StoredSourceCalendar, tier: 0|1|2 }>} */
  const scopedById = new Map();
  /** @type {AgentContextCalendarSummary[]} */
  const summaries = [];

  for (const calendar of vaultStore.source_calendars) {
    if (requestedIdSet && !requestedIdSet.has(calendar.source_calendar_id)) {
      continue;
    }
    if (!calendar.enabled_for_agents) {
      continue;
    }
    const tier = resolveEffectiveTier(calendar, effectiveRequested);
    scopedById.set(calendar.source_calendar_id, { calendar, tier });
    summaries.push({
      source_calendar_id: calendar.source_calendar_id,
      display_name: calendar.display_name,
      user_group: calendar.user_group ?? null,
      enabled_for_agents: calendar.enabled_for_agents,
      agent_context_tier_max: calendar.agent_context_tier_max,
      effective_tier: tier,
      event_count: 0,
    });
  }

  /** @type {AgentContextEventItem[]} */
  const items = [];

  if (scopedById.size > 0 && effectiveRequested > 0) {
    // Agent visibility is independent of enabled_for_display.
    const events = queryStoredEvents(dataDir, vaultId, {
      fromIso: range.fromIso,
      toIso: range.toIso,
      sourceCalendarIds: [...scopedById.keys()],
      displayOnly: false,
    });

    const summaryById = new Map(summaries.map((s) => [s.source_calendar_id, s]));

    for (const event of events) {
      const scoped = scopedById.get(event.source_calendar_id);
      if (!scoped || scoped.tier === 0) {
        continue;
      }
      const redacted = redactEventForAgentTier(event, scoped.tier, {
        calendar_label: scoped.calendar.display_name,
      });
      if (!redacted) {
        continue;
      }
      items.push({
        ...redacted,
        event_id: event.event_id,
        source_calendar_id: event.source_calendar_id,
        agent_tier: /** @type {1|2} */ (scoped.tier),
      });
      const summary = summaryById.get(event.source_calendar_id);
      if (summary) {
        summary.event_count += 1;
      }
    }
  }

  items.sort((a, b) => {
    const cmp = a.start.localeCompare(b.start);
    if (cmp !== 0) return cmp;
    return a.event_id.localeCompare(b.event_id);
  });

  return {
    schema: 'knowtation.calendar_agent_context/v0',
    vault_id: vaultId,
    from: range.fromDate,
    to: range.toDate,
    requested_tier: requestedTier,
    effective_tier: effectiveRequested,
    policy_agent_context_tier_max_cap: policyCap,
    source_calendars: summaries,
    items,
  };
}
