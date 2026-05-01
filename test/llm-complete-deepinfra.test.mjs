/**
 * DeepInfra provider routing for completeChat.
 *
 * Backward-compatibility contract: setting DEEPINFRA_API_KEY alongside an existing
 * OPENAI_API_KEY must NOT change provider selection unless KNOWTATION_CHAT_PROVIDER=deepinfra
 * is also set. This test guards against regressions for hosted Hub deploys that
 * acquire a DeepInfra key for OpenClaw orchestration but keep OpenAI as primary chat.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { completeChat } from '../lib/llm-complete.mjs';

const origFetch = globalThis.fetch;
const origOpenai = process.env.OPENAI_API_KEY;
const origAnthropic = process.env.ANTHROPIC_API_KEY;
const origDeepinfra = process.env.DEEPINFRA_API_KEY;
const origPrefer = process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC;
const origProvider = process.env.KNOWTATION_CHAT_PROVIDER;

function setOrDelete(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function restoreEnv() {
  setOrDelete('OPENAI_API_KEY', origOpenai);
  setOrDelete('ANTHROPIC_API_KEY', origAnthropic);
  setOrDelete('DEEPINFRA_API_KEY', origDeepinfra);
  setOrDelete('KNOWTATION_CHAT_PREFER_ANTHROPIC', origPrefer);
  setOrDelete('KNOWTATION_CHAT_PROVIDER', origProvider);
}

function clearChatEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPINFRA_API_KEY;
  delete process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC;
  delete process.env.KNOWTATION_CHAT_PROVIDER;
}

describe('completeChat KNOWTATION_CHAT_PROVIDER=deepinfra', () => {
  beforeEach(() => {
    clearChatEnv();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('explicit deepinfra: routes to DeepInfra even when OpenAI key is set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('api.deepinfra.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'from-deepinfra' } }],
          }),
        };
      }
      return { ok: false, text: async () => 'should not reach openai' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-deepinfra');
    assert.ok(calls.some((u) => u.includes('deepinfra.com')));
    assert.ok(!calls.some((u) => u.includes('openai.com')));
  });

  it('explicit deepinfra without DEEPINFRA_API_KEY: throws actionable error', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called');
    };
    await assert.rejects(
      () => completeChat({}, { system: 's', user: 'u' }),
      /DEEPINFRA_API_KEY is not set/,
    );
  });

  it('explicit deepinfra: falls back to OpenAI when DeepInfra returns 5xx', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    let deepinfraCalls = 0;
    let openaiCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.deepinfra.com')) {
        deepinfraCalls++;
        return { ok: false, status: 502, text: async () => 'bad gateway' };
      }
      if (u.includes('api.openai.com')) {
        openaiCalls++;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'from-openai-fallback' } }],
          }),
        };
      }
      return { ok: false, text: async () => 'unexpected' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openai-fallback');
    assert.strictEqual(deepinfraCalls, 1);
    assert.strictEqual(openaiCalls, 1);
  });

  it('explicit deepinfra: falls back to Anthropic when DeepInfra fails and only Anthropic key is set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.deepinfra.com')) {
        return { ok: false, status: 503, text: async () => 'unavailable' };
      }
      if (u.includes('api.anthropic.com')) {
        return {
          ok: true,
          json: async () => ({
            content: [{ text: 'from-claude-fallback' }],
          }),
        };
      }
      return { ok: false, text: async () => 'unexpected' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-claude-fallback');
  });

  it('explicit deepinfra: surfaces all provider errors when every fallback fails', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'all-down',
    });
    await assert.rejects(
      () => completeChat({}, { system: 's', user: 'u' }),
      /DeepInfra chat failed.*OpenAI fallback failed.*Anthropic fallback failed/s,
    );
  });
});

describe('completeChat implicit DeepInfra (backward compatibility)', () => {
  beforeEach(() => {
    clearChatEnv();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('only DEEPINFRA_API_KEY set: routes to DeepInfra', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('api.deepinfra.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'from-deepinfra-implicit' } }],
          }),
        };
      }
      return { ok: false, text: async () => 'should not reach' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-deepinfra-implicit');
    assert.ok(calls.length === 1 && calls[0].includes('deepinfra.com'));
  });

  it('DEEPINFRA + OPENAI both set, no explicit provider: keeps OpenAI as default (no regression)', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('api.openai.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'from-openai-default' } }],
          }),
        };
      }
      return { ok: false, text: async () => 'unexpected provider' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openai-default');
    assert.ok(calls.every((u) => !u.includes('deepinfra.com')));
  });

  it('DEEPINFRA + ANTHROPIC both set, no explicit provider: keeps Anthropic as default (no regression)', async () => {
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('api.anthropic.com')) {
        return {
          ok: true,
          json: async () => ({
            content: [{ text: 'from-claude-default' }],
          }),
        };
      }
      return { ok: false, text: async () => 'unexpected' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-claude-default');
    assert.ok(calls.every((u) => !u.includes('deepinfra.com')));
  });
});

describe('completeChat KNOWTATION_CHAT_PROVIDER=openai|anthropic explicit lock', () => {
  beforeEach(() => {
    clearChatEnv();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('explicit openai: uses OpenAI even when DEEPINFRA_API_KEY is set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.openai.com')) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'from-openai-locked' } }] }),
        };
      }
      return { ok: false, text: async () => 'should not reach' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openai-locked');
  });

  it('explicit anthropic: uses Anthropic even when DEEPINFRA_API_KEY and OPENAI_API_KEY are set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.anthropic.com')) {
        return {
          ok: true,
          json: async () => ({ content: [{ text: 'from-claude-locked' }] }),
        };
      }
      return { ok: false, text: async () => 'should not reach' };
    };
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-claude-locked');
  });

  it('explicit openai without OPENAI_API_KEY: throws actionable error', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openai';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(
      () => completeChat({}, { system: 's', user: 'u' }),
      /OPENAI_API_KEY is not set/,
    );
  });
});

describe('completeChat DEEPINFRA_CHAT_MODEL override', () => {
  beforeEach(() => {
    clearChatEnv();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
    delete process.env.DEEPINFRA_CHAT_MODEL;
  });

  it('uses default Qwen/Qwen2.5-72B-Instruct when DEEPINFRA_CHAT_MODEL is unset', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    let observedModel;
    globalThis.fetch = async (url, init) => {
      observedModel = JSON.parse(init.body).model;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    };
    await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(observedModel, 'Qwen/Qwen2.5-72B-Instruct');
  });

  it('honors DEEPINFRA_CHAT_MODEL env override (e.g. cheap 8B for review hints)', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.DEEPINFRA_CHAT_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
    let observedModel;
    globalThis.fetch = async (url, init) => {
      observedModel = JSON.parse(init.body).model;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    };
    await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(observedModel, 'meta-llama/Meta-Llama-3.1-8B-Instruct');
  });

  it('honors config.llm.deepinfra_chat_model over env (caller-side override)', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'deepinfra';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    process.env.DEEPINFRA_CHAT_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
    let observedModel;
    globalThis.fetch = async (url, init) => {
      observedModel = JSON.parse(init.body).model;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    };
    await completeChat(
      { llm: { deepinfra_chat_model: 'mistralai/Mixtral-8x7B-Instruct-v0.1' } },
      { system: 's', user: 'u' },
    );
    assert.strictEqual(observedModel, 'mistralai/Mixtral-8x7B-Instruct-v0.1');
  });
});
