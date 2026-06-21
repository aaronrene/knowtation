/**
 * Tier 1–7 — Source calendar PATCH toggles, policy caps, timeline display filter.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSourceCalendarPatchBody,
  patchSourceCalendar,
} from '../lib/calendar/source-calendar-patch.mjs';
import { readCalendarAgentTierCap } from '../lib/calendar/calendar-policy.mjs';
import { importIcsIntoVault } from '../lib/calendar/event-store.mjs';
import { buildCalendarTimeline } from '../lib/calendar/timeline.mjs';
import { SOURCE_CALENDAR_DEFAULTS } from '../lib/calendar/source-calendar-defaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-patch');

describe('parseSourceCalendarPatchBody', () => {
  it('unit: accepts partial toggle updates', () => {
    const patch = parseSourceCalendarPatchBody({
      enabled_for_display: false,
      user_group: 'work',
    });
    assert.equal(patch.enabled_for_display, false);
    assert.equal(patch.user_group, 'work');
  });

  it('unit: rejects invalid tier and user_group', () => {
    assert.throws(() => parseSourceCalendarPatchBody({ agent_context_tier_max: 9 }), /0–4/);
    assert.throws(() => parseSourceCalendarPatchBody({ user_group: 'family' }), /personal, work/);
    assert.throws(() => parseSourceCalendarPatchBody({}), /At least one/);
  });
});

describe('patchSourceCalendar', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultPath = path.join(tmpRoot, 'vault');
  const vaultId = 'default';
  const ics = fs.readFileSync(path.join(__dirname, 'fixtures', 'calendar', 'simple-utc.ics'), 'utf8');
  /** @type {string} */
  let sourceCalendarId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(vaultPath, { recursive: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
    const imported = importIcsIntoVault(dataDir, vaultId, { icsText: ics, displayName: 'Work' });
    sourceCalendarId = imported.source_calendar_id;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
  });

  it('integration: updates display and agent toggles independently', () => {
    const result = patchSourceCalendar(dataDir, vaultId, sourceCalendarId, {
      enabled_for_display: true,
      enabled_for_agents: true,
      agent_context_tier_max: 2,
      user_group: 'personal',
    });
    assert.equal(result.source_calendar.enabled_for_display, true);
    assert.equal(result.source_calendar.enabled_for_agents, true);
    assert.equal(result.source_calendar.agent_context_tier_max, 2);
    assert.equal(result.source_calendar.user_group, 'personal');
  });

  it('integration: timeline hides events when enabled_for_display is false', () => {
    patchSourceCalendar(dataDir, vaultId, sourceCalendarId, {
      enabled_for_display: false,
    });
    const timeline = buildCalendarTimeline({
      dataDir,
      vaultId,
      vaultPath,
      from: '2026-06-01',
      to: '2026-06-30',
      layers: 'events',
    });
    assert.equal(timeline.items.length, 0);
  });

  it('security: rejects agent_context_tier_max above policy cap', () => {
    process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP = '1';
    assert.equal(readCalendarAgentTierCap(dataDir), 1);
    assert.throws(
      () => patchSourceCalendar(dataDir, vaultId, sourceCalendarId, {
        agent_context_tier_max: 2,
      }),
      (err) => err.code === 'POLICY_CAP_EXCEEDED',
    );
  });

  it('data-integrity: new imports keep v0 defaults until patched', () => {
    const result = patchSourceCalendar(dataDir, vaultId, sourceCalendarId, {
      user_group: null,
    });
    assert.equal(result.source_calendar.enabled_for_display, SOURCE_CALENDAR_DEFAULTS.enabled_for_display);
    assert.equal(result.source_calendar.enabled_for_agents, SOURCE_CALENDAR_DEFAULTS.enabled_for_agents);
    assert.equal(result.source_calendar.agent_context_tier_max, SOURCE_CALENDAR_DEFAULTS.agent_context_tier_max);
  });

  it('stress: repeated patches persist last write', () => {
    for (let i = 0; i < 20; i += 1) {
      patchSourceCalendar(dataDir, vaultId, sourceCalendarId, {
        enabled_for_agents: i % 2 === 0,
      });
    }
    const final = patchSourceCalendar(dataDir, vaultId, sourceCalendarId, {
      enabled_for_agents: true,
      agent_context_tier_max: 1,
    });
    assert.equal(final.source_calendar.enabled_for_agents, true);
    assert.equal(final.source_calendar.agent_context_tier_max, 1);
  });
});
