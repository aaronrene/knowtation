/**
 * Tier 1 — UNIT: RRULE subset validator accept/reject matrix.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_LOOP_RRULE_ENABLED, validateTaskLoopRrule } from '../lib/task/task-loop-rrule.mjs';

const SERIES_TZ = 'America/Los_Angeles';

const VALID_WEEKLY = {
  kind: 'rrule',
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  dtstart: '2026-06-02T16:00:00Z',
  anchor_tz: SERIES_TZ,
};

describe('Task loop RRULE — posture', () => {
  it('TASK_LOOP_RRULE_ENABLED stays false until Tier 3', () => {
    assert.equal(TASK_LOOP_RRULE_ENABLED, false);
  });
});

describe('Task loop RRULE — validator accept matrix', () => {
  it('accepts school-trip weekly RRULE fixture', () => {
    const result = validateTaskLoopRrule(VALID_WEEKLY, SERIES_TZ);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.recurrence.kind, 'rrule');
    }
  });

  it('accepts optional exdates when unique and ISO8601', () => {
    const result = validateTaskLoopRrule(
      {
        ...VALID_WEEKLY,
        exdates: ['2026-06-09T16:00:00Z'],
      },
      SERIES_TZ,
    );
    assert.equal(result.ok, true);
  });
});

describe('Task loop RRULE — validator reject matrix', () => {
  it('requires DTSTART', () => {
    const result = validateTaskLoopRrule({ ...VALID_WEEKLY, dtstart: '' }, SERIES_TZ);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, 'dtstart');
  });

  it('rejects timezone mismatch', () => {
    const result = validateTaskLoopRrule(VALID_WEEKLY, 'UTC');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, 'timezone_mismatch');
  });

  it('rejects unsupported FREQ token', () => {
    const result = validateTaskLoopRrule(
      { ...VALID_WEEKLY, rrule: 'FREQ=HOURLY' },
      SERIES_TZ,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, 'FREQ');
  });

  it('rejects BYSETPOS in v0 subset', () => {
    const result = validateTaskLoopRrule(
      { ...VALID_WEEKLY, rrule: 'FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1' },
      SERIES_TZ,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, 'BYSETPOS');
  });
});
