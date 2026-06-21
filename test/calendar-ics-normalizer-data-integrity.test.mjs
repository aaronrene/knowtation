/**
 * Tier 5 — DATA INTEGRITY: dedup keys, timezone boundaries, deterministic output.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcsToEvents, zonedLocalToUtc } from '../lib/calendar/ics-normalizer.mjs';

describe('Data integrity — deterministic parse', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dedup@x
DTSTART:20260308T080000Z
DTEND:20260308T090000Z
SUMMARY:Same
END:VEVENT
END:VCALENDAR`;

  it('returns identical output on repeated parse', () => {
    const a = parseIcsToEvents(ics);
    const b = parseIcsToEvents(ics);
    assert.deepEqual(a, b);
  });

  it('preserves external_uid for dedup', () => {
    const [event] = parseIcsToEvents(ics);
    assert.equal(event.external_uid, 'dedup@x');
  });
});

describe('Data integrity — timezone boundary (DST spring forward)', () => {
  it('maps ambiguous local time consistently via IANA zone', () => {
    // Second Sunday in March 2026 — US DST begins 2026-03-08
    const utc = zonedLocalToUtc(
      { year: 2026, month: 3, day: 8, hour: 3, minute: 30, second: 0 },
      'America/Los_Angeles',
    );
    assert.equal(utc.toISOString(), '2026-03-08T10:30:00.000Z');
  });
});

describe('Data integrity — all-day exclusive DTEND', () => {
  it('end instant is after start for single-day event', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:day@x
DTSTART;VALUE=DATE:20260601
DTEND;VALUE=DATE:20260602
END:VEVENT
END:VCALENDAR`;
    const [event] = parseIcsToEvents(ics, { defaultTimezone: 'UTC' });
    assert.ok(new Date(event.end) > new Date(event.start));
  });
});

describe('Data integrity — cancelled events retain status without dropping row', () => {
  it('keeps cancelled events for tombstone indexing', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:c@x
DTSTART:20260601T120000Z
DTEND:20260601T130000Z
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;
    const [event] = parseIcsToEvents(ics);
    assert.equal(event.status, 'cancelled');
  });
});
