/**
 * loadLlmConfig — parsing/validation of the top-level `llm` block (lib/config.mjs).
 *
 * This is the data-integrity + security boundary for the persisted chat-provider setting: an
 * invalid or hostile provider value in config/local.yaml must never reach completeChat as an
 * unknown/forced provider. Only whitelisted providers survive; everything else collapses to ''
 * (auto-detect).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadLlmConfig, CHAT_PROVIDERS } from '../lib/config.mjs';

describe('loadLlmConfig', () => {
  it('accepts each whitelisted provider', () => {
    for (const p of CHAT_PROVIDERS) {
      assert.strictEqual(loadLlmConfig({ provider: p }).provider, p);
    }
  });

  it('lowercases and trims the provider', () => {
    assert.strictEqual(loadLlmConfig({ provider: '  OpenAI  ' }).provider, 'openai');
  });

  it('drops an unknown provider to "" (auto-detect)', () => {
    assert.strictEqual(loadLlmConfig({ provider: 'totally-made-up' }).provider, '');
  });

  it('drops an injection-style provider value', () => {
    assert.strictEqual(loadLlmConfig({ provider: 'openai; rm -rf /' }).provider, '');
    assert.strictEqual(loadLlmConfig({ provider: '../../etc/passwd' }).provider, '');
  });

  it('handles missing / non-object input safely', () => {
    assert.strictEqual(loadLlmConfig(undefined).provider, '');
    assert.strictEqual(loadLlmConfig(null).provider, '');
    assert.strictEqual(loadLlmConfig('nope').provider, '');
    assert.strictEqual(loadLlmConfig(42).provider, '');
  });

  it('passes through model overrides, defaulting absent ones to undefined', () => {
    const out = loadLlmConfig({
      provider: 'openrouter',
      openrouter_chat_model: 'anthropic/claude-3.5-haiku',
    });
    assert.strictEqual(out.openrouter_chat_model, 'anthropic/claude-3.5-haiku');
    assert.strictEqual(out.openai_chat_model, undefined);
    assert.strictEqual(out.anthropic_chat_model, undefined);
    assert.strictEqual(out.deepinfra_chat_model, undefined);
    assert.strictEqual(out.ollama_chat_model, undefined);
  });

  it('CHAT_PROVIDERS lists exactly the providers completeChat handles explicitly', () => {
    assert.deepStrictEqual(
      [...CHAT_PROVIDERS].sort(),
      ['anthropic', 'deepinfra', 'ollama', 'openai', 'openrouter'],
    );
  });
});
