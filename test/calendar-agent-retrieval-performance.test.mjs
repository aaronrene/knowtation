/**
 * Tier 6 — PERFORMANCE: agent retrieval throughput smoke (no network).
 *
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
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-agent-perf');

const EVENT_COUNT = 500;

function buildBulkIcs(count) {
  const chunks = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (let i = 0; i < count; i += 1) {
    const day = String((i % 27) + 1).padStart(2, '0');
    chunks.push(
      'BEGIN:VEVENT',
      `UID:perf-${i}@perf.test`,
      `DTSTART:202606${day}T120000Z`,
      `DTEND:202606${day}T123000Z`,
      `SUMMARY:Perf event ${i}`,
      'END:VEVENT',
    );
  }
  chunks.push('END:VCALENDAR');
  return chunks.join('\n');
}

describe('Performance — agent retrieval over 500 events', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const id = importIcsIntoVault(dataDir, vaultId, {
      icsText: buildBulkIcs(EVENT_COUNT),
      displayName: 'Perf',
    }).source_calendar_id;
    patchSourceCalendar(dataDir, vaultId, id, { enabled_for_agents: true, agent_context_tier_max: 2 });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('completes a tier-2 retrieval in under 750ms', () => {
    const start = performance.now();
    const result = retrieveAgentCalendarContext(dataDir, vaultId, {
      from: '2026-06-01',
      to: '2026-06-30',
      agentContextTier: 2,
    });
    const elapsed = performance.now() - start;
    assert.equal(result.items.length, EVENT_COUNT);
    assert.ok(elapsed < 750, `retrieval took ${elapsed.toFixed(1)}ms`);
  });
});
