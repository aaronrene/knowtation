/**
 * Tier 4 — STRESS: large and pathological ICS payloads within bounded limits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcsToEvents, unfoldIcsLines } from '../lib/calendar/ics-normalizer.mjs';

describe('Stress — many VEVENT components', () => {
  it('parses 1000 events under default maxEvents cap', () => {
    const chunks = ['BEGIN:VCALENDAR'];
    for (let i = 0; i < 1000; i += 1) {
      chunks.push(
        'BEGIN:VEVENT',
        `UID:evt-${i}@stress`,
        'DTSTART:20260101T000000Z',
        'DTEND:20260101T010000Z',
        'END:VEVENT',
      );
    }
    chunks.push('END:VCALENDAR');
    const events = parseIcsToEvents(chunks.join('\n'));
    assert.equal(events.length, 1000);
  });

  it('rejects payloads above maxEvents', () => {
    const chunks = ['BEGIN:VCALENDAR'];
    for (let i = 0; i < 11; i += 1) {
      chunks.push(
        'BEGIN:VEVENT',
        `UID:x-${i}@s`,
        'DTSTART:20260101T000000Z',
        'DTEND:20260101T010000Z',
        'END:VEVENT',
      );
    }
    chunks.push('END:VCALENDAR');
    assert.throws(() => parseIcsToEvents(chunks.join('\n'), { maxEvents: 10 }), /max is 10/);
  });
});

describe('Stress — deep folding chains', () => {
  it('handles many folded summary continuations', () => {
    const parts = ['SUMMARY:Start'];
    for (let i = 0; i < 50; i += 1) {
      parts.push(` part${i}`);
    }
    const folded = parts.join('\r\n ');
    const lines = unfoldIcsLines(`${folded}\r\nUID:x`);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /part49/);
  });
});

describe('Stress — malformed structure', () => {
  it('throws on unclosed VEVENT', () => {
    assert.throws(
      () => parseIcsToEvents('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20260101T000000Z\nEND:VCALENDAR'),
      /Unclosed VEVENT/,
    );
  });
});
