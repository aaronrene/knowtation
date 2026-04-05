/**
 * Tests for mcp/tools/memory.mjs — Stream 3 (Session 10).
 *
 * Covers:
 *   consolidation_history:
 *     - Returns empty array when no consolidation events exist
 *     - Returns at most `limit` records (default 20)
 *     - Records contain expected fields (type, ts, data)
 *
 *   consolidation_settings (read):
 *     - Returns current daemon config fields
 *     - Returns empty object when daemon section is absent
 *
 *   consolidation_settings (write):
 *     - Updates a single field and persists to yaml
 *     - Rejects interval_minutes < 1
 *     - Rejects interval_minutes > 43200
 *     - Rejects llm_model containing path separators ('/')
 *     - Does not create unexpected keys in the yaml
 *
 *   memory_consolidate hosted routing:
 *     - When KNOWTATION_HUB_URL is set, calls the gateway URL (not local)
 *     - Passes dry_run / passes / lookback_hours through to the gateway
 *     - Returns gateway response shape on success
 *     - Returns HUB_TOKEN_REQUIRED error when token env var is missing
 *     - Falls back to local consolidateMemory when hub URL is absent
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { registerMemoryTools } from '../mcp/tools/memory.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockServer() {
  const tools = {};
  return {
    registerTool(name, _schema, handler) {
      tools[name] = handler;
    },
    tools,
  };
}

function parseResult(result) {
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

function makeMockMM(events = []) {
  return {
    list(opts) {
      let filtered = [...events];
      if (opts.type) filtered = filtered.filter((e) => e.type === opts.type);
      const limit = opts.limit ?? filtered.length;
      return filtered.slice(0, limit);
    },
  };
}

function makeConsolidationEvent(overrides = {}) {
  return {
    id: 'mem_' + Math.random().toString(36).slice(2, 8),
    type: 'consolidation',
    ts: new Date().toISOString(),
    vault_id: 'default',
    data: { topics: 2, merged: 4, cost_usd: 0.003 },
    status: 'success',
    ...overrides,
  };
}

const ALLOWED_DAEMON_KEYS = new Set([
  'enabled', 'interval_minutes', 'idle_only', 'idle_threshold_minutes',
  'run_on_start', 'max_cost_per_day_usd', 'llm',
]);

/**
 * Save and restore env vars around an async callback.
 */
async function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, val] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (val == null) delete process.env[key];
    else process.env[key] = val;
  }
  try {
    return await fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}

function mockFs(yamlContent = '') {
  let written = null;
  return {
    fs: {
      existsSync: () => yamlContent !== null,
      readFileSync: () => yamlContent ?? '',
      writeFileSync: (_p, data) => { written = data; },
      mkdirSync: () => {},
    },
    getWritten: () => written,
  };
}

// ── consolidation_history ─────────────────────────────────────────────────────

describe('consolidation_history', () => {
  it('returns empty array when no consolidation events exist', async () => {
    const server = createMockServer();
    registerMemoryTools(server, {
      loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
      createMemoryManager: () => makeMockMM([]),
    });

    const result = await server.tools.consolidation_history({});
    const data = parseResult(result);

    assert.deepEqual(data.history, []);
    assert.equal(data.count, 0);
  });

  it('returns at most `limit` records (default 20)', async () => {
    const events = Array.from({ length: 30 }, () => makeConsolidationEvent());
    const server = createMockServer();
    registerMemoryTools(server, {
      loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
      createMemoryManager: () => makeMockMM(events),
    });

    const result = await server.tools.consolidation_history({});
    const data = parseResult(result);

    assert.equal(data.count, 20);
    assert.equal(data.history.length, 20);
  });

  it('respects explicit limit', async () => {
    const events = Array.from({ length: 10 }, () => makeConsolidationEvent());
    const server = createMockServer();
    registerMemoryTools(server, {
      loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
      createMemoryManager: () => makeMockMM(events),
    });

    const result = await server.tools.consolidation_history({ limit: 3 });
    const data = parseResult(result);

    assert.equal(data.count, 3);
    assert.equal(data.history.length, 3);
  });

  it('records contain expected fields (type, ts, data)', async () => {
    const events = [
      makeConsolidationEvent({
        ts: '2026-04-05T00:00:00.000Z',
        data: { topics: 3, merged: 5, cost_usd: 0.004 },
      }),
    ];
    const server = createMockServer();
    registerMemoryTools(server, {
      loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
      createMemoryManager: () => makeMockMM(events),
    });

    const result = await server.tools.consolidation_history({ limit: 10 });
    const data = parseResult(result);

    assert.equal(data.count, 1);
    const record = data.history[0];
    assert.equal(record.type, 'consolidation');
    assert.equal(record.ts, '2026-04-05T00:00:00.000Z');
    assert.ok(record.data);
    assert.equal(record.data.topics, 3);
    assert.equal(record.data.merged, 5);
  });
});

// ── consolidation_settings (read) ─────────────────────────────────────────────

