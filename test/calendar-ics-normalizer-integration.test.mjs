/**
 * Tier 2 — INTEGRATION: parse real fixture ICS files end-to-end through parseIcsToEvents.
 * Reference: docs/CALENDAR-EVENTS-V0-SPEC.md — Phase 1A
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIcsToEvents } from '../lib/calendar/ics-normalizer.mjs';
import { buildSourceCalendarDefaults, isAgentTierAllowed } from '../lib/calendar/source-calendar-defaults.mjs';
import { redactEventForAgentTier } from '../lib/calendar/agent-context-tier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'calendar');

/**
 * @param {string} name
 * @returns {string}
 */
function loadFixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), 'utf8');
}

describe('Fixture: simple-utc.ics', () => {
  it('parses UTC timed event', () => {
    const events = parseIcsToEvents(loadFixture('simple-utc.ics'));
    assert.equal(events.length, 1);
    assert.equal(events[0].external_uid, 'standup-001@knowtation.test');
    assert.equal(events[0].start, '2026-06-18T17:00:00.000Z');
    assert.equal(events[0].end, '2026-06-18T17:30:00.000Z');
    assert.equal(events[0].summary, 'Team standup');
  });
});

describe('Fixture: all-day.ics', () => {
  it('parses VALUE=DATE all-day span', () => {
    const events = parseIcsToEvents(loadFixture('all-day.ics'));
    assert.equal(events.length, 1);
    assert.equal(events[0].start, '2026-06-20T00:00:00.000Z');
    assert.equal(events[0].end, '2026-06-21T00:00:00.000Z');
  });
});

describe('Fixture: tzid-pacific.ics', () => {
  it('honors TZID for local wall time', () => {
    const events = parseIcsToEvents(loadFixture('tzid-pacific.ics'));
    assert.equal(events.length, 1);
    assert.equal(events[0].timezone, 'America/Los_Angeles');
    assert.equal(events[0].start, '2026-06-18T16:00:00.000Z');
    assert.equal(events[0].end, '2026-06-18T17:00:00.000Z');
  });
});

describe('Fixture: folded-summary.ics', () => {
  it('unfolds summary and preserves RRULE', () => {
    const events = parseIcsToEvents(loadFixture('folded-summary.ics'));
    assert.equal(events.length, 1);
    assert.match(events[0].summary ?? '', /RFC 5545 folding/);
    assert.equal(events[0].status, 'tentative');
    assert.equal(events[0].busy, false);
    assert.equal(events[0].recurrence_rule, 'FREQ=WEEKLY;BYDAY=TH');
  });
});

describe('Fixture: multi-event.ics', () => {
  it('parses multiple VEVENT components', () => {
    const events = parseIcsToEvents(loadFixture('multi-event.ics'));
    assert.equal(events.length, 2);
    const cancelled = events.find((e) => e.external_uid === 'cancel-001@knowtation.test');
    const duration = events.find((e) => e.external_uid === 'duration-001@knowtation.test');
    assert.ok(cancelled);
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(duration);
    assert.equal(duration.end, '2026-06-23T10:45:00.000Z');
  });
});

describe('Defaults + tier redaction integration', () => {
  it('new calendar defaults block agent summary at tier 2', () => {
    const cal = buildSourceCalendarDefaults();
    const events = parseIcsToEvents(loadFixture('simple-utc.ics'));
    assert.equal(isAgentTierAllowed(cal, 2), false);
    assert.equal(redactEventForAgentTier(events[0], 2)?.summary, 'Team standup');
    assert.equal(redactEventForAgentTier(events[0], 1)?.summary, undefined);
    assert.equal(redactEventForAgentTier(events[0], 0), null);
  });

  it('opt-in calendar allows tier up to cap', () => {
    const cal = buildSourceCalendarDefaults({
      enabled_for_agents: true,
      agent_context_tier_max: 2,
    });
    assert.equal(isAgentTierAllowed(cal, 2), true);
    assert.equal(isAgentTierAllowed(cal, 3), false);
  });
});
