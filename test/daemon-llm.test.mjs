/**
 * Tests for lib/daemon-llm.mjs — Phase E: OpenAI-Compatible API Support.
 *
 * Covers:
 *  1. resolveApiKey — reads from named env var or falls back to OPENAI_API_KEY
 *  2. buildDelegateConfig — patches model into the right llm config field per provider
 *  3. callOpenAiCompat — constructs URL, headers, body; handles HTTP errors and empty responses
 *  4. daemonLlm routing:
 *       a. base_url passed through to fetch (OpenRouter, vLLM, LM Studio URLs)
 *       b. api_key_env resolution — reads from the named env var
 *       c. provider: null + base_url → openai-compat path
 *       d. provider: "openai" + base_url → openai-compat path
 *       e. provider: "openai" without base_url → default OpenAI URL
 *       f. provider: "anthropic" ignores base_url, delegates to completeChat (warns)
 *       g. provider: "ollama" delegates to completeChat
 *       h. no daemon config → falls through to completeChat
 *       i. missing API key → throws descriptive error
 *       j. HTTP error from endpoint → throws with URL in message
 *       k. model from daemon config passed in request body
 *       l. max_tokens from daemon config honoured
 *       m. trailing slash on base_url is stripped from the URL
 *  5. loadDaemonConfig integration:
 *       a. KNOWTATION_DAEMON_LLM_BASE_URL env var is parsed and surfaced
 *       b. api_key_env from YAML passes through
 *  6. consolidateMemory end-to-end via daemonLlm wrapper:
 *       a. daemon.llm.base_url routes fetch to the custom endpoint
 *       b. daemon.llm.api_key_env supplies the correct Authorization header
 *
 * All fetch calls are mocked via globalThis.fetch. No real HTTP requests are made.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  daemonLlm,
  resolveApiKey,
  buildDelegateConfig,
  callOpenAiCompat,
} from '../lib/daemon-llm.mjs';

import { loadDaemonConfig } from '../lib/config.mjs';
import { consolidateMemory } from '../lib/memory-consolidate.mjs';
import { createMemoryManager } from '../lib/memory.mjs';

// ── Test fixtures ─────────────────────────────────────────────────────────────

let tmpDir;
let vaultDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-daemon-llm-test-'));
  vaultDir = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'note.md'), '---\ntitle: note\n---\nHello', 'utf8');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a minimal loadConfig()-shaped object with optional daemon.llm overrides. */
