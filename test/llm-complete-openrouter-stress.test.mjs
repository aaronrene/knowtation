/**
 * Tier 4 — STRESS: the OpenRouter lane under high concurrency and high sequential volume.
 *
 * Goal: confirm the lane has no shared mutable state that corrupts results when many calls
 * run at once, that every call maps to exactly one upstream request, and that a partial
 * failure in a batch is isolated to that call. Network is mocked.
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

describe('OpenRouter lane — stress', () => {
  beforeEach(() => {
    clearChatEnv();
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-stress';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('500 concurrent calls each return their own correct, non-cross-contaminated result', async () => {
    let fetchCount = 0;
    globalThis.fetch = async (url, init) => {
      fetchCount += 1;
      // Echo the user content back so we can prove no response was crossed between calls.
      const sent = JSON.parse(init.body).messages[1].content;
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
      return { ok: true, json: async () => ({ choices: [{ message: { content: `echo:${sent}` } }] }) };
    };

    const N = 500;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        completeChat({}, { system: 's', user: `payload-${i}` }),
      ),
    );

    assert.strictEqual(fetchCount, N);
    for (let i = 0; i < N; i += 1) {
      assert.strictEqual(results[i], `echo:payload-${i}`);
    }
  });

  it('1000 sequential calls all succeed with stable behaviour', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'stable' } }] }),
    });
    for (let i = 0; i < 1000; i += 1) {
      const out = await completeChat({}, { system: 's', user: `n-${i}` });
      assert.strictEqual(out, 'stable');
    }
  });

  it('one failing call in a concurrent batch does not break the others', async () => {
    globalThis.fetch = async (url, init) => {
      const sent = JSON.parse(init.body).messages[1].content;
      if (sent === 'user-3') return { ok: false, status: 500, text: async () => 'boom' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: `ok:${sent}` } }] }) };
    };

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => completeChat({}, { system: 's', user: `user-${i}` })),
    );

    const failures = settled.filter((s) => s.status === 'rejected');
    const successes = settled.filter((s) => s.status === 'fulfilled');
    assert.strictEqual(failures.length, 1);
    assert.strictEqual(successes.length, 9);
    assert.match(failures[0].reason.message, /OpenRouter chat failed: 500/);
  });
});
