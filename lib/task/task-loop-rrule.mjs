/**
 * Task loop RRULE recurrence validator + occurrence projection (Phase 2G-f-b — inert stub).
 *
 * Knowtation-canonical RRULE subset per TASK-LOOP-RRULE-RECURRENCE-CONTRACT-2G-f.md.
 * Live store write rejection when {@link TASK_LOOP_RRULE_ENABLED} is false.
 *
 * @see docs/TASK-LOOP-RRULE-RECURRENCE-CONTRACT-2G-f.md
 */

/** Compile-time posture — Tier 3 BUNDLED_2G_LIVE 2026-06-25. */
export const TASK_LOOP_RRULE_ENABLED = true;

const ALLOWED_FREQ = /** @type {const} */ (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const REJECTED_TOKENS = ['BYSETPOS', 'BYHOUR', 'BYMINUTE', 'BYYEARDAY', 'WKST', 'EXRULE'];
const ALLOWED_RRULE_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL']);
const MAX_RRULE_LENGTH = 512;

const DAY_MAP = /** @type {Record<string, number>} */ ({
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
});

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isIso8601(value) {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * @param {string} rrule
 * @returns {Record<string, string>}
 */
function parseRruleTokens(rrule) {
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const part of rrule.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      throw new Error('malformed_rrule');
    }
    const key = trimmed.slice(0, eq).toUpperCase();
    const value = trimmed.slice(eq + 1).trim();
    tokens[key] = value;
  }
  return tokens;
}

/**
 * @param {object} recurrence
 * @param {string} seriesTimezone
 * @returns {{ ok: true, recurrence: object } | { ok: false, code: string, detail: string }}
 */
export function validateTaskLoopRrule(recurrence, seriesTimezone) {
  if (!recurrence || typeof recurrence !== 'object') {
    return { ok: false, code: 'invalid_rrule', detail: 'recurrence' };
  }
  const row = /** @type {Record<string, unknown>} */ (recurrence);
  if (row.kind !== 'rrule') {
    return { ok: false, code: 'invalid_rrule', detail: 'kind' };
  }
  if (typeof row.rrule !== 'string' || !row.rrule.trim()) {
    return { ok: false, code: 'invalid_rrule', detail: 'rrule' };
  }
  if (row.rrule.length > MAX_RRULE_LENGTH) {
    return { ok: false, code: 'invalid_rrule', detail: 'oversized' };
  }
  if (!isIso8601(row.dtstart)) {
    return { ok: false, code: 'invalid_rrule', detail: 'dtstart' };
  }
  if (typeof row.anchor_tz !== 'string' || !row.anchor_tz.trim()) {
    return { ok: false, code: 'invalid_rrule', detail: 'anchor_tz' };
  }
  if (row.anchor_tz !== seriesTimezone) {
    return { ok: false, code: 'invalid_rrule', detail: 'timezone_mismatch' };
  }

  /** @type {string[]} */
  const exdates = [];
  if (row.exdates != null) {
    if (!Array.isArray(row.exdates)) {
      return { ok: false, code: 'invalid_rrule', detail: 'exdates' };
    }
    const seen = new Set();
    for (const ex of row.exdates) {
      if (!isIso8601(ex)) {
        return { ok: false, code: 'invalid_rrule', detail: 'exdate' };
      }
      if (seen.has(ex)) {
        return { ok: false, code: 'invalid_rrule', detail: 'duplicate_exdate' };
      }
      seen.add(ex);
      exdates.push(String(ex));
    }
  }

  let tokens;
  try {
    tokens = parseRruleTokens(String(row.rrule));
  } catch {
    return { ok: false, code: 'invalid_rrule', detail: 'parse' };
  }

  for (const rejected of REJECTED_TOKENS) {
    if (tokens[rejected] != null) {
      return { ok: false, code: 'invalid_rrule', detail: rejected };
    }
  }

  for (const key of Object.keys(tokens)) {
    if (!ALLOWED_RRULE_KEYS.has(key)) {
      return { ok: false, code: 'invalid_rrule', detail: key };
    }
  }

  const freq = tokens.FREQ;
  if (!freq || !ALLOWED_FREQ.includes(/** @type {typeof ALLOWED_FREQ[number]} */ (freq))) {
    return { ok: false, code: 'invalid_rrule', detail: 'FREQ' };
  }

  if (tokens.INTERVAL != null) {
    const interval = Number.parseInt(tokens.INTERVAL, 10);
    if (!Number.isInteger(interval) || interval < 1) {
      return { ok: false, code: 'invalid_rrule', detail: 'INTERVAL' };
    }
  }

  if (tokens.BYDAY != null && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
    return { ok: false, code: 'invalid_rrule', detail: 'BYDAY' };
  }

  if (tokens.BYMONTHDAY != null && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return { ok: false, code: 'invalid_rrule', detail: 'BYMONTHDAY' };
  }

  if (tokens.COUNT != null) {
    const count = Number.parseInt(tokens.COUNT, 10);
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, code: 'invalid_rrule', detail: 'COUNT' };
    }
  }

  /** @type {object} */
  const canonical = {
    kind: 'rrule',
    rrule: String(row.rrule),
    dtstart: String(row.dtstart),
    anchor_tz: String(row.anchor_tz),
  };
  if (exdates.length > 0) {
    canonical.exdates = exdates;
  }
  if (typeof row.source_ical === 'string' && row.source_ical.trim()) {
    canonical.source_ical = row.source_ical;
  }

  return { ok: true, recurrence: canonical };
}

