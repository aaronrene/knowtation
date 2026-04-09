/**
 * KNOWTATION_CHAT_PREFER_ANTHROPIC reorders OpenAI vs Anthropic when both keys exist.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { completeChat } from '../lib/llm-complete.mjs';

const origFetch = globalThis.fetch;
const origOpenai = process.env.OPENAI_API_KEY;
const origAnthropic = process.env.ANTHROPIC_API_KEY;
const origPrefer = process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC;

function restoreEnv() {
  process.env.OPENAI_API_KEY = origOpenai;
  process.env.ANTHROPIC_API_KEY = origAnthropic;
  process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC = origPrefer;
}

describe('completeChat KNOWTATION_CHAT_PREFER_ANTHROPIC', () => {
  beforeEach(() => {
    delete process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('default: OpenAI used when both keys set', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('api.openai.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'from-openai' } }],
          }),
        };
      }
      return { ok: false, text: async () => 'unexpected' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openai');
    assert.ok(calls.some((u) => u.includes('openai.com')));
    assert.ok(!calls.some((u) => u.includes('anthropic.com')));
  });

  it('prefer Anthropic: Claude first, OpenAI fallback on Anthropic failure', async () => {
    process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC = '1';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    let anthropicCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('anthropic.com')) {
        anthropicCalls++;
        return { ok: false, text: async () => 'rate limit' };
      }
      if (u.includes('openai.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'from-openai-fallback' } }],
          }),
        };
      }
      return { ok: false, text: async () => 'no' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openai-fallback');
    assert.strictEqual(anthropicCalls, 1);
  });

  it('prefer Anthropic: returns Claude when Anthropic succeeds', async () => {
    process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC = 'true';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('anthropic.com')) {
        return {
          ok: true,
          json: async () => ({
            content: [{ text: 'from-claude' }],
          }),
        };
      }
      return { ok: false, text: async () => 'should not reach openai' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-claude');
  });
});