function makeConfig(daemonLlmOverrides = {}, extra = {}) {
  const dataDir = path.join(tmpDir, `data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    vault_path: vaultDir,
    data_dir: dataDir,
    memory: { enabled: true, provider: 'file' },
    llm: {},
    daemon: loadDaemonConfig({
      llm: daemonLlmOverrides,
    }),
    ...extra,
  };
}

/**
 * Save current values of the given env var names, apply `patch`, run `fn`,
 * then restore originals — even if `fn` throws.
 *
 * @param {Record<string, string|undefined>} patch — set value to undefined to delete the var
 * @param {Function} fn
 */
async function withEnv(patch, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(patch)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [k, orig] of Object.entries(saved)) {
      if (orig === undefined) delete process.env[k];
      else process.env[k] = orig;
    }
  }
}

/** Create a mock fetch that returns a successful OpenAI-compat response. */
function makeFetchOk(text = 'mocked response') {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: text } }] }),
      text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }),
    };
  };
  fn.calls = calls;
  return fn;
}

/** Create a mock fetch that returns an HTTP error. */
function makeFetchError(status = 401, body = 'Unauthorized') {
  return async (url) => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

/** Create a mock fetch that returns OK but with no content in choices. */
function makeFetchEmpty() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '' } }] }),
    text: async () => '{"choices":[{"message":{"content":""}}]}',
  });
}

// ── 1. resolveApiKey ──────────────────────────────────────────────────────────

describe('resolveApiKey', () => {
  it('returns OPENAI_API_KEY when apiKeyEnv is null', async () => {
    await withEnv({ OPENAI_API_KEY: 'sk-test-main' }, () => {
      assert.equal(resolveApiKey(null), 'sk-test-main');
    });
  });

  it('returns OPENAI_API_KEY when apiKeyEnv is undefined', async () => {
    await withEnv({ OPENAI_API_KEY: 'sk-test-main' }, () => {
      assert.equal(resolveApiKey(undefined), 'sk-test-main');
    });
  });

  it('returns null when OPENAI_API_KEY is unset and no apiKeyEnv', async () => {
    await withEnv({ OPENAI_API_KEY: undefined }, () => {
      assert.equal(resolveApiKey(null), null);
    });
  });

  it('reads from the named env var when apiKeyEnv is set', async () => {
    await withEnv(
      { OPENAI_API_KEY: 'sk-main', OPENROUTER_API_KEY: 'sk-openrouter' },
      () => {
        assert.equal(resolveApiKey('OPENROUTER_API_KEY'), 'sk-openrouter');
      },
    );
  });

  it('returns null when the named env var is unset', async () => {
    await withEnv({ MY_DAEMON_KEY: undefined }, () => {
      assert.equal(resolveApiKey('MY_DAEMON_KEY'), null);
    });
  });

  it('named env var takes precedence over OPENAI_API_KEY', async () => {
    await withEnv({ OPENAI_API_KEY: 'sk-main', DAEMON_KEY: 'sk-daemon' }, () => {
      assert.equal(resolveApiKey('DAEMON_KEY'), 'sk-daemon');
    });
  });
});

// ── 2. buildDelegateConfig ────────────────────────────────────────────────────

describe('buildDelegateConfig', () => {
  it('returns the original config when model is null', () => {
    const config = makeConfig();
    const result = buildDelegateConfig(config, { provider: 'openai', model: null });
    assert.equal(result, config);
  });

  it('patches openai_chat_model for provider: openai', () => {
    const config = makeConfig();
    const result = buildDelegateConfig(config, { provider: 'openai', model: 'gpt-4o' });
    assert.equal(result.llm.openai_chat_model, 'gpt-4o');
  });

  it('patches openai_chat_model for provider: null', () => {
    const config = makeConfig();
    const result = buildDelegateConfig(config, { provider: null, model: 'gpt-4o-mini' });
    assert.equal(result.llm.openai_chat_model, 'gpt-4o-mini');
  });

  it('patches anthropic_chat_model for provider: anthropic', () => {
    const config = makeConfig();
    const result = buildDelegateConfig(config, { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' });
    assert.equal(result.llm.anthropic_chat_model, 'claude-3-5-haiku-20241022');
  });

  it('patches ollama_chat_model for provider: ollama', () => {
    const config = makeConfig();
    const result = buildDelegateConfig(config, { provider: 'ollama', model: 'llama3.2' });
    assert.equal(result.llm.ollama_chat_model, 'llama3.2');
  });

  it('preserves other llm fields when patching', () => {
    const config = { ...makeConfig(), llm: { some_other_field: 'preserved' } };
    const result = buildDelegateConfig(config, { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' });
    assert.equal(result.llm.some_other_field, 'preserved');
    assert.equal(result.llm.anthropic_chat_model, 'claude-3-5-haiku-20241022');
  });

  it('does not mutate the original config', () => {
    const config = makeConfig();
    buildDelegateConfig(config, { provider: 'openai', model: 'gpt-4o' });
    assert.equal(config.llm.openai_chat_model, undefined);
  });
});

// ── 3. callOpenAiCompat ───────────────────────────────────────────────────────

describe('callOpenAiCompat', () => {
  it('calls fetch with the correct URL (base_url + /chat/completions)', async () => {
    const mockFetch = makeFetchOk('hello');
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await callOpenAiCompat({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
        model: 'mistral-7b',
        maxTokens: 512,
        system: 'sys',
        user: 'usr',
      });
      assert.equal(mockFetch.calls.length, 1);
      assert.equal(mockFetch.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('strips a trailing slash from base_url before appending /chat/completions', async () => {
    const mockFetch = makeFetchOk('ok');
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await callOpenAiCompat({
        baseUrl: 'http://localhost:8000/v1/',
        apiKey: 'sk-test',
        model: 'llama',
        maxTokens: 128,
        system: 's',
        user: 'u',
      });
      assert.equal(mockFetch.calls[0].url, 'http://localhost:8000/v1/chat/completions');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends Authorization Bearer header with the apiKey', async () => {
    const mockFetch = makeFetchOk('ok');
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await callOpenAiCompat({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-secret-key',
        model: 'x',
        maxTokens: 10,
        system: 's',
        user: 'u',
      });
      assert.equal(
        mockFetch.calls[0].init.headers['Authorization'],
        'Bearer sk-secret-key',
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends model and max_tokens in the request body', async () => {
    const mockFetch = makeFetchOk('ok');
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await callOpenAiCompat({
        baseUrl: 'http://localhost:1234/v1',
        apiKey: 'sk',
        model: 'local-model-7b',
        maxTokens: 256,
        system: 'System prompt',
        user: 'User prompt',
      });
      const body = JSON.parse(mockFetch.calls[0].init.body);
      assert.equal(body.model, 'local-model-7b');
      assert.equal(body.max_tokens, 256);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[0].content, 'System prompt');
      assert.equal(body.messages[1].role, 'user');
      assert.equal(body.messages[1].content, 'User prompt');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns the trimmed content from choices[0].message.content', async () => {
    const mockFetch = makeFetchOk('  trimmed result  ');
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const result = await callOpenAiCompat({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk',
        model: 'x',
        maxTokens: 10,
        system: 's',
        user: 'u',
      });
      assert.equal(result, 'trimmed result');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws with URL in message when fetch returns non-OK status', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchError(401, 'Unauthorized');
    try {
      await assert.rejects(
        () =>
          callOpenAiCompat({
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'bad-key',
            model: 'x',
            maxTokens: 10,
            system: 's',
            user: 'u',
          }),
        (err) => {
          assert.ok(err.message.includes('https://openrouter.ai/api/v1/chat/completions'));
          assert.ok(err.message.includes('401'));
          assert.ok(err.message.includes('Unauthorized'));
          return true;
        },
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws with URL in message when response has empty content', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchEmpty();
    try {
      await assert.rejects(
        () =>
          callOpenAiCompat({
            baseUrl: 'http://localhost:8000/v1',
            apiKey: 'sk',
            model: 'x',
            maxTokens: 10,
            system: 's',
            user: 'u',
          }),
        (err) => {
          assert.ok(err.message.includes('http://localhost:8000/v1/chat/completions'));
          assert.ok(err.message.toLowerCase().includes('empty'));
          return true;
        },
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ── 4. daemonLlm routing ──────────────────────────────────────────────────────

describe('daemonLlm', () => {
  // 4a. base_url passed through to fetch
  describe('base_url routing', () => {
    it('OpenRouter: routes fetch to openrouter.ai/api/v1/chat/completions', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1' });
      const mockFetch = makeFetchOk('fact');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-test' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('vLLM: routes fetch to localhost:8000/v1/chat/completions', async () => {
      const config = makeConfig({ base_url: 'http://localhost:8000/v1' });
      const mockFetch = makeFetchOk('fact');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-local' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'http://localhost:8000/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('LM Studio: routes fetch to localhost:1234/v1/chat/completions', async () => {
      const config = makeConfig({ base_url: 'http://localhost:1234/v1' });
      const mockFetch = makeFetchOk('fact');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'lm-studio' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'http://localhost:1234/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('arbitrary OpenAI-compat URL is honoured', async () => {
      const config = makeConfig({ base_url: 'https://my-proxy.example.com/openai/v1' });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-proxy' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(
          mockFetch.calls[0].url,
          'https://my-proxy.example.com/openai/v1/chat/completions',
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('strips trailing slash from base_url', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1/' });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4b. api_key_env resolution
  describe('api_key_env', () => {
    it('reads from the named env var when api_key_env is set', async () => {
      const config = makeConfig({
        base_url: 'https://openrouter.ai/api/v1',
        api_key_env: 'OPENROUTER_API_KEY',
      });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv(
          { OPENAI_API_KEY: 'sk-main', OPENROUTER_API_KEY: 'sk-openrouter-custom' },
          () => daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(
          mockFetch.calls[0].init.headers['Authorization'],
          'Bearer sk-openrouter-custom',
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('api_key_env takes precedence over OPENAI_API_KEY', async () => {
      const config = makeConfig({
        base_url: 'http://localhost:8000/v1',
        api_key_env: 'MY_LOCAL_KEY',
      });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-main', MY_LOCAL_KEY: 'local-bearer-token' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(
          mockFetch.calls[0].init.headers['Authorization'],
          'Bearer local-bearer-token',
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('throws with descriptive error when named env var is unset', async () => {
      const config = makeConfig({
        base_url: 'https://openrouter.ai/api/v1',
        api_key_env: 'MISSING_KEY_VAR',
      });
      const origFetch = globalThis.fetch;
      globalThis.fetch = makeFetchOk('ok');
      try {
        await withEnv({ MISSING_KEY_VAR: undefined, OPENAI_API_KEY: undefined }, async () => {
          await assert.rejects(
            () => daemonLlm(config, { system: 's', user: 'u' }),
            (err) => {
              assert.ok(err.message.includes('MISSING_KEY_VAR'));
              return true;
            },
          );
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('works without base_url when api_key_env is set (uses OpenAI default URL)', async () => {
      const config = makeConfig({ api_key_env: 'MY_OPENAI_KEY' });
      const mockFetch = makeFetchOk('answer');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ MY_OPENAI_KEY: 'sk-custom-key' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(
          mockFetch.calls[0].init.headers['Authorization'],
          'Bearer sk-custom-key',
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4c. provider: null + base_url → openai-compat
  describe('provider: null + base_url', () => {
    it('uses openai-compat path when provider is null and base_url is set', async () => {
      const config = makeConfig({ provider: null, base_url: 'https://openrouter.ai/api/v1' });
      const mockFetch = makeFetchOk('facts');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-test' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4d. provider: "openai" + base_url → openai-compat
  describe('provider: "openai" + base_url', () => {
    it('uses openai-compat path with the custom base_url', async () => {
      const config = makeConfig({
        provider: 'openai',
        base_url: 'https://openrouter.ai/api/v1',
      });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-test' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4e. provider: "openai" without base_url → default OpenAI URL
  describe('provider: "openai" without base_url', () => {
    it('calls the default OpenAI URL', async () => {
      const config = makeConfig({ provider: 'openai' });
      const mockFetch = makeFetchOk('answer');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-openai' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'https://api.openai.com/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('uses OPENAI_API_KEY when api_key_env is not set', async () => {
      const config = makeConfig({ provider: 'openai' });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-from-env' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(
          mockFetch.calls[0].init.headers['Authorization'],
          'Bearer sk-from-env',
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4f. provider: "anthropic" ignores base_url, delegates to completeChat
  describe('provider: "anthropic"', () => {
    it('delegates to completeChat anthropic path even when base_url is set', async () => {
      const config = makeConfig({
        provider: 'anthropic',
        base_url: 'https://openrouter.ai/api/v1',
        model: 'claude-3-5-haiku-20241022',
      });
      const mockFetch = makeFetchOk('anthropic response');
      // Stub fetch so completeChat anthropic path is intercepted
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        mockFetch.calls.push({ url: String(url), init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ type: 'text', text: 'anthropic response' }],
          }),
          text: async () => JSON.stringify({ content: [{ type: 'text', text: 'anthropic response' }] }),
        };
      };
      mockFetch.calls = [];
      try {
        await withEnv(
          { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: 'sk-ant-test' },
          async () => {
            const result = await daemonLlm(config, { system: 's', user: 'u' });
            assert.equal(result, 'anthropic response');
            // Should have called anthropic URL, not openrouter
            assert.ok(mockFetch.calls.length > 0, 'fetch was called');
            assert.ok(
              mockFetch.calls[0].url.includes('anthropic.com'),
              `Expected anthropic URL, got: ${mockFetch.calls[0].url}`,
            );
            assert.ok(
              !mockFetch.calls[0].url.includes('openrouter'),
              'Should NOT call openrouter when provider is anthropic',
            );
          },
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('writes a warning to stderr when base_url is set with provider: anthropic', async () => {
      const config = makeConfig({
        provider: 'anthropic',
        base_url: 'https://openrouter.ai/api/v1',
      });
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        text: async () => '{}',
      });
      const origWrite = process.stderr.write.bind(process.stderr);
      const stderrLines = [];
      process.stderr.write = (data, ...args) => {
        stderrLines.push(String(data));
        return origWrite(data, ...args);
      };
      try {
        await withEnv({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: 'sk-ant' }, async () => {
          try {
            await daemonLlm(config, { system: 's', user: 'u' });
          } catch {
            // ignore LLM errors — we only care about the warning
          }
        });
        assert.ok(
          stderrLines.some((l) => l.includes('base_url') && l.includes('anthropic')),
          'Expected a warning mentioning base_url and anthropic',
        );
      } finally {
        process.stderr.write = origWrite;
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4g. provider: "ollama" delegates to completeChat
  describe('provider: "ollama"', () => {
    it('delegates to completeChat ollama path (calls /api/chat)', async () => {
      const config = makeConfig({ provider: 'ollama', model: 'llama3.2' });
      const mockFetch = makeFetchOk('');
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        mockFetch.calls.push({ url: String(url), init });
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: 'ollama response' } }),
          text: async () => '{}',
        };
      };
      mockFetch.calls = [];
      try {
        await withEnv(
          { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
          async () => {
            const result = await daemonLlm(config, { system: 's', user: 'u' });
            assert.equal(result, 'ollama response');
            assert.ok(mockFetch.calls.length > 0, 'fetch was called');
            assert.ok(
              mockFetch.calls[0].url.includes('/api/chat'),
              `Expected ollama /api/chat, got: ${mockFetch.calls[0].url}`,
            );
          },
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4h. no daemon config → falls through to completeChat
  describe('no daemon-specific config', () => {
    it('falls through to completeChat when no base_url, provider, or api_key_env', async () => {
      // Daemon config with all nulls — should behave like completeChat
      const config = makeConfig({ provider: null, base_url: null, api_key_env: null });
      const mockFetch = makeFetchOk('openai-auto');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk-auto' }, async () => {
          const result = await daemonLlm(config, { system: 's', user: 'u' });
          // completeChat uses OPENAI_API_KEY → calls OpenAI
          assert.equal(result, 'openai-auto');
          assert.ok(mockFetch.calls[0].url.includes('openai.com'));
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4i. missing API key → throws descriptive error
  describe('missing API key', () => {
    it('throws with OPENAI_API_KEY mentioned when no key is configured', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1' });
      const origFetch = globalThis.fetch;
      globalThis.fetch = makeFetchOk('ok');
      try {
        await withEnv({ OPENAI_API_KEY: undefined }, async () => {
          await assert.rejects(
            () => daemonLlm(config, { system: 's', user: 'u' }),
            (err) => {
              assert.ok(err.message.includes('OPENAI_API_KEY'));
              return true;
            },
          );
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('throws with api_key_env name mentioned when that var is unset', async () => {
      const config = makeConfig({
        base_url: 'https://openrouter.ai/api/v1',
        api_key_env: 'OPENROUTER_KEY',
      });
      const origFetch = globalThis.fetch;
      globalThis.fetch = makeFetchOk('ok');
      try {
        await withEnv({ OPENROUTER_KEY: undefined, OPENAI_API_KEY: undefined }, async () => {
          await assert.rejects(
            () => daemonLlm(config, { system: 's', user: 'u' }),
            (err) => {
              assert.ok(err.message.includes('OPENROUTER_KEY'));
              return true;
            },
          );
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4j. HTTP error from custom endpoint → throws with URL in message
  describe('HTTP errors', () => {
    it('throws with the endpoint URL when fetch returns 401', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1' });
      const origFetch = globalThis.fetch;
      globalThis.fetch = makeFetchError(401, 'Unauthorized');
      try {
        await withEnv({ OPENAI_API_KEY: 'bad-key' }, async () => {
          await assert.rejects(
            () => daemonLlm(config, { system: 's', user: 'u' }),
            (err) => {
              assert.ok(err.message.includes('https://openrouter.ai/api/v1/chat/completions'));
              assert.ok(err.message.includes('401'));
              return true;
            },
          );
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('throws with the endpoint URL when fetch returns 502', async () => {
      const config = makeConfig({ base_url: 'http://localhost:8000/v1' });
      const origFetch = globalThis.fetch;
      globalThis.fetch = makeFetchError(502, 'Bad Gateway');
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, async () => {
          await assert.rejects(
            () => daemonLlm(config, { system: 's', user: 'u' }),
            (err) => {
              assert.ok(err.message.includes('http://localhost:8000/v1/chat/completions'));
              assert.ok(err.message.includes('502'));
              return true;
            },
          );
        });
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4k. model from daemon config passed in request body
  describe('model override', () => {
    it('sends daemon.llm.model in the request body', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1', model: 'mistralai/mixtral-8x7b' });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        const body = JSON.parse(mockFetch.calls[0].init.body);
        assert.equal(body.model, 'mistralai/mixtral-8x7b');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('falls back to gpt-4o-mini when no model is configured', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1', model: null });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        const body = JSON.parse(mockFetch.calls[0].init.body);
        assert.equal(body.model, 'gpt-4o-mini');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4l. max_tokens from daemon config
  describe('max_tokens', () => {
    it('sends daemon.llm.max_tokens in the request body', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1', max_tokens: 2048 });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        const body = JSON.parse(mockFetch.calls[0].init.body);
        assert.equal(body.max_tokens, 2048);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('opts.maxTokens overrides daemon.llm.max_tokens', async () => {
      const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1', max_tokens: 2048 });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, () =>
          daemonLlm(config, { system: 's', user: 'u', maxTokens: 512 }),
        );
        const body = JSON.parse(mockFetch.calls[0].init.body);
        assert.equal(body.max_tokens, 512);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // 4m. trailing slash on base_url
  describe('trailing slash handling', () => {
    it('removes trailing slash before appending /chat/completions', async () => {
      const config = makeConfig({ base_url: 'http://localhost:1234/v1/' });
      const mockFetch = makeFetchOk('ok');
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        await withEnv({ OPENAI_API_KEY: 'sk' }, () =>
          daemonLlm(config, { system: 's', user: 'u' }),
        );
        assert.equal(mockFetch.calls[0].url, 'http://localhost:1234/v1/chat/completions');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

// ── 5. loadDaemonConfig integration ──────────────────────────────────────────

describe('loadDaemonConfig integration with daemon-llm', () => {
  it('KNOWTATION_DAEMON_LLM_BASE_URL env var is parsed and available at config.daemon.llm.base_url', async () => {
    await withEnv(
      { KNOWTATION_DAEMON_LLM_BASE_URL: 'https://my-endpoint.example.com/v1' },
      () => {
        const daemonCfg = loadDaemonConfig({});
        assert.equal(daemonCfg.llm.base_url, 'https://my-endpoint.example.com/v1');
      },
    );
  });

  it('KNOWTATION_DAEMON_LLM_BASE_URL overrides YAML base_url value', async () => {
    await withEnv(
      { KNOWTATION_DAEMON_LLM_BASE_URL: 'https://env-override.example.com/v1' },
      () => {
        const daemonCfg = loadDaemonConfig({ llm: { base_url: 'https://yaml.example.com/v1' } });
        assert.equal(daemonCfg.llm.base_url, 'https://env-override.example.com/v1');
      },
    );
  });

  it('YAML base_url is used when env var is not set', async () => {
    await withEnv({ KNOWTATION_DAEMON_LLM_BASE_URL: undefined }, () => {
      const daemonCfg = loadDaemonConfig({ llm: { base_url: 'https://yaml.example.com/v1' } });
      assert.equal(daemonCfg.llm.base_url, 'https://yaml.example.com/v1');
    });
  });

  it('api_key_env from YAML is preserved at config.daemon.llm.api_key_env', () => {
    const daemonCfg = loadDaemonConfig({ llm: { api_key_env: 'OPENROUTER_API_KEY' } });
    assert.equal(daemonCfg.llm.api_key_env, 'OPENROUTER_API_KEY');
  });

  it('api_key_env defaults to null when not set in YAML', () => {
    const daemonCfg = loadDaemonConfig({});
    assert.equal(daemonCfg.llm.api_key_env, null);
  });

  it('base_url defaults to null when not set in YAML or env', async () => {
    await withEnv({ KNOWTATION_DAEMON_LLM_BASE_URL: undefined }, () => {
      const daemonCfg = loadDaemonConfig({});
      assert.equal(daemonCfg.llm.base_url, null);
    });
  });
});

// ── 6. consolidateMemory end-to-end via daemonLlm ────────────────────────────

describe('consolidateMemory end-to-end via daemonLlm', () => {
  /**
   * Seeds two events of the same topic into the memory store,
   * then runs consolidateMemory with daemonLlm as the llmFn.
   * Verifies that the fetch call goes to the configured base_url.
   */
  it('routes fetch to daemon.llm.base_url when daemonLlm is used as llmFn', async () => {
    const config = makeConfig({
      base_url: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
    });

    // Seed two events with the same topic so consolidation pass runs
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'architecture notes', results: 1, topic: 'architecture' });
    mm.store('search', { query: 'architecture diagram', results: 2, topic: 'architecture' });

    const fetchedUrls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      fetchedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '["Architecture involves layers."]' } }],
        }),
        text: async () => '{}',
      };
    };

    try {
      await withEnv({ OPENAI_API_KEY: 'sk-e2e' }, async () => {
        const result = await consolidateMemory(config, {
          llmFn: daemonLlm,
          passes: ['consolidate'],
        });
        assert.ok(result.topics.length > 0, 'Expected at least one topic to be consolidated');
        assert.ok(fetchedUrls.length > 0, 'Expected at least one fetch call');
        assert.ok(
          fetchedUrls.every((u) => u.includes('openrouter.ai')),
          `Expected all fetch calls to go to openrouter.ai, got: ${fetchedUrls.join(', ')}`,
        );
        assert.ok(
          fetchedUrls.every((u) => u.endsWith('/chat/completions')),
          `Expected fetch to /chat/completions, got: ${fetchedUrls.join(', ')}`,
        );
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('uses daemon.llm.api_key_env for the Authorization header in the LLM call', async () => {
    const config = makeConfig({
      base_url: 'http://localhost:8000/v1',
      api_key_env: 'VLLM_API_KEY',
    });

    const mm = createMemoryManager(config);
    mm.store('search', { query: 'vllm test alpha', results: 1, topic: 'vllm' });
    mm.store('search', { query: 'vllm test beta', results: 2, topic: 'vllm' });

    const authHeaders = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (init?.headers?.['Authorization']) {
        authHeaders.push(init.headers['Authorization']);
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '["vLLM is fast."]' } }],
        }),
        text: async () => '{}',
      };
    };

    try {
      await withEnv(
        { OPENAI_API_KEY: 'sk-should-not-use', VLLM_API_KEY: 'vllm-bearer-token' },
        async () => {
          await consolidateMemory(config, { llmFn: daemonLlm, passes: ['consolidate'] });
          assert.ok(authHeaders.length > 0, 'Expected Authorization header to be captured');
          assert.ok(
            authHeaders.every((h) => h === 'Bearer vllm-bearer-token'),
            `Expected Bearer vllm-bearer-token, got: ${authHeaders.join(', ')}`,
          );
        },
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns empty topics when there are no events (dry_run: false, no crash)', async () => {
    const config = makeConfig({ base_url: 'https://openrouter.ai/api/v1' });
    // No events seeded — memory manager is empty for this fresh dataDir
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchOk('[]');
    try {
      await withEnv({ OPENAI_API_KEY: 'sk' }, async () => {
        const result = await consolidateMemory(config, {
          llmFn: daemonLlm,
          passes: ['consolidate'],
        });
        assert.equal(result.topics.length, 0);
        assert.equal(result.total_events, 0);
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
