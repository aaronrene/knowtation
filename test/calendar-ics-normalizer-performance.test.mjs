/**
 * Tier 6 — PERFORMANCE: parse throughput smoke (no network).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcsToEvents } from '../lib/calendar/ics-normalizer.mjs';

describe('Performance — 500-event parse completes within budget', () => {
  it('parses 500 events in under 2 seconds', () => {
    const chunks = ['BEGIN:VCALENDAR'];
    for (let i = 0; i < 500; i += 1) {
      chunks.push(
        'BEGIN:VEVENT',
        `UID:p-${i}@perf`,
        'DTSTART:20260101T000000Z',
        'DTEND:20260101T003000Z',
        `SUMMARY:Event ${i}`,
        'END:VEVENT',
      );
    }
    chunks.push('END:VCALENDAR');
    const text = chunks.join('\n');

    const start = performance.now();
    const events = parseIcsToEvents(text);
    const elapsed = performance.now() - start;

    assert.equal(events.length, 500);
    assert.ok(elapsed < 2000, `parse took ${elapsed.toFixed(1)}ms`);
  });
});
