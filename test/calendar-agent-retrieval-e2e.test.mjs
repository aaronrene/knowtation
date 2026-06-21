/**
 * Tier 3 — E2E: multi-calendar agent context walkthrough.
 *
 * Simulates a user with several connected calendars at mixed agent settings and
 * asserts an agent only ever sees the calendars/fields it is entitled to.
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
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-agent-e2e');
const fixtureDir = path.join(__dirname, 'fixtures', 'calendar');
const simpleIcs = fs.readFileSync(path.join(fixtureDir, 'simple-utc.ics'), 'utf8');
const multiIcs = fs.readFileSync(path.join(fixtureDir, 'multi-event.ics'), 'utf8');

const RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('E2E — agent context across mixed calendars', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  /** @type {string} */
  let workId;
  /** @type {string} */
  let personalId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
    workId = importIcsIntoVault(dataDir, vaultId, { icsText: simpleIcs, displayName: 'Work' }).source_calendar_id;
    personalId = importIcsIntoVault(dataDir, vaultId, { icsText: multiIcs, displayName: 'Personal' }).source_calendar_id;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
  });

  it('only includes the agent-enabled calendar, leaves the other invisible', () => {
    patchSourceCalendar(dataDir, vaultId, workId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    // personal stays at the v0 default (agents off)

    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.source_calendars.length, 1);
    assert.equal(result.source_calendars[0].source_calendar_id, workId);
    assert.ok(result.items.every((i) => i.source_calendar_id === workId));
    assert.ok(result.items.some((i) => i.summary === 'Team standup'));
  });

  it('applies the lower tier per calendar in a single request', () => {
    patchSourceCalendar(dataDir, vaultId, workId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    patchSourceCalendar(dataDir, vaultId, personalId, { enabled_for_agents: true, agent_context_tier_max: 1 });

    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    const work = result.items.filter((i) => i.source_calendar_id === workId);
    const personal = result.items.filter((i) => i.source_calendar_id === personalId);

    assert.ok(work.every((i) => i.agent_tier === 2 && typeof i.summary === 'string'));
    assert.ok(personal.length > 0);
    assert.ok(personal.every((i) => i.agent_tier === 1 && !('summary' in i)));
  });

  it('restricts scope when source_calendar_ids is supplied', () => {
    patchSourceCalendar(dataDir, vaultId, workId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    patchSourceCalendar(dataDir, vaultId, personalId, { enabled_for_agents: true, agent_context_tier_max: 2 });

    const result = retrieveAgentCalendarContext(dataDir, vaultId, {
      ...RANGE,
      agentContextTier: 2,
      sourceCalendarIds: personalId,
    });
    assert.equal(result.source_calendars.length, 1);
    assert.ok(result.items.every((i) => i.source_calendar_id === personalId));
  });
});
