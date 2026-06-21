/**
 * Tier 3 — E2E: full VCALENDAR walkthrough mirroring a user export → normalized store-ready rows.
 * No network; simulates the 1B ingest boundary.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIcsToEvents } from '../lib/calendar/ics-normalizer.mjs';
import { SOURCE_CALENDAR_DEFAULTS } from '../lib/calendar/source-calendar-defaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'calendar');

/**
 * Simulates the 1B store layer assigning ids — not part of the normalizer itself.
 *
 * @param {import('../lib/calendar/ics-normalizer.mjs').NormalizedCalendarEvent[]} events
 * @param {string} sourceCalendarId
 * @returns {object[]}
 */
function attachStoreIds(events, sourceCalendarId) {
  return events.map((e) => ({
    event_id: `evt_${sourceCalendarId}_${e.external_uid}`,
    source_calendar_id: sourceCalendarId,
    ...e,
    linked_note_paths: null,
    deleted_at: e.status === 'cancelled' ? e.start : null,
  }));
}

describe('E2E — user ICS export to store-ready records', () => {
  it('produces dedup-friendly rows with stable external_uid', () => {
    const ics = fs.readFileSync(path.join(fixtureDir, 'multi-event.ics'), 'utf8');
    const normalized = parseIcsToEvents(ics, { defaultTimezone: 'America/Los_Angeles' });
    const stored = attachStoreIds(normalized, 'cal_work');

    assert.equal(stored.length, 2);
    for (const row of stored) {
      assert.match(row.event_id, /^evt_cal_work_/);
      assert.equal(row.source_calendar_id, 'cal_work');
      assert.ok(row.start.endsWith('Z'));
      assert.ok(row.end.endsWith('Z'));
      assert.ok(typeof row.busy === 'boolean');
    }
  });

  it('applies v0 SourceCalendar defaults at connect time', () => {
    const toggles = { ...SOURCE_CALENDAR_DEFAULTS };
    assert.equal(toggles.enabled_for_display, true);
    assert.equal(toggles.enabled_for_agents, false);
    assert.equal(toggles.agent_context_tier_max, 0);
  });
});
