/**
 * Ollama embed base URL validation (no network): prevents Undici "Invalid URL" from malformed OLLAMA_URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeOllamaEmbedBaseUrl } from '../lib/embedding.mjs';

describe('normalizeOllamaEmbedBaseUrl', () => {
  it('accepts http localhost with port', () => {
    assert.strictEqual(normalizeOllamaEmbedBaseUrl('http://localhost:11434'), 'http://localhost:11434');
    assert.strictEqual(normalizeOllamaEmbedBaseUrl('http://localhost:11434/'), 'http://localhost:11434');
  });

  it('accepts https host', () => {
    assert.strictEqual(normalizeOllamaEmbedBaseUrl('https://ollama.example.com'), 'https://ollama.example.com');
    assert.strictEqual(normalizeOllamaEmbedBaseUrl('  https://ollama.example.com/  '), 'https://ollama.example.com');
  });

  it('uses default when null or empty string', () => {
    assert.strictEqual(normalizeOllamaEmbedBaseUrl(null), 'http://localhost:11434');
    assert.strictEqual(normalizeOllamaEmbedBaseUrl(''), 'http://localhost:11434');
  });

  it('rejects host without scheme', () => {
    assert.throws(
      () => normalizeOllamaEmbedBaseUrl('localhost:11434'),
      /absolute http\(s\) URL/i,
    );
    assert.throws(
      () => normalizeOllamaEmbedBaseUrl('api.ollama.com'),
      /absolute http\(s\) URL/i,
    );
  });

  it('rejects whitespace-only', () => {
    assert.throws(
      () => normalizeOllamaEmbedBaseUrl('   '),
      /empty after trim/i,
    );
  });

  it('rejects non-http protocols', () => {
    assert.throws(
      () => normalizeOllamaEmbedBaseUrl('ftp://example.com'),
      /starting with http:\/\/ or https:\/\//,
    );
  });
});