describe('consolidation_settings (read)', () => {
  it('returns current daemon config fields', async () => {
    const server = createMockServer();
    registerMemoryTools(server, {
      loadConfig: () => ({
        memory: { enabled: true },
        daemon: { enabled: true, interval_minutes: 120, idle_only: true, max_cost_per_day_usd: 0.50 },
      }),
    });

    const result = await server.tools.consolidation_settings({});
    const data = parseResult(result);

    assert.equal(data.daemon.enabled, true);
    assert.equal(data.daemon.interval_minutes, 120);
    assert.equal(data.daemon.idle_only, true);
    assert.equal(data.daemon.max_cost_per_day_usd, 0.50);
  });

  it('returns empty object when daemon section is absent', async () => {
    const server = createMockServer();
    registerMemoryTools(server, {
      loadConfig: () => ({ memory: { enabled: true } }),
    });

    const result = await server.tools.consolidation_settings({});
    const data = parseResult(result);

    assert.deepEqual(data.daemon, {});
  });
});

// ── consolidation_settings (write) ────────────────────────────────────────────

describe('consolidation_settings (write)', () => {
  it('updates a single field and persists to yaml', async () => {
    const existingYaml = yaml.dump({ daemon: { enabled: false, interval_minutes: 60 } });
    const { fs: mockFsObj, getWritten } = mockFs(existingYaml);

    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/test-config.yaml',
      fs: mockFsObj,
    });

    const result = await server.tools.consolidation_settings({ enabled: true });
    const data = parseResult(result);

    assert.equal(data.ok, true);
    assert.equal(data.daemon.enabled, true);
    assert.equal(data.daemon.interval_minutes, 60);

    const parsed = yaml.load(getWritten());
    assert.equal(parsed.daemon.enabled, true);
    assert.equal(parsed.daemon.interval_minutes, 60);
  });

  it('creates config file when it does not exist', async () => {
    let dirCreated = false;
    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/nonexistent/local.yaml',
      fs: {
        existsSync: () => false,
        readFileSync: () => '',
        writeFileSync: () => {},
        mkdirSync: () => { dirCreated = true; },
      },
    });

    const result = await server.tools.consolidation_settings({ enabled: true });
    const data = parseResult(result);

    assert.equal(data.ok, true);
    assert.equal(data.daemon.enabled, true);
    assert.equal(dirCreated, true);
  });

  it('rejects interval_minutes < 1', async () => {
    const { fs: mockFsObj } = mockFs(yaml.dump({}));
    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/test.yaml',
      fs: mockFsObj,
    });

    const result = await server.tools.consolidation_settings({ interval_minutes: 0 });
    const data = parseResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.ok(data.error.includes('interval_minutes'));
  });

  it('rejects interval_minutes > 43200', async () => {
    const { fs: mockFsObj } = mockFs(yaml.dump({}));
    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/test.yaml',
      fs: mockFsObj,
    });

    const result = await server.tools.consolidation_settings({ interval_minutes: 50000 });
    const data = parseResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.ok(data.error.includes('interval_minutes'));
  });

  it('rejects llm_model containing path separators ("/")', async () => {
    const { fs: mockFsObj } = mockFs(yaml.dump({}));
    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/test.yaml',
      fs: mockFsObj,
    });

    const result = await server.tools.consolidation_settings({ llm_model: '../etc/passwd' });
    const data = parseResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.ok(data.error.includes('llm_model'));
  });

  it('rejects llm_model containing shell metacharacters', async () => {
    const { fs: mockFsObj } = mockFs(yaml.dump({}));
    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/test.yaml',
      fs: mockFsObj,
    });

    const result = await server.tools.consolidation_settings({ llm_model: 'model; rm -rf /' });
    const data = parseResult(result);

    assert.equal(result.isError, true);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  it('does not create unexpected keys in the yaml', async () => {
    const existingYaml = yaml.dump({
      vault_path: './vault',
      daemon: { enabled: false },
    });
    const { fs: mockFsObj, getWritten } = mockFs(existingYaml);

    const server = createMockServer();
    registerMemoryTools(server, {
      resolveConfigPath: () => '/tmp/test.yaml',
      fs: mockFsObj,
    });

    await server.tools.consolidation_settings({ enabled: true });

    const parsed = yaml.load(getWritten());
    assert.equal(parsed.vault_path, './vault', 'non-daemon keys must be preserved');
    for (const key of Object.keys(parsed.daemon)) {
      assert.ok(ALLOWED_DAEMON_KEYS.has(key), `unexpected daemon key: ${key}`);
    }
  });
});

// ── memory_consolidate hosted routing ─────────────────────────────────────────

