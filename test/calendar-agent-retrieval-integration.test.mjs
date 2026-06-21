/**
 * Tier 2 — INTEGRATION: agent retrieval against the local event store.
 *
 * Imports ICS, toggles agent access, and asserts that retrieveAgentCalendarContext
 * enforces enabled_for_agents and per-calendar tier caps server-side.
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
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-agent-integration');
const ics = fs.readFileSync(path.join(__dirname, 'fixtures', 'calendar', 'simple-utc.ics'), 'utf8');

const RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('retrieveAgentCalendarContext — store integration', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  /** @type {string} */
  let calendarId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
    calendarId = importIcsIntoVault(dataDir, vaultId, { icsText: ics, displayName: 'Work' }).source_calendar_id;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
  });

  it('returns no events for a calendar with agents disabled (v0 default)', () => {
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.schema, 'knowtation.calendar_agent_context/v0');
    assert.equal(result.items.length, 0);
    assert.equal(result.source_calendars.length, 0);
  });

  it('tier 2 returns summary and calendar label once agents are enabled', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.items.length, 1);
    const [item] = result.items;
    assert.equal(item.summary, 'Team standup');
    assert.equal(item.calendar_label, 'Work');
    assert.equal(item.agent_tier, 2);
    assert.equal(item.busy, true);
    assert.equal(result.source_calendars[0].event_count, 1);
  });

  it('tier 1 redacts the title but keeps busy blocks', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 1 });
    assert.equal(result.items.length, 1);
    const [item] = result.items;
    assert.equal(item.agent_tier, 1);
    assert.ok(!('summary' in item), 'tier 1 must not include summary');
    assert.ok(!('calendar_label' in item), 'tier 1 must not include calendar_label');
    assert.equal(typeof item.start, 'string');
    assert.equal(item.busy, true);
  });

  it('requested tier 0 returns no events even with agents enabled', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 0 });
    assert.equal(result.items.length, 0);
    assert.equal(result.source_calendars[0].effective_tier, 0);
  });

  it('per-calendar cap clamps a tier-2 request down to tier 1', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 1 });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].agent_tier, 1);
    assert.ok(!('summary' in result.items[0]));
  });
});
