/**
 * Unified calendar timeline merge — notes by date + stored external events.
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md — GET /api/v1/calendar/timeline
 */

import { getNotesWithMeta, filterNotesByListOptions } from '../list-notes.mjs';
import { queryStoredEvents, getVaultCalendarStore, sourceCalendarForClient } from './event-store.mjs';

/** @typedef {'note' | 'event'} TimelineKind */

const VALID_LAYERS = new Set(['notes', 'events']);

/**
 * @typedef {Object} TimelineNoteItem
 * @property {'note'} kind
 * @property {string} date — YYYY-MM-DD
 * @property {string} path
 * @property {string|null} title
 * @property {string|null} project
 * @property {string[]} tags
 * @property {string} sort_at — ISO8601 for ordering
 */

/**
 * @typedef {Object} TimelineEventItem
 * @property {'event'} kind
 * @property {string} event_id
 * @property {string} source_calendar_id
 * @property {string} start
 * @property {string} end
 * @property {string} timezone
 * @property {string|null} summary
 * @property {boolean} busy
 * @property {'confirmed'|'cancelled'|'tentative'} status
 * @property {string|null} calendar_label
 * @property {string} sort_at
 */

/**
 * Parse `from` / `to` query values into UTC ISO bounds and YYYY-MM-DD day keys.
 *
 * @param {string} fromRaw
 * @param {string} toRaw
 * @returns {{ fromIso: string, toIso: string, fromDate: string, toDate: string }}
 */
export function parseTimelineRange(fromRaw, toRaw) {
  const fromParsed = parseBoundary(fromRaw, 'start');
  const toParsed = parseBoundary(toRaw, 'end');
  if (Date.parse(fromParsed.iso) >= Date.parse(toParsed.iso)) {
    throw new RangeError('`from` must be before `to`');
  }
  return {
    fromIso: fromParsed.iso,
    toIso: toParsed.iso,
    fromDate: fromParsed.date,
    toDate: toParsed.date,
  };
}

/**
 * @param {string} raw
 * @param {'start'|'end'} edge
 */
function parseBoundary(raw, edge) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new RangeError('`from` and `to` are required');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return {
      date: trimmed,
      iso: edge === 'start' ? `${trimmed}T00:00:00.000Z` : `${trimmed}T23:59:59.999Z`,
    };
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new RangeError('Invalid date boundary');
  }
  const date = new Date(ms).toISOString().slice(0, 10);
  return { date, iso: new Date(ms).toISOString() };
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseTimelineLayers(raw) {
  if (raw == null || raw === '') {
    return ['notes', 'events'];
  }
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => String(v).split(','))
    : String(raw).split(',');
  const layers = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  if (layers.length === 0) {
    return ['notes', 'events'];
  }
  for (const layer of layers) {
    if (!VALID_LAYERS.has(layer)) {
      throw new RangeError(`Unsupported timeline layer: ${layer}`);
    }
  }
  return layers;
}

/**
 * @param {unknown} raw
 * @returns {string[]|undefined}
 */
export function parseSourceCalendarIds(raw) {
  if (raw == null || raw === '') return undefined;
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => String(v).split(','))
    : String(raw).split(',');
  const ids = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  return ids.length ? ids : undefined;
}

/**
 * @param {{ date?: string|null, updated?: string|null, frontmatter?: { date?: string, knowtation_edited_at?: string, title?: string } }} note
 * @returns {string}
 */
export function noteCalendarDayKey(note) {
  const fm = note.frontmatter ?? {};
  const raw = note.date ?? fm.date ?? fm.knowtation_edited_at ?? note.updated ?? '';
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return s.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build merged timeline items for a vault and range.
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   vaultPath?: string,
 *   vaultConfig?: { ignore?: string[] },
 *   noteRecords?: Array<{
 *     path: string,
 *     frontmatter?: object,
 *     date?: string|null,
 *     updated?: string|null,
 *     project?: string|null,
 *     tags?: string[],
 *   }>,
 *   from: string,
 *   to: string,
 *   layers?: unknown,
 *   sourceCalendarIds?: unknown,
 *   scope?: { projects?: string[], folders?: string[] },
 * }} input
 */
