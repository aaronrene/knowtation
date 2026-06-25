/**
 * Tier 5 — DATA-INTEGRITY: DST boundary occurrence keys remain stable strings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectNextOccurrence } from '../lib/task/task-loop-rrule.mjs';

describe('Task loop RRULE — timezone occurrence keys', () => {
  it('weekly occurrence key format is stable across projection calls', () => {
    const recurrence = {
      kind: 'rrule',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      dtstart: '2026-03-02T17:00:00Z',
      anchor_tz: 'America/Los_Angeles',
    };

    const first = projectNextOccurrence(recurrence, { until_at: null }, '2026-03-01T00:00:00Z');
    const second = projectNextOccurrence(recurrence, { until_at: null }, '2026-03-01T00:00:00Z');
    assert.ok(first);
    assert.ok(second);
    if (!first || !second) return;
    assert.equal(first.occurrenceKey, second.occurrenceKey);
    assert.match(first.occurrenceKey, /^\d{4}-W\d{2}$/);
  });
});
