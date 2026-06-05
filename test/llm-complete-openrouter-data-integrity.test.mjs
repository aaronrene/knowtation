/**
 * Tier 5 — DATA INTEGRITY: the OpenRouter lane must transmit and return content exactly.
 *
 * Goal: prove the request body faithfully carries the caller's system/user text, model,
 * and max_tokens with no mutation, ordering change, or truncation, and that the response
 * content is returned verbatim (modulo the documented trim). Covers Unicode, very large
 * inputs, and multi-line content. Network is mocked.
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

function captureBody() {
  const ref = {};
  globalThis.fetch = async (url, init) => {
    ref.url = String(url);
    ref.body = JSON.parse(init.body);
    ref.headers = init.headers;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ack' } }] }) };
  };
  return ref;
}

describe('OpenRouter lane — data integrity', () => {
  beforeEach(() => {
    clearChatEnv();
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-data';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('sends system then user messages in order, content byte-for-byte', async () => {
    const ref = captureBody();
    const system = 'SYSTEM-PROMPT-αβγ\nline2';
    const user = 'USER-PROMPT-😀 with "quotes", <tags>, and \\backslashes\\';
    await completeChat({}, { system, user });
    assert.deepStrictEqual(ref.body.messages, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
  });

  it('preserves a very large note body without truncation', async () => {
    const ref = captureBody();
    const big = 'x'.repeat(200_000);
    await completeChat({}, { system: 's', user: big });
    assert.strictEqual(ref.body.messages[1].content.length, 200_000);
    assert.strictEqual(ref.body.messages[1].content, big);
  });

  it('carries the exact custom max_tokens value', async () => {
    const ref = captureBody();
    await completeChat({}, { system: 's', user: 'u', maxTokens: 777 });
    assert.strictEqual(ref.body.max_tokens, 777);
  });

  it('returns the completion content verbatim apart from outer-whitespace trim', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '\n\tInner  spaces kept 🚀\n' } }] }),
    });
    const out = await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(out, 'Inner  spaces kept 🚀');
  });

  it('serialises a JSON-bearing user payload safely (no double-encoding corruption)', async () => {
    const ref = captureBody();
    const user = JSON.stringify({ a: 1, b: ['two', { c: '日本語' }] });
    await completeChat({}, { system: 's', user });
    assert.strictEqual(ref.body.messages[1].content, user);
    assert.deepStrictEqual(JSON.parse(ref.body.messages[1].content), {
      a: 1,
      b: ['two', { c: '日本語' }],
    });
  });
});