export function buildCalendarTimeline(input) {
  const range = parseTimelineRange(input.from, input.to);
  const layers = parseTimelineLayers(input.layers);
  const sourceCalendarIds = parseSourceCalendarIds(input.sourceCalendarIds);

  /** @type {(TimelineNoteItem|TimelineEventItem)[]} */
  const items = [];

  if (layers.includes('notes')) {
    const baseNotes =
      input.noteRecords != null
        ? input.noteRecords
        : getNotesWithMeta(input.vaultPath ?? '', input.vaultConfig ?? {});
    const notes = filterNotesByListOptions(baseNotes, { since: range.fromDate, until: range.toDate });
    const scoped = input.scope?.projects?.length || input.scope?.folders?.length
      ? applyNoteScope(notes, input.scope)
      : notes;

    for (const note of scoped) {
      const day = noteCalendarDayKey(note);
      if (!day || day < range.fromDate || day > range.toDate) continue;
      const fm = note.frontmatter ?? {};
      items.push({
        kind: 'note',
        date: day,
        path: note.path,
        title: typeof fm.title === 'string' ? fm.title : null,
        project: note.project ?? null,
        tags: note.tags ?? [],
        sort_at: `${day}T00:00:00.000Z`,
      });
    }
  }

  if (layers.includes('events')) {
    const vaultStore = getVaultCalendarStore(input.dataDir, input.vaultId);
    const labelByCalendarId = new Map(
      vaultStore.source_calendars.map((c) => [c.source_calendar_id, c.display_name]),
    );
    const events = queryStoredEvents(input.dataDir, input.vaultId, {
      fromIso: range.fromIso,
      toIso: range.toIso,
      sourceCalendarIds,
      displayOnly: true,
    });
    for (const event of events) {
      items.push({
        kind: 'event',
        event_id: event.event_id,
        source_calendar_id: event.source_calendar_id,
        start: event.start,
        end: event.end,
        timezone: event.timezone,
        summary: event.summary,
        busy: event.busy,
        status: event.status,
        calendar_label: labelByCalendarId.get(event.source_calendar_id) ?? null,
        sort_at: event.start,
      });
    }
  }

  items.sort((a, b) => {
    const cmp = a.sort_at.localeCompare(b.sort_at);
    if (cmp !== 0) return cmp;
    if (a.kind !== b.kind) return a.kind === 'note' ? -1 : 1;
    if (a.kind === 'note' && b.kind === 'note') return a.path.localeCompare(b.path);
    if (a.kind === 'event' && b.kind === 'event') return a.event_id.localeCompare(b.event_id);
    return 0;
  });

  return {
    schema: 'knowtation.calendar_timeline/v0',
    vault_id: input.vaultId,
    from: range.fromDate,
    to: range.toDate,
    layers,
    items,
  };
}

/**
 * @param {Array<{ path: string }>} notes
 * @param {{ projects?: string[], folders?: string[] }} scope
 */
function applyNoteScope(notes, scope) {
  let out = notes.slice();
  if (scope.projects?.length) {
    const set = new Set(scope.projects);
    out = out.filter((n) => {
      const project = /** @type {{ project?: string }} */ (n).project;
      return project && set.has(project);
    });
  }
  if (scope.folders?.length) {
    out = out.filter((n) =>
      scope.folders.some((folder) => n.path === folder || n.path.startsWith(`${folder}/`)),
    );
  }
  return out;
}

/**
 * List source calendars for API responses (no oauth_ref).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 */
export function listSourceCalendarsForClient(dataDir, vaultId) {
  const vaultStore = getVaultCalendarStore(dataDir, vaultId);
  return vaultStore.source_calendars.map(sourceCalendarForClient);
}
