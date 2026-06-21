/**
 * Pure ICS (iCalendar RFC 5545 subset) parser and event normalizer.
 *
 * No network, no OAuth, no filesystem I/O — callers pass ICS text only.
 * Output shape matches Calendar Events v0 `CalendarEvent` fields except
 * `event_id` and `source_calendar_id` (assigned by the store layer in 1B).
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — Phase 1A
 */

/** @typedef {'confirmed' | 'cancelled' | 'tentative'} CalendarEventStatus */

/**
 * @typedef {Object} NormalizedCalendarEvent
 * @property {string} external_uid — Provider UID for dedup
 * @property {string} start — UTC ISO8601 instant
 * @property {string} end — UTC ISO8601 instant
 * @property {string} timezone — IANA timezone id used for display semantics
 * @property {string|null} summary
 * @property {boolean} busy — false when TRANSP=TRANSPARENT
 * @property {CalendarEventStatus} status
 * @property {string|null} recurrence_rule — Raw RRULE string; expansion deferred
 */

/**
 * @typedef {Object} ParseIcsOptions
 * @property {string} [defaultTimezone='UTC'] — Used for floating DATE-TIME values
 * @property {number} [maxEvents=5000] — Hard cap to bound hostile payloads
 */

const MAX_ICS_BYTES = 5 * 1024 * 1024;
const MAX_LINE_LENGTH = 8192;
const MAX_PROPERTY_VALUE_LENGTH = 4096;

/**
 * Parse ICS text into normalized calendar events.
 *
 * @param {string} icsText
 * @param {ParseIcsOptions} [options]
 * @returns {NormalizedCalendarEvent[]}
 */
export function parseIcsToEvents(icsText, options = {}) {
  if (typeof icsText !== 'string') {
    throw new TypeError('icsText must be a string');
  }
  if (icsText.length > MAX_ICS_BYTES) {
    throw new RangeError(`ICS payload exceeds ${MAX_ICS_BYTES} bytes`);
  }

  const defaultTimezone = normalizeTimezoneId(options.defaultTimezone ?? 'UTC');
  const maxEvents = options.maxEvents ?? 5000;
  const unfolded = unfoldIcsLines(icsText);
  const components = extractVevents(unfolded);
  if (components.length > maxEvents) {
    throw new RangeError(`ICS contains ${components.length} VEVENT components; max is ${maxEvents}`);
  }

  /** @type {NormalizedCalendarEvent[]} */
  const events = [];
  for (const props of components) {
    const normalized = normalizeVevent(props, defaultTimezone);
    if (normalized) {
      events.push(normalized);
    }
  }
  return events;
}

/**
 * RFC 5545 line unfolding: CRLF + single space/tab continues the prior line.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function unfoldIcsLines(text) {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  /** @type {string[]} */
  const out = [];
  for (const line of rawLines) {
    if (line.length > MAX_LINE_LENGTH) {
      throw new RangeError(`ICS line exceeds ${MAX_LINE_LENGTH} characters`);
    }
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * @param {string[]} lines
 * @returns {{ name: string, value: string, params: Record<string, string> }[][]}
 */
function extractVevents(lines) {
  /** @type {{ name: string, value: string, params: Record<string, string> }[][]} */
  const events = [];
  /** @type {{ name: string, value: string, params: Record<string, string> }[] | null} */
  let current = null;
  let depth = 0;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      if (current) {
        throw new SyntaxError('Nested VEVENT components are not supported');
      }
      current = [];
      depth = 1;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (!current || depth !== 1) {
        throw new SyntaxError('END:VEVENT without matching BEGIN:VEVENT');
      }
      events.push(current);
      current = null;
      depth = 0;
      continue;
    }
    if (!current) {
      continue;
    }
    const parsed = parsePropertyLine(line);
    if (parsed) {
      current.push(parsed);
    }
  }

  if (current) {
    throw new SyntaxError('Unclosed VEVENT component');
  }
  return events;
}

/**
 * @param {string} line
 * @returns {{ name: string, value: string, params: Record<string, string> } | null}
 */
