/**
 * Tier 5 — DATA INTEGRITY: retrieval is read-only and counts are faithful.
 *
 * Verifies that agent retrieval never mutates the store, that event_count
 * matches returned items, and that agent visibility is independent of the
 * display toggle (security checklist #7).
 * @see lib/calendar/agent-retrieval.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  importIcsIntoVault,
  getCalendarStorePath,
} from '../lib/calendar/event-store.mjs';
import { patchSourceCalendar } from '../lib/calendar/source-calendar-patch.mjs';
import { retrieveAgentCalendarContext } from '../lib/calendar/agent-retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-agent-integrity');
const ics = fs.readFileSync(path.join(__dirname, 'fixtures', 'calendar', 'multi-event.ics'), 'utf8');

const RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('Data integrity — agent retrieval', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  /** @type {string} */
  let calendarId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    calendarId = importIcsIntoVault(dataDir, vaultId, { icsText: ics, displayName: 'Personal' }).source_calendar_id;
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does not mutate the store file when retrieving', () => {
    const storePath = getCalendarStorePath(dataDir);
    const before = fs.readFileSync(storePath, 'utf8');
    retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    const after = fs.readFileSync(storePath, 'utf8');
    assert.equal(after, before);
  });

  it('summary returned to the agent matches the stored summary verbatim', () => {
    const stored = JSON.parse(fs.readFileSync(getCalendarStorePath(dataDir), 'utf8'));
    const storedSummaries = new Set(
      stored.vaults[vaultId].events.filter((e) => !e.deleted_at).map((e) => e.summary),
    );
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    for (const item of result.items) {
      assert.ok(storedSummaries.has(item.summary), `unexpected summary: ${item.summary}`);
    }
  });

  it('event_count in the summary equals the number of returned items per calendar', () => {
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    const counted = result.items.filter((i) => i.source_calendar_id === calendarId).length;
    assert.equal(result.source_calendars[0].event_count, counted);
  });

  it('agent visibility is independent of enabled_for_display', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_display: false });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.ok(result.items.length > 0, 'agents still see events when display is off but agents on');
  });

  it('returns exactly the non-tombstoned events and excludes deleted ones', () => {
    const storePath = getCalendarStorePath(dataDir);
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const liveCount = stored.vaults[vaultId].events.filter((e) => !e.deleted_at).length;

    const before = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(before.items.length, liveCount);

    // Tombstone one event (provider delete / revoke) and confirm it disappears.
    stored.vaults[vaultId].events[0].deleted_at = '2026-06-25T00:00:00.000Z';
    fs.writeFileSync(storePath, JSON.stringify(stored));

    const after = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(after.items.length, liveCount - 1);
  });
});
