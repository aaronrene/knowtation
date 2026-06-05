/**
 * Tier 2 — INTEGRATION: OpenRouter lane interacting with the rest of completeChat's
 * provider-selection logic (lib/llm-complete.mjs).
 *
 * Scope: how the openrouter lane composes with the other provider rules — explicit
 * selection wins over co-present keys, and OpenRouter is NEVER selected implicitly
 * (backward-compatibility guarantee: adding OPENROUTER_API_KEY to a deployment must not
 * silently change the active provider). Network is mocked.
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

/** Route by hostname; record every host that was hit. */
function mockByHost(handlers) {
  const hits = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    hits.push(u);
    for (const [needle, body] of Object.entries(handlers)) {
      if (u.includes(needle)) {
        return { ok: true, json: async () => body };
      }
    }
    return { ok: false, status: 599, text: async () => `unexpected host: ${u}` };
  };
  return hits;
}

describe('OpenRouter lane — integration with provider selection', () => {
  beforeEach(() => {
    clearChatEnv();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('explicit openrouter wins even when OpenAI, Anthropic, and DeepInfra keys are all set', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    process.env.DEEPINFRA_API_KEY = 'di-test';
    const hits = mockByHost({
      'openrouter.ai': { choices: [{ message: { content: 'from-openrouter' } }] },
    });
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openrouter');
    assert.ok(hits.every((u) => u.includes('openrouter.ai')));
  });

  it('OPENROUTER_API_KEY alone (no explicit provider) does NOT change the default — OpenAI stays primary', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    process.env.OPENAI_API_KEY = 'sk-openai';
    const hits = mockByHost({
      'api.openai.com': { choices: [{ message: { content: 'from-openai-default' } }] },
    });
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-openai-default');
    assert.ok(hits.every((u) => !u.includes('openrouter.ai')));
  });

  it('OPENROUTER_API_KEY alone with no other keys still does NOT route to OpenRouter (explicit-only)', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    // No OpenAI/Anthropic/DeepInfra → default path falls through to Ollama, not OpenRouter.
    const hits = mockByHost({
      'localhost:11434': { message: { content: 'from-ollama' } },
    });
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'from-ollama');
    assert.ok(hits.every((u) => !u.includes('openrouter.ai')));
  });

  it('propagates an OpenRouter HTTP error through completeChat with status detail', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test';
    globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
    await assert.rejects(
      () => completeChat({}, { system: 's', user: 'u' }),
      /OpenRouter chat failed: 429/,
    );
  });
});
