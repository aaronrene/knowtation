/**
 * Tier 7 — SECURITY: tier enforcement, policy caps, injection handling, route contract.
 *
 * Calendar summaries/descriptions are untrusted prompt content. These tests prove
 * that disabled calendars and policy caps fail closed, that titles never leak below
 * tier 2, and that the Hub route is auth-gated and never exposes connector secrets.
 * @see lib/calendar/agent-retrieval.mjs, hub/server.mjs
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
const repoRoot = path.dirname(__dirname);
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-agent-security');
const fixtureDir = path.join(__dirname, 'fixtures', 'calendar');
const injectionIcs = fs.readFileSync(path.join(fixtureDir, 'injection-summary.ics'), 'utf8');

const RANGE = { from: '2026-06-01', to: '2026-06-30' };

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Security — agent tier enforcement', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';
  /** @type {string} */
  let calendarId;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
    calendarId = importIcsIntoVault(dataDir, vaultId, { icsText: injectionIcs, displayName: 'Injected' }).source_calendar_id;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP;
  });

  it('fails closed: agents-disabled calendar yields nothing even at requested tier 2', () => {
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.items.length, 0);
    assert.equal(result.source_calendars.length, 0);
  });

  it('never exposes an injection summary below tier 2', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    const tier1 = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 1 });
    assert.ok(tier1.items.length > 0);
    for (const item of tier1.items) {
      assert.ok(!('summary' in item), 'tier 1 must never carry the summary');
      assert.ok(!('description' in item));
      assert.ok(!('location' in item));
    }
  });

  it('org policy cap clamps a tier-2 request to tier 1 (minor/classroom policy)', () => {
    process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP = '1';
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 1 });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.effective_tier, 1);
    assert.equal(result.policy_agent_context_tier_max_cap, 1);
    assert.ok(result.items.every((i) => i.agent_tier === 1 && !('summary' in i)));
  });

  it('org policy cap 0 blocks all calendar fields regardless of per-calendar settings', () => {
    process.env.KNOWTATION_CALENDAR_AGENT_TIER_MAX_CAP = '0';
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.effective_tier, 0);
    assert.equal(result.items.length, 0);
  });

  it('rejects requests above the v0 retrieval ceiling (tier 3+)', () => {
    assert.throws(
      () => retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 3 }),
      /ceiling is 2/,
    );
  });

  it('at tier 2 the untrusted summary is returned verbatim as data, not interpreted', () => {
    patchSourceCalendar(dataDir, vaultId, calendarId, { enabled_for_agents: true, agent_context_tier_max: 2 });
    const result = retrieveAgentCalendarContext(dataDir, vaultId, { ...RANGE, agentContextTier: 2 });
    assert.equal(result.items.length, 1);
    assert.equal(typeof result.items[0].summary, 'string');
    assert.match(result.items[0].summary, /Ignore prior instructions/);
  });
});

describe('Security — Hub agent-context route contract', () => {
  it('registers the route behind viewer+ role and delegates to the enforcement lib only', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(src, /app\.get\('\/api\/v1\/calendar\/agent-context', requireRole\('viewer', 'editor', 'admin', 'evaluator'\)/);
    assert.match(src, /retrieveAgentCalendarContext\(/);
    assert.match(src, /from '\.\.\/lib\/calendar\/agent-retrieval\.mjs'/);
  });

  it('the agent-context route never references OAuth or provider APIs', () => {
    const src = readRepoFile('hub/server.mjs');
    const start = src.indexOf("app.get('/api/v1/calendar/agent-context'");
    const end = src.indexOf('// GET /api/v1/calendar/source-calendars', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const route = src.slice(start, end);
    assert.doesNotMatch(route, /oauth|google|microsoft|parseIcsToEvents/i);
  });

  it('retrieval reads events independently of the display toggle (displayOnly false)', () => {
    const lib = readRepoFile('lib/calendar/agent-retrieval.mjs');
    assert.match(lib, /displayOnly:\s*false/);
    assert.match(lib, /redactEventForAgentTier/);
  });

  it('OpenAPI documents the agent-context schema', () => {
    const api = readRepoFile('docs/openapi.yaml');
    assert.match(api, /\/calendar\/agent-context:/);
    assert.match(api, /knowtation\.calendar_agent_context\/v0/);
    assert.match(api, /CalendarAgentContextEventItem/);
  });
});
