/**
 * Tier 1 — UNIT: pure agent-retrieval helpers (tier parsing, effective-tier math).
 *
 * Verifies the server-side enforcement primitives in isolation, with no store I/O.
 * @see lib/calendar/agent-retrieval.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgentContextTier,
  resolveEffectiveTier,
  AGENT_RETRIEVAL_MAX_TIER,
} from '../lib/calendar/agent-retrieval.mjs';

describe('parseAgentContextTier', () => {
  it('accepts integers and numeric strings 0–2', () => {
    assert.equal(parseAgentContextTier(0), 0);
    assert.equal(parseAgentContextTier(1), 1);
    assert.equal(parseAgentContextTier(2), 2);
    assert.equal(parseAgentContextTier('2'), 2);
    assert.equal(parseAgentContextTier(' 1 '), 1);
  });

  it('rejects the deferred v0 ceiling (tier 3–4) and out-of-range values', () => {
    assert.equal(AGENT_RETRIEVAL_MAX_TIER, 2);
    assert.throws(() => parseAgentContextTier(3), /ceiling is 2/);
    assert.throws(() => parseAgentContextTier(4), /ceiling is 2/);
    assert.throws(() => parseAgentContextTier(-1), /0, 1, or 2/);
  });

  it('rejects non-integer input', () => {
    assert.throws(() => parseAgentContextTier('abc'), /integer/);
    assert.throws(() => parseAgentContextTier(1.5), /integer/);
    assert.throws(() => parseAgentContextTier(null), /integer/);
  });
});

describe('resolveEffectiveTier', () => {
  it('fails closed to 0 when enabled_for_agents is false', () => {
    assert.equal(resolveEffectiveTier({ enabled_for_agents: false, agent_context_tier_max: 4 }, 2), 0);
  });

  it('caps at the per-calendar agent_context_tier_max', () => {
    assert.equal(resolveEffectiveTier({ enabled_for_agents: true, agent_context_tier_max: 1 }, 2), 1);
    assert.equal(resolveEffectiveTier({ enabled_for_agents: true, agent_context_tier_max: 0 }, 2), 0);
  });

  it('never exceeds the requested tier or the v0 ceiling', () => {
    assert.equal(resolveEffectiveTier({ enabled_for_agents: true, agent_context_tier_max: 4 }, 1), 1);
    assert.equal(resolveEffectiveTier({ enabled_for_agents: true, agent_context_tier_max: 4 }, 2), 2);
  });
});
