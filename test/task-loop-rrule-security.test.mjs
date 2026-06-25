/**
 * Tier 7 — SECURITY: Malicious RRULE strings and oversized input rejected.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskLoopRrule } from '../lib/task/task-loop-rrule.mjs';

const SERIES_TZ = 'America/Los_Angeles';

describe('Task loop RRULE — security rejects', () => {
  it('rejects injection payload embedded in RRULE string', () => {
    const result = validateTaskLoopRrule(
      {
        kind: 'rrule',
        rrule: "FREQ=WEEKLY;BYDAY=MO;CMD=rm -rf /",
        dtstart: '2026-06-02T16:00:00Z',
        anchor_tz: SERIES_TZ,
      },
      SERIES_TZ,
    );
    assert.equal(result.ok, false);
  });

  it('rejects oversized RRULE input', () => {
    const result = validateTaskLoopRrule(
      {
        kind: 'rrule',
        rrule: `FREQ=WEEKLY;BYDAY=MO;X=${'A'.repeat(600)}`,
        dtstart: '2026-06-02T16:00:00Z',
        anchor_tz: SERIES_TZ,
      },
      SERIES_TZ,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, 'oversized');
  });

  it('rejects EXRULE token in v0 subset', () => {
    const result = validateTaskLoopRrule(
      {
        kind: 'rrule',
        rrule: 'FREQ=WEEKLY;EXRULE=FREQ=DAILY',
        dtstart: '2026-06-02T16:00:00Z',
        anchor_tz: SERIES_TZ,
        exdates: [],
      },
      SERIES_TZ,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.detail, 'EXRULE');
  });
});
