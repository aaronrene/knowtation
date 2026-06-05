/**
 * Config-driven chat-provider selection for completeChat (lib/llm-complete.mjs).
 *
 * Covers the new Hub-Settings-driven path: when KNOWTATION_CHAT_PROVIDER is unset, completeChat
 * honours config.llm.provider (persisted via the Settings UI → config/local.yaml). The env var
 * always takes precedence (operator lock), and selecting `ollama` forces the local lane even when
 * cloud keys are present. Also guards daemon delegation isolation (buildDelegateConfig).
 *
 * Tiers exercised here: unit + integration + security (provider isolation) + data-integrity
 * (precedence determinism). Network is mocked.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { completeChat } from '../lib/llm-complete.mjs';
import { buildDelegateConfig } from '../lib/daemon-llm.mjs';

const ORIG = { ...process.env };
const origFetch = globalThis.fetch;

const CHAT_ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPINFRA_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODEL',
  'KNOWTATION_CHAT_PROVIDER',
  'KNOWTATION_CHAT_PREFER_ANTHROPIC',
  'OLLAMA_URL',
  'OLLAMA_CHAT_MODEL',
  'OLLAMA_MODEL',
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

function mockByHost(handlers) {
  const hits = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    hits.push(u);
    for (const [needle, body] of Object.entries(handlers)) {
      if (u.includes(needle)) return { ok: true, json: async () => body, text: async () => '' };
    }
    return { ok: false, status: 599, text: async () => `unexpected host: ${u}` };
  };
  return hits;
}

const OPENAI_OK = { 'api.openai.com': { choices: [{ message: { content: 'openai' } }] } };
const ANTHROPIC_OK = { 'api.anthropic.com': { content: [{ text: 'anthropic' }] } };
const DEEPINFRA_OK = { 'api.deepinfra.com': { choices: [{ message: { content: 'deepinfra' } }] } };
const OPENROUTER_OK = { 'openrouter.ai': { choices: [{ message: { content: 'openrouter' } }] } };
const OLLAMA_OK = { '11434': { message: { content: 'ollama' } } };

describe('completeChat config.llm.provider resolution', () => {
  beforeEach(() => {
    clearChatEnv();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('routes by config.llm.provider when the env var is unset (openai)', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mockByHost(OPENAI_OK);
    const out = await completeChat({ llm: { provider: 'openai' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'openai');
  });

  it('routes by config.llm.provider = anthropic', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mockByHost(ANTHROPIC_OK);
    const out = await completeChat({ llm: { provider: 'anthropic' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'anthropic');
  });

  it('routes by config.llm.provider = deepinfra', async () => {
    process.env.DEEPINFRA_API_KEY = 'di';
    mockByHost(DEEPINFRA_OK);
    const out = await completeChat({ llm: { provider: 'deepinfra' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'deepinfra');
  });

  it('routes by config.llm.provider = openrouter', async () => {
    process.env.OPENROUTER_API_KEY = 'or';
    mockByHost(OPENROUTER_OK);
    const out = await completeChat({ llm: { provider: 'openrouter' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'openrouter');
  });

  it('config.llm.provider = ollama forces the local lane even when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    const hits = mockByHost(OLLAMA_OK);
    const out = await completeChat({ llm: { provider: 'ollama' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'ollama');
    assert.ok(hits.every((u) => !u.includes('api.openai.com')));
  });

  it('env KNOWTATION_CHAT_PROVIDER wins over config.llm.provider (operator lock)', async () => {
    process.env.KNOWTATION_CHAT_PROVIDER = 'anthropic';
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const hits = mockByHost(ANTHROPIC_OK);
    const out = await completeChat({ llm: { provider: 'openai' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'anthropic');
    assert.ok(hits.every((u) => !u.includes('api.openai.com')));
  });

  it('config provider openai without a key throws a source-agnostic, actionable error', async () => {
    globalThis.fetch = async () => {
      throw new Error('must not be called');
    };
    await assert.rejects(
      () => completeChat({ llm: { provider: 'openai' } }, { system: 's', user: 'u' }),
      /provider 'openai'.*OPENAI_API_KEY is not set/s,
    );
  });

  it('empty config provider falls through to the default chain (no behaviour change)', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    mockByHost(OPENAI_OK);
    const out = await completeChat({ llm: { provider: '' } }, { system: 's', user: 'u' });
    assert.strictEqual(out, 'openai');
  });
});

describe('buildDelegateConfig provider isolation (daemon vs global chat provider)', () => {
  it('pins provider=ollama for the ollama delegate path', () => {
    const merged = buildDelegateConfig({ llm: { provider: 'openai' } }, { provider: 'ollama', model: null });
    assert.strictEqual(merged.llm.provider, 'ollama');
  });

  it('pins provider=anthropic for the anthropic delegate path', () => {
    const merged = buildDelegateConfig({ llm: { provider: 'openrouter' } }, { provider: 'anthropic', model: 'claude-x' });
    assert.strictEqual(merged.llm.provider, 'anthropic');
    assert.strictEqual(merged.llm.anthropic_chat_model, 'claude-x');
  });

  it('leaves provider unset for the null/openai delegate path (completeChat precedence applies)', () => {
    const merged = buildDelegateConfig({ llm: { provider: 'openrouter' } }, { provider: null, model: 'gpt' });
    assert.strictEqual(merged.llm.provider, 'openrouter');
    assert.strictEqual(merged.llm.openai_chat_model, 'gpt');
  });

  it('daemon ollama delegation forces ollama even when global chat provider is openai', async () => {
    const savedFetch = globalThis.fetch;
    const savedEnv = { ...process.env };
    for (const k of CHAT_ENV_KEYS) delete process.env[k];
    process.env.OPENAI_API_KEY = 'sk-openai';
    const hits = mockByHost(OLLAMA_OK);
    try {
      const merged = buildDelegateConfig({ llm: { provider: 'openai' } }, { provider: 'ollama', model: null });
      const out = await completeChat(merged, { system: 's', user: 'u' });
      assert.strictEqual(out, 'ollama');
      assert.ok(hits.every((u) => !u.includes('api.openai.com')));
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of CHAT_ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  });
});
