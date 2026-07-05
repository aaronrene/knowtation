/**
 * Pure Google Calendar API event → Calendar Events v0 normalizer (Phase 1D).
 *
 * No network. Drops attendees, organizer, location, description, conferencing
 * links, and attachments per D8. Recurring instances carry recurrence_rule=null.
 *
 * @see docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md — D5, D8
 */

import { normalizeStatus } from './ics-normalizer.mjs';

/** @typedef {'confirmed' | 'cancelled' | 'tentative'} CalendarEventStatus */

/**
 * @typedef {Object} NormalizedCalendarEvent
 * @property {string} external_uid
 * @property {string} start
 * @property {string} end
 * @property {string} timezone
 * @property {string|null} summary
 * @property {boolean} busy
 * @property {CalendarEventStatus} status
 * @property {null} recurrence_rule
 */

const MAX_EVENTS = 10_000;
const MAX_SUMMARY_LEN = 512;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function boundedSummary(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, MAX_SUMMARY_LEN);
}

/**
 * @param {Record<string, unknown>|undefined|null} dateTimeObj
 * @param {string} [fallbackTz='UTC']
 * @returns {{ instant: string, timezone: string } | null}
 */
function parseGoogleDateTime(dateTimeObj, fallbackTz = 'UTC') {
  if (!dateTimeObj || typeof dateTimeObj !== 'object') {
    return null;
  }
  const obj = /** @type {Record<string, unknown>} */ (dateTimeObj);
  if (typeof obj.date === 'string') {
    const match = obj.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }
    const tz = typeof obj.timeZone === 'string' && obj.timeZone.trim()
      ? obj.timeZone.trim()
      : fallbackTz;
    const instant = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      0,
      0,
      0,
    )).toISOString();
    return { instant, timezone: tz };
  }
  if (typeof obj.dateTime === 'string') {
    const parsed = Date.parse(obj.dateTime);
    if (Number.isNaN(parsed)) {
      return null;
    }
    const tz = typeof obj.timeZone === 'string' && obj.timeZone.trim()
      ? obj.timeZone.trim()
      : fallbackTz;
    return { instant: new Date(parsed).toISOString(), timezone: tz };
  }
  return null;
}

/**
 * Normalize one Google Calendar API event item.
 *
 * @param {Record<string, unknown>} googleEvent
 * @returns {NormalizedCalendarEvent | null}
 */
export function normalizeGoogleEvent(googleEvent) {
  if (!googleEvent || typeof googleEvent !== 'object') {
    return null;
  }
  const id = typeof googleEvent.id === 'string' ? googleEvent.id.trim() : '';
  if (!id) {
    return null;
  }
  const start = parseGoogleDateTime(
    /** @type {Record<string, unknown>|undefined} */ (googleEvent.start),
  );
  if (!start) {
    return null;
  }
  let end = parseGoogleDateTime(
    /** @type {Record<string, unknown>|undefined} */ (googleEvent.end),
    start.timezone,
  );
  if (!end) {
    end = {
      instant: new Date(Date.parse(start.instant) + 3_600_000).toISOString(),
      timezone: start.timezone,
    };
  }
  if (Date.parse(end.instant) <= Date.parse(start.instant)) {
    end = {
      instant: new Date(Date.parse(start.instant) + 3_600_000).toISOString(),
      timezone: start.timezone,
    };
  }
  const statusRaw = typeof googleEvent.status === 'string' ? googleEvent.status : 'confirmed';
  const status = normalizeStatus(statusRaw.toUpperCase());
  const transparency = typeof googleEvent.transparency === 'string'
    ? googleEvent.transparency.toLowerCase()
    : 'opaque';
  return {
    external_uid: id,
    start: start.instant,
    end: end.instant,
    timezone: start.timezone,
    summary: boundedSummary(googleEvent.summary),
    busy: transparency !== 'transparent',
    status,
    recurrence_rule: null,
  };
}

/**
 * Normalize a list of Google events, skipping invalid rows.
 *
 * @param {unknown[]} items
 * @returns {NormalizedCalendarEvent[]}
 */
export function normalizeGoogleEvents(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (items.length > MAX_EVENTS) {
    throw new RangeError(`Google event list exceeds ${MAX_EVENTS} items`);
  }
  /** @type {NormalizedCalendarEvent[]} */
  const out = [];
  for (const item of items) {
    const normalized = normalizeGoogleEvent(/** @type {Record<string, unknown>} */ (item));
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Returns true when a normalized event should be tombstoned (cancelled).
 *
 * @param {NormalizedCalendarEvent} event
 * @returns {boolean}
 */
export function isGoogleEventTombstone(event) {
  return event.status === 'cancelled';
}
