/**
 * Tier 1 — UNIT: calendar event store helpers.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEventId,
  importIcsIntoVault,
  queryStoredEvents,
  listSourceCalendars,
  getCalendarStorePath,
} from '../lib/calendar/event-store.mjs';
import { SOURCE_CALENDAR_DEFAULTS } from '../lib/calendar/source-calendar-defaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-store');

describe('buildEventId', () => {
  it('is stable for the same source calendar + external uid', () => {
    const a = buildEventId('cal_a', 'uid@x');
    const b = buildEventId('cal_a', 'uid@x');
    assert.equal(a, b);
    assert.match(a, /^evt_[0-9a-f]{24}$/);
  });
});

describe('importIcsIntoVault', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt@test
DTSTART:20260618T170000Z
DTEND:20260618T173000Z
SUMMARY:Team standup
END:VEVENT
END:VCALENDAR`;

  it('creates a source calendar with v0 defaults and stores events', () => {
    const result = importIcsIntoVault(dataDir, vaultId, { icsText: ics, displayName: 'Work' });
    assert.equal(result.imported, 1);
    assert.equal(result.updated, 0);
    assert.ok(result.source_calendar_id.startsWith('cal_'));

    const calendars = listSourceCalendars(dataDir, vaultId);
    assert.equal(calendars.length, 1);
    assert.equal(calendars[0].display_name, 'Work');
    assert.equal(calendars[0].enabled_for_display, SOURCE_CALENDAR_DEFAULTS.enabled_for_display);
    assert.equal(calendars[0].enabled_for_agents, SOURCE_CALENDAR_DEFAULTS.enabled_for_agents);

    const events = queryStoredEvents(dataDir, vaultId, {
      fromIso: '2026-06-01T00:00:00.000Z',
      toIso: '2026-06-30T23:59:59.999Z',
      displayOnly: true,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, 'Team standup');
    assert.ok(fs.existsSync(getCalendarStorePath(dataDir)));
  });

  it('upserts into an existing source calendar on re-import', () => {
    const first = importIcsIntoVault(dataDir, vaultId, { icsText: ics });
    const second = importIcsIntoVault(dataDir, vaultId, {
      icsText: ics,
      sourceCalendarId: first.source_calendar_id,
    });
    assert.equal(second.imported, 0);
    assert.equal(second.updated, 1);
  });
});
