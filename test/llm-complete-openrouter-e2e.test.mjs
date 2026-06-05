/**
 * Tier 3 — END-TO-END: OpenRouter lane exercised the way real callers use completeChat
 * (e.g. MCP summarize and Hub proposal LLM jobs), with a realistic OpenRouter response
 * envelope. The HTTP boundary is mocked, but everything from caller config → provider
 * selection → request shaping → response extraction runs end to end.
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

describe('OpenRouter lane — end to end', () => {
  beforeEach(() => {
    clearChatEnv();
    process.env.KNOWTATION_CHAT_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-e2e';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  it('summarize-style call returns the model summary from a realistic OpenRouter envelope', async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
      return {
        ok: true,
        json: async () => ({
          id: 'gen-abc123',
          model: 'openai/gpt-4o-mini',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'A concise three-line summary.' },
            },
          ],
          usage: { prompt_tokens: 42, completion_tokens: 11, total_tokens: 53 },
        }),
      };
    };

    const config = { llm: { openrouter_chat_model: 'openai/gpt-4o-mini' } };
    const out = await completeChat(config, {
      system: 'You write concise note summaries.',
      user: 'Summarize: The mitochondria is the powerhouse of the cell.',
      maxTokens: 128,
    });

    assert.strictEqual(out, 'A concise three-line summary.');
    assert.ok(captured.url.startsWith('https://openrouter.ai/api/v1/chat/completions'));
    assert.strictEqual(captured.body.model, 'openai/gpt-4o-mini');
    assert.strictEqual(captured.body.max_tokens, 128);
    assert.strictEqual(captured.body.messages[0].role, 'system');
    assert.strictEqual(captured.body.messages[0].content, 'You write concise note summaries.');
    assert.strictEqual(captured.body.messages[1].role, 'user');
    assert.match(captured.body.messages[1].content, /powerhouse of the cell/);
    assert.strictEqual(captured.headers.Authorization, 'Bearer or-e2e');
  });

  it('defaults max_tokens to 512 when the caller omits it', async () => {
    let body;
    globalThis.fetch = async (url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    await completeChat({}, { system: 's', user: 'u' });
    assert.strictEqual(body.max_tokens, 512);
  });
});
