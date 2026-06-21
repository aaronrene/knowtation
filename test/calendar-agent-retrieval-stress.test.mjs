/**
 * Tier 4 — STRESS: large event volumes and repeated agent retrievals.
 *
 * Confirms enforcement and counts stay correct under load and repetition.
 * @see lib/calendar/agent-retrieval.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importIcsIntoVault } from '../lib/calendar/event-store.mjs';
import { patchSourceCalendar } from '../lib/calendar/source-calendar-patch.mjs';
import { retrieveAgentCalendarContext } from '../lib/calendar/agent-retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-agent-stress');

const EVENT_COUNT = 600;

function buildBulkIcs(count) {
  const chunks = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (let i = 0; i < count; i += 1) {
    const day = String((i % 27) + 1).padStart(2, '0');
    chunks.push(
      'BEGIN:VEVENT',
      `UID:bulk-${i}@stress.test`,
      `DTSTART:202606${day}T090000Z`,
      `DTEND:202606${day}T093000Z`,
      `SUMMARY:Bulk event ${i}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  chunks.push('END:VCALENDAR');
  return chunks.join('\n');
}

describe('Stress — bulk agent retrieval', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  /** @type {string} */
  let calendarId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    calendarId = importIcsIntoVault(dataDir, vaultId, {
      icsText: buildBulkIcs(EVENT_COUNT),
      displayName: 'Bulk',
    }).source_calendar_id;
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns every in-range event exactly once at tier 2', () => {
    const result = retrieveAgentCalendarContext(dataDir, vaultId, {
      from: '2026-06-01',
      to: '2026-06-30',
      agentContextTier: 2,
    });
    assert.equal(result.items.length, EVENT_COUNT);
    const uids = new Set(result.items.map((i) => i.external_uid));
    assert.equal(uids.size, EVENT_COUNT);
    assert.equal(result.source_calendars[0].event_count, EVENT_COUNT);
  });

  it('produces identical output across 50 repeated retrievals', () => {
    let previous = null;
    for (let i = 0; i < 50; i += 1) {
      const result = retrieveAgentCalendarContext(dataDir, vaultId, {
        from: '2026-06-01',
        to: '2026-06-30',
        agentContextTier: 1,
      });
      assert.equal(result.items.length, EVENT_COUNT);
      const signature = result.items.map((i) => `${i.external_uid}:${i.agent_tier}`).join('|');
      if (previous !== null) {
        assert.equal(signature, previous);
      }
      previous = signature;
    }
  });
});
