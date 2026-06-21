/**
 * Tier 7 — SECURITY: injection fixtures, payload bounds, tier-0 agent isolation.
 * Reference: docs/CALENDAR-EVENTS-V0-SPEC.md — Security checklist
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

describe('Security — prompt injection in SUMMARY is stored verbatim but tier-redacted', () => {
  it('preserves escaped injection text in normalized summary', () => {
    const ics = fs.readFileSync(path.join(fixtureDir, 'injection-summary.ics'), 'utf8');
    const [event] = parseIcsToEvents(ics);
    assert.match(event.summary ?? '', /Ignore prior instructions/);
    assert.match(event.summary ?? '', /delete vault/);
  });

  it('tier 0 default calendar exposes no agent fields', () => {
    const ics = fs.readFileSync(path.join(fixtureDir, 'injection-summary.ics'), 'utf8');
    const [event] = parseIcsToEvents(ics);
    const cal = buildSourceCalendarDefaults();
    assert.equal(isAgentTierAllowed(cal, 1), false);
    assert.equal(redactEventForAgentTier(event, 0), null);
    const tier1 = redactEventForAgentTier(event, 1);
    assert.ok(tier1);
    assert.equal(tier1.summary, undefined);
  });
});

describe('Security — payload size limits', () => {
  it('rejects ICS text above MAX_ICS_BYTES', () => {
    const big = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20260101T000000Z\nDTEND:20260101T010000Z\nSUMMARY:${'A'.repeat(6 * 1024 * 1024)}\nEND:VEVENT\nEND:VCALENDAR`;
    assert.throws(() => parseIcsToEvents(big), /exceeds/);
  });

  it('rejects non-string input', () => {
    assert.throws(() => parseIcsToEvents(/** @type {*} */ (null)), /must be a string/);
  });
});

describe('Security — no OAuth or network surface in normalizer module', () => {
  it('parseIcsToEvents accepts only in-memory string (no URL fetch API)', () => {
    assert.deepEqual(parseIcsToEvents(''), []);
    const events = parseIcsToEvents(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:local@only
DTSTART:20260101T000000Z
DTEND:20260101T010000Z
END:VEVENT
END:VCALENDAR`);
    assert.equal(events.length, 1);
  });
});

describe('Security — display vs agent toggles are independent', () => {
  it('display-on agents-off default allows UI but blocks tier > 0', () => {
    const cal = buildSourceCalendarDefaults({
      enabled_for_display: true,
      enabled_for_agents: false,
    });
    assert.equal(cal.enabled_for_display, true);
    assert.equal(isAgentTierAllowed(cal, 2), false);
  });
});