/**
 * @param {Date} date
 * @returns {string}
 */
function isoWeekKey(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * @param {object} recurrence
 * @param {{ until_at?: string|null }} series
 * @param {string} afterInstant
 * @returns {{ occurrenceAt: string, occurrenceKey: string, skippedExdates: number } | null}
 */
export function projectNextOccurrence(recurrence, series, afterInstant) {
  const validation = validateTaskLoopRrule(recurrence, recurrence.anchor_tz);
  if (!validation.ok) {
    return null;
  }

  const row = validation.recurrence;
  const tokens = parseRruleTokens(row.rrule);
  const freq = tokens.FREQ;
  const interval = tokens.INTERVAL != null ? Number.parseInt(tokens.INTERVAL, 10) : 1;
  const after = new Date(afterInstant);
  const anchor = new Date(row.dtstart);
  /** @type {Set<string>} */
  const exdateSet = new Set((row.exdates ?? []).map(String));

  if (series.until_at != null && new Date(series.until_at).getTime() < after.getTime()) {
    return null;
  }

  if (freq === 'WEEKLY') {
    const byday = tokens.BYDAY ? tokens.BYDAY.split(',') : ['MO'];
    const targetDays = byday
      .map((d) => DAY_MAP[d.trim().slice(0, 2)])
      .filter((d) => d != null);

    let cursor = new Date(Math.max(anchor.getTime(), after.getTime() + 1));
    cursor.setUTCHours(anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), 0);

    for (let guard = 0; guard < 400; guard += 1) {
      const day = cursor.getUTCDay();
      if (targetDays.includes(day) && cursor.getTime() > after.getTime()) {
        const iso = cursor.toISOString();
        if (!exdateSet.has(iso)) {
          return {
            occurrenceAt: iso,
            occurrenceKey: isoWeekKey(cursor),
            skippedExdates: exdateSet.size,
          };
        }
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return null;
  }

  if (freq === 'DAILY') {
    let cursor = new Date(Math.max(anchor.getTime(), after.getTime() + 1));
    for (let guard = 0; guard < 400; guard += 1) {
      const iso = cursor.toISOString();
      if (!exdateSet.has(iso)) {
        const y = cursor.getUTCFullYear();
        const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cursor.getUTCDate()).padStart(2, '0');
        return {
          occurrenceAt: iso,
          occurrenceKey: `${y}-${m}-${d}`,
          skippedExdates: exdateSet.size,
        };
      }
      cursor = new Date(cursor.getTime() + interval * 24 * 60 * 60 * 1000);
    }
  }

  return null;
}
