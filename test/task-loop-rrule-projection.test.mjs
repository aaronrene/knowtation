/**
 * Tier 1 — UNIT: RRULE next occurrence + occurrence_key projection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectNextOccurrence } from '../lib/task/task-loop-rrule.mjs';

const RECURRENCE = {
  kind: 'rrule',
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  dtstart: '2026-06-02T16:00:00Z',
  anchor_tz: 'America/Los_Angeles',
};

describe('Task loop RRULE — occurrence projection', () => {
  it('projects next Monday occurrence after June 24 2026', () => {
    const projection = projectNextOccurrence(
      RECURRENCE,
      { until_at: null },
      '2026-06-24T12:00:00Z',
    );
    assert.ok(projection);
    if (!projection) return;
    assert.match(projection.occurrenceKey, /^2026-W\d{2}$/);
    assert.ok(projection.occurrenceAt > '2026-06-24T12:00:00Z');
  });

  it('returns null when series until_at is before after instant', () => {
    const projection = projectNextOccurrence(
      RECURRENCE,
      { until_at: '2026-06-01T00:00:00Z' },
      '2026-06-24T12:00:00Z',
    );
    assert.equal(projection, null);
  });
});