describe('memory_consolidate hosted routing', () => {
  it('calls the gateway URL when KNOWTATION_HUB_URL is set (not local)', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: 'https://hub.example.com', KNOWTATION_HUB_TOKEN: 'test-token' },
      async () => {
        let capturedUrl = null;
        let localCalled = false;

        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
          consolidateMemory: async () => { localCalled = true; return {}; },
          fetchFn: async (url) => {
            capturedUrl = url;
            return {
              ok: true,
              text: async () => JSON.stringify({
                topics: 2, total_events: 10, cost_usd: 0.003,
                pass_id: 'cpass_1', dry_run: false, verify: true, discover: false,
              }),
            };
          },
        });

        const result = await server.tools.memory_consolidate({});
        const data = parseResult(result);

        assert.equal(capturedUrl, 'https://hub.example.com/api/v1/memory/consolidate');
        assert.equal(localCalled, false, 'local consolidateMemory must not be called in hosted mode');
        assert.equal(data.topics, 2);
      },
    );
  });

  it('passes dry_run / passes / lookback_hours through to the gateway', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: 'https://hub.example.com', KNOWTATION_HUB_TOKEN: 'tok' },
      async () => {
        let capturedBody = null;

        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
          fetchFn: async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return {
              ok: true,
              text: async () => JSON.stringify({ topics: 1, total_events: 5 }),
            };
          },
        });

        await server.tools.memory_consolidate({
          dry_run: true,
          passes: ['consolidate', 'verify'],
          lookback_hours: 48,
        });

        assert.equal(capturedBody.dry_run, true);
        assert.deepEqual(capturedBody.passes, ['consolidate', 'verify']);
        assert.equal(capturedBody.lookback_hours, 48);
      },
    );
  });

  it('returns gateway response shape on success', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: 'https://hub.example.com', KNOWTATION_HUB_TOKEN: 'tok' },
      async () => {
        const gatewayResponse = {
          topics: 3, total_events: 20, verify: true, discover: false,
          cost_usd: 0.007, pass_id: 'cpass_abc', dry_run: false,
        };

        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
          fetchFn: async () => ({
            ok: true,
            text: async () => JSON.stringify(gatewayResponse),
          }),
        });

        const result = await server.tools.memory_consolidate({});
        const data = parseResult(result);

        assert.equal(data.topics, 3);
        assert.equal(data.total_events, 20);
        assert.equal(data.verify, true);
        assert.equal(data.discover, false);
        assert.equal(data.cost_usd, 0.007);
        assert.equal(data.pass_id, 'cpass_abc');
        assert.equal(data.dry_run, false);
        assert.equal(result.isError, undefined);
      },
    );
  });

  it('returns HUB_TOKEN_REQUIRED error when token env var is missing', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: 'https://hub.example.com', KNOWTATION_HUB_TOKEN: undefined },
      async () => {
        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
          fetchFn: async () => { throw new Error('fetch must not be called'); },
        });

        const result = await server.tools.memory_consolidate({});
        const data = parseResult(result);

        assert.equal(result.isError, true);
        assert.equal(data.code, 'HUB_TOKEN_REQUIRED');
        assert.ok(data.error.includes('KNOWTATION_HUB_TOKEN'));
      },
    );
  });

  it('surfaces bridge error on non-2xx response', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: 'https://hub.example.com', KNOWTATION_HUB_TOKEN: 'tok' },
      async () => {
        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
          fetchFn: async () => ({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            text: async () => JSON.stringify({ error: 'consolidation queue full', code: 'QUEUE_FULL' }),
          }),
        });

        const result = await server.tools.memory_consolidate({});
        const data = parseResult(result);

        assert.equal(result.isError, true);
        assert.ok(data.error.includes('consolidation queue full'));
      },
    );
  });

  it('falls back to local consolidateMemory when hub URL is absent', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: undefined, KNOWTATION_HUB_TOKEN: undefined },
      async () => {
        let localCalled = false;
        let localArgs = null;

        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({ memory: { enabled: true }, daemon: {} }),
          consolidateMemory: async (_config, args) => {
            localCalled = true;
            localArgs = args;
            return { topics: 1, total_events: 5, cost_usd: 0.001, pass_id: 'cpass_local' };
          },
          fetchFn: async () => { throw new Error('fetch must not be called in local mode'); },
        });

        const result = await server.tools.memory_consolidate({ dry_run: true, lookback_hours: 12 });
        const data = parseResult(result);

        assert.equal(localCalled, true, 'local consolidateMemory must be called when hub URL is absent');
        assert.equal(localArgs.dryRun, true);
        assert.equal(localArgs.lookbackHours, 12);
        assert.equal(data.topics, 1);
        assert.equal(data.pass_id, 'cpass_local');
      },
    );
  });

  it('detects hub URL from config.hub_url when env var is unset', async () => {
    await withEnv(
      { KNOWTATION_HUB_URL: undefined, KNOWTATION_HUB_TOKEN: 'tok' },
      async () => {
        let capturedUrl = null;

        const server = createMockServer();
        registerMemoryTools(server, {
          loadConfig: () => ({
            memory: { enabled: true },
            daemon: {},
            hub_url: 'https://config-hub.example.com/',
          }),
          fetchFn: async (url) => {
            capturedUrl = url;
            return { ok: true, text: async () => JSON.stringify({ topics: 1 }) };
          },
        });

        await server.tools.memory_consolidate({});
        assert.equal(capturedUrl, 'https://config-hub.example.com/api/v1/memory/consolidate');
      },
    );
  });
});
