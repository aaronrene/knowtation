/**
 * Tier 1 — UNIT: OpenRouter provider lane in completeChat (lib/llm-complete.mjs).
 *
 * Scope: the smallest behavioural contract of the openrouter lane in isolation —
 * provider selection, key requirement, model resolution precedence, default model,
 * optional attribution headers, and response extraction. All network is mocked; no
 * real OpenRouter endpoint is contacted.
 *
 * Why this lane exists: docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md §4/§6
 * defines OpenRouter as a "bring your own key" lane (user pays the provider directly; never
 * metered against Knowtation packs).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { completeChat } from '../lib/llm-complete.mjs';

const ORIG = {
  fetch: globalThis.fetch,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_CHAT_MODEL: process.env.OPENROUTER_CHAT_MODEL,
  OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL,
  OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE,
  KNOWTATION_CHAT_PROVIDER: process.env.KNOWTATION_CHAT_PROVIDER,
  KNOWTATION_CHAT_PREFER_ANTHROPIC: process.env.KNOWTATION_CHAT_PREFER_ANTHROPIC,
};

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

/**
 * Capture the single fetch call and return a fixed completion.
 * @param {string} content
 * @returns {{ calls: { url: string, init: RequestInit }[] }}
 */
function mockOpenRouterOk(content) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  };
  return calls;
}

describe('OpenRouter lane — unit', () => {
  beforeEach(() => {
    clearChatEnv();
  });

  afterEach(() => {
    globalThis.fetch = ORIG.fetch;
    restoreEnv();
  });

  it('routes to OpenRouter when KNOWTATION_CHAT_PROVIDER=openrouter and key is set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    const calls = mockOpenRouterOk('from-openrouter');
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openrouter');
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].url.includes('openrouter.ai/api/v1/chat/completions'));
  });

  it('throws an actionable error when OPENROUTER_API_KEY is missing', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    globalThis.fetch = async () => {
      throw new Error('fetch must not be called when the key is missing');
    };
    await assert.rejects(
      () => completeChat({}, { system: 's', user: 'u' }),
      /OPENROUTER_API_KEY is not set/,
    );
  });

  it('uses the default model openai/gpt-4o-mini when no override is set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    const calls = mockOpenRouterOk('ok');
    await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(JSON.parse(calls[0].init.body).model, 'openai/gpt-4o-mini');
  });

  it('honours OPENROUTER_CHAT_MODEL env override', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.OPENROUTER_CHAT_MODEL = 'anthropic/claude-3.5-haiku';
    const calls = mockOpenRouterOk('ok');
    await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(JSON.parse(calls[0].init.body).model, 'anthropic/claude-3.5-haiku');
  });

  it('honours config.llm.openrouter_chat_model over the env override (caller wins)', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.OPENROUTER_CHAT_MODEL = 'anthropic/claude-3.5-haiku';
    const calls = mockOpenRouterOk('ok');
    await completeChat(
      { llm: { openrouter_chat_model: 'meta-llama/llama-3.1-8b-instruct' } },
      { system: 's', user: 'u' },
    );
    assert.strictEqual(
      JSON.parse(calls[0].init.body).model,
      'meta-llama/llama-3.1-8b-instruct',
    );
  });

  it('omits attribution headers when neither OPENROUTER_SITE_URL nor OPENROUTER_APP_TITLE is set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    const calls = mockOpenRouterOk('ok');
    await completeChat({}, { system: 's', user: 'u' });
    const headers = calls[0].init.headers;
    assert.strictEqual(headers['HTTP-Referer'], undefined);
    assert.strictEqual(headers['X-Title'], undefined);
  });

  it('adds attribution headers only when the env vars are set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.OPENROUTER_SITE_URL = 'https://knowtation.example';
    process.env.OPENROUTER_APP_TITLE = 'Knowtation';
    const calls = mockOpenRouterOk('ok');
    await completeChat({}, { system: 's', user: 'u' });
    const headers = calls[0].init.headers;
    assert.strictEqual(headers['HTTP-Referer'], 'https://knowtation.example');
    assert.strictEqual(headers['X-Title'], 'Knowtation');
  });

  it('trims surrounding whitespace from the model output', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    mockOpenRouterOk('  spaced answer\n');
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'spaced answer');
  });

  it('throws on an empty completion (no silent empty string)', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [] }) });
    await assert.rejects(
      () => completeChat({}, { system: 's', user: 'u' }),
      /OpenRouter chat: empty response/,
    );
  });
});
