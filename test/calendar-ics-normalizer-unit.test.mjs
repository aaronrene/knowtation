/**
 * Tier 1 — UNIT: ICS normalizer and SourceCalendar defaults in isolation.
 * Reference: docs/CALENDAR-EVENTS-V0-SPEC.md — Phase 1A
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIcsToEvents,
  unfoldIcsLines,
  parsePropertyLine,
  unescapeIcsText,
  normalizeStatus,
  normalizeTimezoneId,
  zonedLocalToUtc,
  addDuration,
} from '../lib/calendar/ics-normalizer.mjs';
import {
  SOURCE_CALENDAR_DEFAULTS,
  buildSourceCalendarDefaults,
  isAgentTierAllowed,
  AGENT_CONTEXT_TIERS,
} from '../lib/calendar/source-calendar-defaults.mjs';
import { redactEventForAgentTier } from '../lib/calendar/agent-context-tier.mjs';

describe('SOURCE_CALENDAR_DEFAULTS', () => {
  it('defaults display on, agents off, tier 0', () => {
    assert.equal(SOURCE_CALENDAR_DEFAULTS.enabled_for_display, true);
    assert.equal(SOURCE_CALENDAR_DEFAULTS.enabled_for_agents, false);
    assert.equal(SOURCE_CALENDAR_DEFAULTS.agent_context_tier_max, 0);
    assert.equal(SOURCE_CALENDAR_DEFAULTS.enabled_for_sync, true);
  });

  it('buildSourceCalendarDefaults rejects invalid tier', () => {
    assert.throws(() => buildSourceCalendarDefaults({ agent_context_tier_max: 9 }), /0–4/);
  });

  it('isAgentTierAllowed is false for tier > 0 when agents disabled', () => {
    const cal = buildSourceCalendarDefaults();
    assert.equal(isAgentTierAllowed(cal, 0), true);
    assert.equal(isAgentTierAllowed(cal, 1), false);
    assert.equal(isAgentTierAllowed(cal, 2), false);
  });
});

describe('unfoldIcsLines', () => {
  it('joins folded continuation lines per RFC 5545 (removes CRLF + single whitespace)', () => {
    const lines = unfoldIcsLines('SUMMARY:Hello wo\r\n rld\r\nUID:x');
    assert.equal(lines[0], 'SUMMARY:Hello world');
    assert.equal(lines[1], 'UID:x');
  });
});

describe('parsePropertyLine', () => {
  it('parses name, params, and value', () => {
    const p = parsePropertyLine('DTSTART;TZID=America/Los_Angeles;VALUE=DATE:20260618');
    assert.ok(p);
    assert.equal(p.name, 'DTSTART');
    assert.equal(p.params.TZID, 'America/Los_Angeles');
    assert.equal(p.params.VALUE, 'DATE');
    assert.equal(p.value, '20260618');
  });
});

describe('unescapeIcsText', () => {
  it('unescapes ICS text sequences', () => {
    assert.equal(unescapeIcsText('a\\,b\\;c\\n d\\\\e'), 'a,b;c\n d\\e');
  });
});

describe('normalizeStatus', () => {
  it('maps ICS status strings to v0 enum', () => {
    assert.equal(normalizeStatus('CANCELLED'), 'cancelled');
    assert.equal(normalizeStatus('TENTATIVE'), 'tentative');
    assert.equal(normalizeStatus(undefined), 'confirmed');
  });
});

describe('normalizeTimezoneId', () => {
  it('accepts valid IANA ids and rejects unknown', () => {
    assert.equal(normalizeTimezoneId('UTC'), 'UTC');
    assert.throws(() => normalizeTimezoneId('Not/A/Timezone'), /Unknown IANA/);
  });
});

describe('zonedLocalToUtc', () => {
  it('converts Pacific wall time to UTC (PDT in June)', () => {
    const utc = zonedLocalToUtc(
      { year: 2026, month: 6, day: 18, hour: 9, minute: 0, second: 0 },
      'America/Los_Angeles',
    );
    assert.equal(utc.toISOString(), '2026-06-18T16:00:00.000Z');
  });
});

describe('addDuration', () => {
  it('adds ISO duration to start instant', () => {
    const start = new Date('2026-06-23T10:00:00.000Z');
    const end = addDuration(start, 'PT45M');
    assert.equal(end.toISOString(), '2026-06-23T10:45:00.000Z');
  });
});

describe('parseIcsToEvents — minimal inline ICS', () => {
  const minimal = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test@x
DTSTART:20260101T120000Z
DTEND:20260101T130000Z
SUMMARY:Hello
END:VEVENT
END:VCALENDAR`;

  it('returns one normalized event', () => {
    const events = parseIcsToEvents(minimal);
    assert.equal(events.length, 1);
    assert.equal(events[0].external_uid, 'test@x');
    assert.equal(events[0].summary, 'Hello');
    assert.equal(events[0].busy, true);
    assert.equal(events[0].status, 'confirmed');
  });

  it('skips VEVENT without UID or DTSTART', () => {
    const bad = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:No uid
END:VEVENT
END:VCALENDAR`;
    assert.equal(parseIcsToEvents(bad).length, 0);
  });
});

describe('redactEventForAgentTier', () => {
  const event = {
    external_uid: 'x@y',
    start: '2026-06-18T17:00:00.000Z',
    end: '2026-06-18T17:30:00.000Z',
    timezone: 'UTC',
    summary: 'Secret title',
    busy: true,
    status: 'confirmed',
    recurrence_rule: null,
  };

  it('tier 0 returns null', () => {
    assert.equal(redactEventForAgentTier(event, 0), null);
  });

  it('tier 1 omits summary', () => {
    const r = redactEventForAgentTier(event, 1);
    assert.ok(r);
    assert.equal(r.summary, undefined);
  });

  it('tier 2 includes summary', () => {
    const r = redactEventForAgentTier(event, 2, { calendar_label: 'Work' });
    assert.ok(r);
    assert.equal(r.summary, 'Secret title');
    assert.equal(r.calendar_label, 'Work');
  });
});

describe('AGENT_CONTEXT_TIERS', () => {
  it('includes tiers 0 through 4', () => {
    assert.deepEqual([...AGENT_CONTEXT_TIERS], [0, 1, 2, 3, 4]);
  });
});