export function parsePropertyLine(line) {
  if (!line || line.startsWith('BEGIN:') || line.startsWith('END:')) {
    return null;
  }
  const colon = line.indexOf(':');
  if (colon <= 0) {
    return null;
  }

  const left = line.slice(0, colon);
  const value = unescapeIcsText(line.slice(colon + 1));
  if (value.length > MAX_PROPERTY_VALUE_LENGTH) {
    throw new RangeError(`ICS property value exceeds ${MAX_PROPERTY_VALUE_LENGTH} characters`);
  }

  const semi = left.indexOf(';');
  const name = (semi === -1 ? left : left.slice(0, semi)).toUpperCase();
  /** @type {Record<string, string>} */
  const params = {};
  if (semi !== -1) {
    const paramPart = left.slice(semi + 1);
    for (const chunk of paramPart.split(';')) {
      const eq = chunk.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = chunk.slice(0, eq).toUpperCase();
      params[key] = chunk.slice(eq + 1);
    }
  }
  return { name, value, params };
}

/**
 * @param {string} value
 * @returns {string}
 */
export function unescapeIcsText(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * @param {{ name: string, value: string, params: Record<string, string> }[]} props
 * @param {string} defaultTimezone
 * @returns {NormalizedCalendarEvent | null}
 */
function normalizeVevent(props, defaultTimezone) {
  const uid = getProperty(props, 'UID')?.value;
  if (!uid) {
    return null;
  }

  const dtStartProp = getProperty(props, 'DTSTART');
  if (!dtStartProp) {
    return null;
  }

  const dtStart = parseIcsDateTimeProp('DTSTART', dtStartProp, defaultTimezone);
  let endInstant;
  const dtEndProp = getProperty(props, 'DTEND');
  const durationProp = getProperty(props, 'DURATION');

  if (dtEndProp) {
    const dtEnd = parseIcsDateTimeProp('DTEND', dtEndProp, defaultTimezone);
    endInstant = dtEnd.instant;
    if (dtStart.isDate && dtEnd.isDate) {
      // DTEND is exclusive for all-day events — use as-is (already midnight UTC of end date).
      endInstant = dtEnd.instant;
    }
  } else if (durationProp) {
    endInstant = addDuration(dtStart.instant, durationProp.value);
  } else if (dtStart.isDate) {
    endInstant = addDaysUtc(dtStart.instant, 1);
  } else {
    endInstant = addMinutesUtc(dtStart.instant, 60);
  }

  if (endInstant <= dtStart.instant) {
    endInstant = dtStart.isDate ? addDaysUtc(dtStart.instant, 1) : addMinutesUtc(dtStart.instant, 60);
  }

  const statusProp = getProperty(props, 'STATUS');
  const status = normalizeStatus(statusProp?.value);
  const transpProp = getProperty(props, 'TRANSP');
  const transp = (transpProp?.value ?? 'OPAQUE').toUpperCase();
  const summaryProp = getProperty(props, 'SUMMARY');
  const rruleProp = getProperty(props, 'RRULE');

  return {
    external_uid: uid,
    start: dtStart.instant.toISOString(),
    end: endInstant.toISOString(),
    timezone: dtStart.timezone,
    summary: summaryProp?.value ?? null,
    busy: transp !== 'TRANSPARENT',
    status,
    recurrence_rule: rruleProp?.value ?? null,
  };
}

/**
 * @param {{ name: string, value: string, params: Record<string, string> }[]} props
 * @param {string} name
 * @returns {{ name: string, value: string, params: Record<string, string> } | undefined}
 */
function getProperty(props, name) {
  const upper = name.toUpperCase();
  return props.find((p) => p.name === upper);
}

/**
 * @param {string} propName
 * @param {{ value: string, params: Record<string, string> }} prop
 * @param {string} defaultTimezone
 * @returns {{ instant: Date, timezone: string, isDate: boolean }}
 */
function parseIcsDateTimeProp(propName, prop, defaultTimezone) {
  const valueType = (prop.params.VALUE ?? '').toUpperCase();
  const tzid = prop.params.TZID;
  const trimmed = prop.value.trim();
  const isDate = valueType === 'DATE' || (trimmed.length === 8 && /^\d{8}$/.test(trimmed));
  return parseIcsDateTime(propName, trimmed, tzid, defaultTimezone, isDate);
}

/**
 * @param {string} propName
 * @param {string} raw
 * @param {string|undefined} tzidFromParam
 * @param {string} defaultTimezone
 * @param {boolean} [isDate=false]
 * @returns {{ instant: Date, timezone: string, isDate: boolean }}
 */
function parseIcsDateTime(propName, raw, tzidFromParam, defaultTimezone, isDate = false) {
  const trimmed = raw.trim();
  const dateOnly = isDate || (trimmed.length === 8 && /^\d{8}$/.test(trimmed));

  if (dateOnly) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    const day = Number(trimmed.slice(6, 8));
    const tz = normalizeTimezoneId(tzidFromParam ?? defaultTimezone);
    const instant = zonedLocalToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, tz);
    return { instant, timezone: tz, isDate: true };
  }

  const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) {
    throw new SyntaxError(`${propName} has unsupported datetime format`);
  }

  const [, ys, ms, ds, hs, mins, ss, zulu] = match;
  const components = {
    year: Number(ys),
    month: Number(ms),
    day: Number(ds),
    hour: Number(hs),
    minute: Number(mins),
    second: Number(ss),
  };

  if (zulu === 'Z') {
    const instant = new Date(Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
      components.second,
    ));
    return { instant, timezone: 'UTC', isDate: false };
  }

  const tz = normalizeTimezoneId(tzidFromParam ?? defaultTimezone);
  const instant = zonedLocalToUtc(components, tz);
  return { instant, timezone: tz, isDate: false };
}

