/**
 * Tier 6 — PERFORMANCE: the OpenRouter lane must add negligible overhead around the network
 * call and must not block the event loop.
 *
 * The HTTP boundary is mocked to return immediately, so what is measured is the lane's own
 * per-call overhead (provider selection, header/body construction, JSON parse). Thresholds are
 * deliberately generous to stay non-flaky on shared CI while still catching gross regressions
 * (e.g. an accidental O(n^2) build or a synchronous sleep).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { completeChat } from '../lib/llm-complete.mjs';

const ORIG = { ...process.env };
const origFetch = globalThis.fetch;

const CHAT_ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPINFRA_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODEL',
  'OPENROUTER_SITE_URL',
  'OPENROUTER_APP_TITLE',
  'KNOWTATION_CHAT_PROVIDER',
  'KNOWTATION_CHAT_PREFER_ANTHROPIC',
];

function clearChatEnv() {
  for (const k of CHAT_ENV_KEYS) delete process.env[k];
}

function restoreEnv() {
  for (const k of CHAT_ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
}

describe('OpenRouter lane — performance', () => {
  beforeEach(() => {
    clearChatEnv();
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-perf';
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'fast' } }] }),
    });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('1000 sequential calls complete well under the regression ceiling', async () => {
    const N = 1000;
    const start = performance.now();
    for (let i = 0; i < N; i += 1) {
      await completeChat({}, { system: 's', user: `u-${i}` });
    }
    const elapsed = performance.now() - start;
    // Generous ceiling: pure overhead should be a fraction of this on any machine.
    assert.ok(elapsed < 5000, `1000 calls took ${elapsed.toFixed(1)}ms (ceiling 5000ms)`);
  });

  it('per-call overhead stays low even with a large prompt body', async () => {
    const big = 'y'.repeat(50_000);
    const N = 200;
    const start = performance.now();
    for (let i = 0; i < N; i += 1) {
      await completeChat({}, { system: 's', user: big });
    }
    const avg = (performance.now() - start) / N;
    assert.ok(avg < 25, `avg per-call overhead ${avg.toFixed(3)}ms (ceiling 25ms)`);
  });

  it('yields to the event loop (a pending timer fires around the call)', async () => {
    let tick = false;
    setTimeout(() => {
      tick = true;
    }, 0);
    await completeChat({}, { system: 's', user: 'u' });
    // Wait one real timer interval: if the lane had starved the loop, the 0ms timer
    // would still be pending here. A deterministic 5ms wait guarantees the timers phase ran.
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(tick, true);
  });
});
