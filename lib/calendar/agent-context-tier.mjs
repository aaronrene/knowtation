/**
 * Agent context tier redaction for normalized calendar events.
 *
 * Calendar summaries and descriptions are untrusted prompt content. Retrieval
 * must enforce tier caps server-side — never rely on client toggles alone.
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — Agent Context Tiers
 */

/** @typedef {import('./ics-normalizer.mjs').NormalizedCalendarEvent} NormalizedCalendarEvent */
/** @typedef {import('./source-calendar-defaults.mjs').AgentContextTier} AgentContextTier */

/**
 * @typedef {Object} AgentVisibleCalendarEvent
 * @property {string} external_uid
 * @property {string} start
 * @property {string} end
 * @property {string} timezone
 * @property {boolean} busy
 * @property {'confirmed'|'cancelled'|'tentative'} status
 * @property {string|null} [summary]
 * @property {string|null} [calendar_label]
 * @property {string[]|null} [linked_note_paths]
 * @property {string|null} [location]
 * @property {string|null} [description]
 */

/**
 * Redact a normalized event to the fields visible at the given agent tier.
 *
 * @param {NormalizedCalendarEvent} event
 * @param {AgentContextTier} tier
 * @param {{ calendar_label?: string|null, linked_note_paths?: string[]|null, location?: string|null, description?: string|null }} [extras]
 * @returns {AgentVisibleCalendarEvent | null}
 */
export function redactEventForAgentTier(event, tier, extras = {}) {
  if (tier === 0) {
    return null;
  }

  /** @type {AgentVisibleCalendarEvent} */
  const base = {
    external_uid: event.external_uid,
    start: event.start,
    end: event.end,
    timezone: event.timezone,
    busy: event.busy,
    status: event.status,
  };

  if (tier === 1) {
    return base;
  }

  const withSummary = {
    ...base,
    summary: event.summary,
    calendar_label: extras.calendar_label ?? null,
  };

  if (tier === 2) {
    return withSummary;
  }

  const withLinks = {
    ...withSummary,
    linked_note_paths: extras.linked_note_paths ?? null,
  };

  if (tier === 3) {
    return withLinks;
  }

  return {
    ...withLinks,
    location: extras.location ?? null,
    description: extras.description ?? null,
  };
}