/**
 * Convert wall-clock components in an IANA zone to a UTC instant.
 *
 * @param {{ year: number, month: number, day: number, hour: number, minute: number, second: number }} local
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedLocalToUtc(local, timeZone) {
  validateLocalComponents(local);
  const targetMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let utcMs = targetMs;

  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(new Date(utcMs), timeZone);
    const shownMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const diff = targetMs - shownMs;
    if (diff === 0) {
      break;
    }
    utcMs += diff;
  }

  return new Date(utcMs);
}

/**
 * @param {Date} date
 * @param {string} timeZone
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
function getZonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  /** @type {Record<string, string>} */
  const bag = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/**
 * @param {{ year: number, month: number, day: number, hour: number, minute: number, second: number }} local
 */
function validateLocalComponents(local) {
  for (const [key, val] of Object.entries(local)) {
    if (!Number.isInteger(val)) {
      throw new RangeError(`Invalid calendar component ${key}`);
    }
  }
  if (local.month < 1 || local.month > 12 || local.day < 1 || local.day > 31) {
    throw new RangeError('Invalid calendar date');
  }
}

/**
 * @param {string} tz
 * @returns {string}
 */
export function normalizeTimezoneId(tz) {
  const trimmed = String(tz).trim();
  if (!trimmed) {
    return 'UTC';
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: trimmed });
  } catch {
    throw new RangeError(`Unknown IANA timezone: ${trimmed}`);
  }
  return trimmed;
}

/**
 * @param {string|undefined|null} statusRaw
 * @returns {CalendarEventStatus}
 */
export function normalizeStatus(statusRaw) {
  const upper = (statusRaw ?? 'CONFIRMED').toUpperCase();
  if (upper === 'CANCELLED') {
    return 'cancelled';
  }
  if (upper === 'TENTATIVE') {
    return 'tentative';
  }
  return 'confirmed';
}

/**
 * @param {Date} instant
 * @param {number} days
 * @returns {Date}
 */
function addDaysUtc(instant, days) {
  const d = new Date(instant.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * @param {Date} instant
 * @param {number} minutes
 * @returns {Date}
 */
function addMinutesUtc(instant, minutes) {
  return new Date(instant.getTime() + minutes * 60_000);
}

/**
 * Parse ISO 8601 DURATION subset used by ICS (PnDTnHnMnS).
 *
 * @param {Date} start
 * @param {string} duration
 * @returns {Date}
 */
export function addDuration(start, duration) {
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) {
    throw new SyntaxError('Unsupported DURATION format');
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const ms = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  return new Date(start.getTime() + ms);
}
