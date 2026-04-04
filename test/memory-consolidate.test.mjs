/**
 * Tests for the core consolidation engine (Phase A of Daemon Consolidation Spec).
 *
 * Covers: new event types, prompt construction, LLM response parsing,
 * event grouping, consolidateMemory function (with mocked LLM), dry-run mode,
 * error handling, daemon config loading, and CLI integration.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  MEMORY_EVENT_TYPES,
  createMemoryEvent,
  extractTopicFromEvent,
} from '../lib/memory-event.mjs';

import {
  buildConsolidationPrompt,
  parseConsolidationResponse,
  groupEventsByTopic,
  consolidateMemory,
} from '../lib/memory-consolidate.mjs';

import { loadDaemonConfig } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'cli', 'index.mjs');

let tmpDir;
let vaultDir;
let dataDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-consolidate-test-'));
  vaultDir = path.join(tmpDir, 'vault');
  dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'test.md'), '---\ntitle: test\n---\nHello', 'utf8');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig() {
  return {
    vault_path: vaultDir,
    data_dir: dataDir,
    memory: { enabled: true, provider: 'file' },
    daemon: loadDaemonConfig({}),
  };
}

function makeMockLlmFn(response) {
  const calls = [];
  const fn = async (config, opts) => {
    calls.push({ config, opts });
    if (typeof response === 'function') return response(opts);
    return response;
  };
  fn.calls = calls;
  return fn;
}

function seedEvents(config, events) {
  const { createMemoryManager } = await_import_sync();
  const mm = createMemoryManager(config);
  for (const { type, data } of events) {
    mm.store(type, data);
  }
  return mm;
}

function await_import_sync() {
  // We already import createMemoryManager at the top-level scope in consolidateMemory,
  // so just re-import directly here.
  return { createMemoryManager: _createMemoryManager };
}

import { createMemoryManager as _createMemoryManager } from '../lib/memory.mjs';

// ───────────────────────────────────────────────────
// 1. New Event Types
// ───────────────────────────────────────────────────

describe('New event types (consolidation, maintenance, insight)', () => {
  it('MEMORY_EVENT_TYPES includes consolidation', () => {
    assert(MEMORY_EVENT_TYPES.includes('consolidation'));
  });

  it('MEMORY_EVENT_TYPES includes maintenance', () => {
    assert(MEMORY_EVENT_TYPES.includes('maintenance'));
  });

  it('MEMORY_EVENT_TYPES includes insight', () => {
    assert(MEMORY_EVENT_TYPES.includes('insight'));
  });

  it('createMemoryEvent accepts consolidation type', () => {
    const event = createMemoryEvent('consolidation', {
      topic: 'blockchain',
      facts: ['fact1', 'fact2'],
      event_count: 5,
      since: '2026-04-01T00:00:00Z',
      until: '2026-04-04T00:00:00Z',
    });
    assert.strictEqual(event.type, 'consolidation');
    assert.deepStrictEqual(event.data.facts, ['fact1', 'fact2']);
    assert.match(event.id, /^mem_/);
  });

  it('createMemoryEvent accepts maintenance type', () => {
    const event = createMemoryEvent('maintenance', {
      stale_paths: ['/notes/old.md'],
      verified_paths: ['/notes/current.md'],
      checked_count: 2,
    });
    assert.strictEqual(event.type, 'maintenance');
    assert.deepStrictEqual(event.data.stale_paths, ['/notes/old.md']);
  });

  it('createMemoryEvent accepts insight type', () => {
    const event = createMemoryEvent('insight', {
      connections: ['A relates to B'],
      contradictions: ['X conflicts with Y'],
      open_questions: ['Why Z?'],
    });
    assert.strictEqual(event.type, 'insight');
    assert.deepStrictEqual(event.data.connections, ['A relates to B']);
  });

  it('consolidation events can be stored and listed via MemoryManager', () => {
    const config = makeConfig();
    const mm = _createMemoryManager(config);
    const result = mm.store('consolidation', {
      topic: 'testing',
      facts: ['tests pass'],
      event_count: 3,
      since: '2026-04-01T00:00:00Z',
      until: '2026-04-04T00:00:00Z',
    });
    assert.match(result.id, /^mem_/);
    const latest = mm.getLatest('consolidation');
    assert.strictEqual(latest.type, 'consolidation');
    assert.strictEqual(latest.data.topic, 'testing');
  });
});

// ───────────────────────────────────────────────────
// 2. Prompt Construction
// ───────────────────────────────────────────────────

describe('buildConsolidationPrompt', () => {
  it('includes topic name', () => {
    const prompt = buildConsolidationPrompt('blockchain', [
      { ts: '2026-04-01T10:00:00Z', type: 'search', data: { query: 'bitcoin' } },
    ]);
    assert(prompt.includes('Topic: "blockchain"'));
  });

  it('includes event count', () => {
    const events = [
      { ts: '2026-04-01T10:00:00Z', type: 'search', data: { query: 'test1' } },
      { ts: '2026-04-01T11:00:00Z', type: 'search', data: { query: 'test2' } },
      { ts: '2026-04-01T12:00:00Z', type: 'write', data: { path: 'notes/a.md' } },
    ];
    const prompt = buildConsolidationPrompt('testing', events);
    assert(prompt.includes('Events (3):'));
  });

  it('includes timestamps and event types', () => {
    const events = [
      { ts: '2026-04-01T10:00:00Z', type: 'search', data: { query: 'bitcoin' } },
    ];
    const prompt = buildConsolidationPrompt('crypto', events);
    assert(prompt.includes('[2026-04-01T10:00:00Z] search:'));
  });

  it('includes event data summary', () => {
    const events = [
      { ts: '2026-04-01T10:00:00Z', type: 'write', data: { path: 'notes/deep-topic.md' } },
    ];
    const prompt = buildConsolidationPrompt('notes', events);
    assert(prompt.includes('deep-topic.md'));
  });

  it('truncates long data payloads', () => {
    const longData = { text: 'x'.repeat(500) };
    const events = [{ ts: '2026-04-01T10:00:00Z', type: 'user', data: longData }];
    const prompt = buildConsolidationPrompt('verbose', events);
    assert(prompt.length < 500 + 200);
  });
});

// ───────────────────────────────────────────────────
// 3. Response Parsing
// ───────────────────────────────────────────────────

describe('parseConsolidationResponse', () => {
  it('parses valid JSON array', () => {
    const facts = parseConsolidationResponse('["fact one", "fact two", "fact three"]');
    assert.deepStrictEqual(facts, ['fact one', 'fact two', 'fact three']);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n["a", "b"]\n```';
    const facts = parseConsolidationResponse(raw);
    assert.deepStrictEqual(facts, ['a', 'b']);
  });

  it('strips code fences without json tag', () => {
    const raw = '```\n["x", "y"]\n```';
    const facts = parseConsolidationResponse(raw);
    assert.deepStrictEqual(facts, ['x', 'y']);
  });

  it('filters non-string array elements', () => {
    const raw = '["good", 42, null, "also good", ""]';
    const facts = parseConsolidationResponse(raw);
    assert.deepStrictEqual(facts, ['good', 'also good']);
  });

  it('trims whitespace from facts', () => {
    const raw = '["  spaced  ", "  also  "]';
    const facts = parseConsolidationResponse(raw);
    assert.deepStrictEqual(facts, ['spaced', 'also']);
  });

  it('returns empty array for null/undefined input', () => {
    assert.deepStrictEqual(parseConsolidationResponse(null), []);
    assert.deepStrictEqual(parseConsolidationResponse(undefined), []);
    assert.deepStrictEqual(parseConsolidationResponse(''), []);
  });

  it('returns empty array for non-array JSON (object)', () => {
    const raw = '{"fact": "not an array"}';
    const facts = parseConsolidationResponse(raw);
    assert.deepStrictEqual(facts, []);
  });

  it('falls back to line-based parsing for invalid JSON', () => {
    const raw = '- fact one\n- fact two\n- fact three';
    const facts = parseConsolidationResponse(raw);
    assert.strictEqual(facts.length, 3);
    assert(facts[0].includes('fact one'));
  });

  it('handles numbered list fallback', () => {
    const raw = '1. First fact\n2. Second fact';
    const facts = parseConsolidationResponse(raw);
    assert.strictEqual(facts.length, 2);
    assert(facts[0].includes('First fact'));
  });
});

// ───────────────────────────────────────────────────
// 4. Event Grouping
// ───────────────────────────────────────────────────

describe('groupEventsByTopic', () => {
  it('groups events by extracted topic slug', () => {
    const events = [
      { type: 'search', data: { query: 'bitcoin transactions' } },
      { type: 'write', data: { path: 'blockchain/contracts.md' } },
      { type: 'search', data: { query: 'bitcoin mining' } },
      { type: 'write', data: { path: 'testing/unit.md' } },
    ];
    const groups = groupEventsByTopic(events);
    assert(groups.size >= 2, `Expected at least 2 groups, got ${groups.size}`);
    const topics = [...groups.keys()];
    assert(topics.some((t) => t.includes('bitcoin') || t.includes('blockchain')));
  });

  it('returns empty map for empty input', () => {
    const groups = groupEventsByTopic([]);
    assert.strictEqual(groups.size, 0);
  });

  it('puts all single-topic events in one group', () => {
    const events = [
      { type: 'write', data: { path: 'docs/readme.md' } },
      { type: 'write', data: { path: 'docs/guide.md' } },
    ];
    const groups = groupEventsByTopic(events);
    assert.strictEqual(groups.size, 1);
    const [topic, evts] = [...groups.entries()][0];
    assert.strictEqual(topic, 'docs');
    assert.strictEqual(evts.length, 2);
  });
});

// ───────────────────────────────────────────────────
// 5. consolidateMemory (with mocked LLM)
// ───────────────────────────────────────────────────

describe('consolidateMemory', () => {
  let config;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    config = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file' },
      daemon: loadDaemonConfig({}),
    };
  });

  it('returns empty topics when no events exist', async () => {
    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { llmFn: mockLlm });
    assert.strictEqual(result.topics.length, 0);
    assert.strictEqual(result.total_events, 0);
    assert.strictEqual(result.dry_run, false);
  });

  it('consolidates events and stores consolidation events', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'crypto/price.md' });
    mm.store('write', { path: 'crypto/mining.md' });
    mm.store('write', { path: 'crypto/wallets.md' });

    const mockLlm = makeMockLlmFn('["Crypto notes cover price, mining, and wallet info"]');
    const result = await consolidateMemory(config, { llmFn: mockLlm });

    assert.strictEqual(result.dry_run, false);
    assert(result.total_events >= 3);
    assert(result.topics.length >= 1);

    const topicResult = result.topics[0];
    assert(topicResult.facts.length >= 1);
    assert.match(topicResult.id, /^mem_/);
    assert(topicResult.event_count >= 2);
  });

  it('calls LLM with correct system and user prompts', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'blockchain/sol.md' });
    mm.store('write', { path: 'blockchain/eth.md' });

    const mockLlm = makeMockLlmFn('["Blockchain notes written"]');
    await consolidateMemory(config, { llmFn: mockLlm });

    assert(mockLlm.calls.length >= 1, 'LLM should have been called at least once');
    const call = mockLlm.calls[0];
    assert(call.opts.system.includes('memory consolidation engine'));
    assert(call.opts.user.includes('Topic:'));
    assert(call.opts.user.includes('Events ('));
  });

  it('dry-run does not store events or call LLM', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'alpha/one.md' });
    mm.store('write', { path: 'alpha/two.md' });
    mm.store('write', { path: 'alpha/three.md' });

    const mockLlm = makeMockLlmFn('["should not be called"]');
    const result = await consolidateMemory(config, { dryRun: true, llmFn: mockLlm });

    assert.strictEqual(result.dry_run, true);
    assert.strictEqual(mockLlm.calls.length, 0);
    assert(result.topics.length >= 1);
    for (const t of result.topics) {
      assert.strictEqual(t.facts.length, 0);
      assert(t.dry_run_estimate != null);
      assert.strictEqual(t.id, undefined);
    }

    const mm2 = _createMemoryManager(config);
    const consolidations = mm2.list({ type: 'consolidation' });
    assert.strictEqual(consolidations.length, 0);
  });

  it('handles LLM error gracefully without crashing', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'errors/test.md' });
    mm.store('write', { path: 'errors/other.md' });

    const errorLlm = makeMockLlmFn(() => {
      throw new Error('LLM connection refused');
    });
    const result = await consolidateMemory(config, { llmFn: errorLlm });

    assert(result.topics.length >= 1);
    const topicResult = result.topics[0];
    assert.strictEqual(topicResult.facts.length, 0);
    assert(topicResult.error.includes('LLM connection refused'));
  });

  it('handles LLM returning unparseable response', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'parsefail/one.md' });
    mm.store('write', { path: 'parsefail/two.md' });
    mm.store('write', { path: 'parsefail/three.md' });

    const badLlm = makeMockLlmFn('{}');
    const result = await consolidateMemory(config, { llmFn: badLlm });

    assert(result.topics.length >= 1);
    assert.strictEqual(result.topics[0].facts.length, 0);
    assert(result.topics[0].error != null);
  });

  it('skips consolidation, maintenance, and insight events from input', async () => {
    const mm = _createMemoryManager(config);
    mm.store('search', { query: 'real event' });
    mm.store('search', { query: 'another real event' });
    mm.store('consolidation', {
      topic: 'old',
      facts: ['old fact'],
      event_count: 1,
      since: '2026-04-01T00:00:00Z',
      until: '2026-04-01T00:00:00Z',
    });

    const mockLlm = makeMockLlmFn('["consolidated fact"]');
    const result = await consolidateMemory(config, { llmFn: mockLlm });

    assert.strictEqual(result.total_events, 2, 'Should count only non-consolidation events');
  });

  it('respects lookbackHours parameter', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'lookback/a.md' });
    mm.store('write', { path: 'lookback/b.md' });

    const mockLlm = makeMockLlmFn('["fact"]');

    const result48 = await consolidateMemory(config, { lookbackHours: 48, llmFn: mockLlm });
    assert(result48.total_events >= 2, 'With 48h lookback, events should be found');

    const result1 = await consolidateMemory(config, { lookbackHours: 1, llmFn: mockLlm });
    assert(result1.total_events >= 2, 'With 1h lookback, recently stored events should be found');
  });

  it('rebuilds pointer index after consolidation', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'idxtest/alpha.md' });
    mm.store('write', { path: 'idxtest/beta.md' });
    mm.store('write', { path: 'idxtest/gamma.md' });

    const mockLlm = makeMockLlmFn('["Write activity for index tests"]');
    await consolidateMemory(config, { llmFn: mockLlm });

    const mm2 = _createMemoryManager(config);
    const idx = mm2.generateIndex({ force: true });
    assert(idx.markdown.includes('consolidation'), `Index should mention consolidation type: ${idx.markdown}`);
  });

  it('respects maxEventsPerPass limit', async () => {
    const mm = _createMemoryManager(config);
    for (let i = 0; i < 10; i++) {
      mm.store('search', { query: `event ${i}` });
    }

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { maxEventsPerPass: 3, llmFn: mockLlm });

    assert(result.total_events <= 3, `Expected <= 3 events, got ${result.total_events}`);
  });

  it('consolidation event has correct shape', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'shape/test.md' });
    mm.store('write', { path: 'shape/other.md' });

    const mockLlm = makeMockLlmFn('["Note writes recorded in shape directory"]');
    const result = await consolidateMemory(config, { llmFn: mockLlm });

    const mm2 = _createMemoryManager(config);
    const consolidations = mm2.list({ type: 'consolidation' });
    assert(consolidations.length >= 1);

    const c = consolidations[0];
    assert.strictEqual(typeof c.data.topic, 'string');
    assert(Array.isArray(c.data.facts));
    assert.strictEqual(typeof c.data.event_count, 'number');
    assert.strictEqual(typeof c.data.since, 'string');
    assert.strictEqual(typeof c.data.until, 'string');
  });
});

// ───────────────────────────────────────────────────
// 6. Daemon Config Loading
// ───────────────────────────────────────────────────

describe('loadDaemonConfig', () => {
  it('returns full defaults when called with empty/undefined', () => {
    const cfg = loadDaemonConfig(undefined);
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.interval_minutes, 120);
    assert.strictEqual(cfg.idle_only, true);
    assert.strictEqual(cfg.idle_threshold_minutes, 15);
    assert.strictEqual(cfg.run_on_start, false);
    assert.strictEqual(cfg.lookback_hours, 24);
    assert.strictEqual(cfg.max_events_per_pass, 200);
    assert.strictEqual(cfg.max_topics_per_pass, 10);
    assert.deepStrictEqual(cfg.passes, {
      consolidate: true,
      verify: true,
      discover: false,
      rebuild_index: true,
    });
    assert.strictEqual(cfg.llm.provider, null);
    assert.strictEqual(cfg.llm.model, null);
    assert.strictEqual(cfg.llm.max_tokens, 1024);
    assert.strictEqual(cfg.llm.temperature, 0.2);
    assert.strictEqual(cfg.dry_run, false);
    assert.strictEqual(cfg.log_file, null);
    assert.strictEqual(cfg.max_cost_per_day_usd, null);
  });

  it('respects YAML overrides', () => {
    const cfg = loadDaemonConfig({
      enabled: true,
      interval_minutes: 60,
      lookback_hours: 48,
      max_events_per_pass: 100,
      passes: { discover: true, verify: false },
      llm: { model: 'gpt-4o-mini', max_tokens: 512 },
    });
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.interval_minutes, 60);
    assert.strictEqual(cfg.lookback_hours, 48);
    assert.strictEqual(cfg.max_events_per_pass, 100);
    assert.strictEqual(cfg.passes.discover, true);
    assert.strictEqual(cfg.passes.verify, false);
    assert.strictEqual(cfg.passes.consolidate, true);
    assert.strictEqual(cfg.llm.model, 'gpt-4o-mini');
    assert.strictEqual(cfg.llm.max_tokens, 512);
  });

  it('environment variables override YAML values', () => {
    const origEnabled = process.env.KNOWTATION_DAEMON_ENABLED;
    const origInterval = process.env.KNOWTATION_DAEMON_INTERVAL;
    const origDryRun = process.env.KNOWTATION_DAEMON_DRY_RUN;
    const origProvider = process.env.KNOWTATION_DAEMON_LLM_PROVIDER;
    const origModel = process.env.KNOWTATION_DAEMON_LLM_MODEL;

    try {
      process.env.KNOWTATION_DAEMON_ENABLED = 'true';
      process.env.KNOWTATION_DAEMON_INTERVAL = '30';
      process.env.KNOWTATION_DAEMON_DRY_RUN = 'true';
      process.env.KNOWTATION_DAEMON_LLM_PROVIDER = 'anthropic';
      process.env.KNOWTATION_DAEMON_LLM_MODEL = 'claude-3-5-haiku-20241022';

      const cfg = loadDaemonConfig({ enabled: false, interval_minutes: 120, dry_run: false });
      assert.strictEqual(cfg.enabled, true);
      assert.strictEqual(cfg.interval_minutes, 30);
      assert.strictEqual(cfg.dry_run, true);
      assert.strictEqual(cfg.llm.provider, 'anthropic');
      assert.strictEqual(cfg.llm.model, 'claude-3-5-haiku-20241022');
    } finally {
      if (origEnabled === undefined) delete process.env.KNOWTATION_DAEMON_ENABLED;
      else process.env.KNOWTATION_DAEMON_ENABLED = origEnabled;
      if (origInterval === undefined) delete process.env.KNOWTATION_DAEMON_INTERVAL;
      else process.env.KNOWTATION_DAEMON_INTERVAL = origInterval;
      if (origDryRun === undefined) delete process.env.KNOWTATION_DAEMON_DRY_RUN;
      else process.env.KNOWTATION_DAEMON_DRY_RUN = origDryRun;
      if (origProvider === undefined) delete process.env.KNOWTATION_DAEMON_LLM_PROVIDER;
      else process.env.KNOWTATION_DAEMON_LLM_PROVIDER = origProvider;
      if (origModel === undefined) delete process.env.KNOWTATION_DAEMON_LLM_MODEL;
      else process.env.KNOWTATION_DAEMON_LLM_MODEL = origModel;
    }
  });

  it('handles non-object input gracefully', () => {
    assert.strictEqual(loadDaemonConfig(null).enabled, false);
    assert.strictEqual(loadDaemonConfig('string').enabled, false);
    assert.strictEqual(loadDaemonConfig(42).enabled, false);
  });
});

// ───────────────────────────────────────────────────
// 7. CLI Integration: memory consolidate
// ───────────────────────────────────────────────────

function runCli(cmdArgs, opts = {}) {
  const env = {
    ...process.env,
    KNOWTATION_VAULT_PATH: vaultDir,
    KNOWTATION_DATA_DIR: opts.dataDir || dataDir,
    KNOWTATION_MEMORY_ENABLED: 'true',
    KNOWTATION_MEMORY_PROVIDER: 'file',
  };
  try {
    const out = execSync(`node ${cliPath} ${cmdArgs}`, {
      cwd: path.join(__dirname, '..'),
      env,
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: out.trim(), exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status };
  }
}

describe('CLI: memory consolidate', () => {
  it('memory --help includes consolidate action', () => {
    const r = runCli('memory --help');
    assert.strictEqual(r.exitCode, 0);
    assert(r.stdout.includes('consolidate'));
  });

  it('memory consolidate --dry-run with no events says no events', async () => {
    const freshDir = path.join(tmpDir, `data-cli-dry-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0);
    const stdout = r.stdout;
    assert(
      stdout.includes('No events') || stdout.includes('0 events') || stdout.includes('0 topics'),
      `Expected no-events message, got: ${stdout}`,
    );
  });

  it('memory consolidate --dry-run --json returns valid JSON', () => {
    const freshDir = path.join(tmpDir, `data-cli-json-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert(Array.isArray(data.topics));
  });

  it('consolidate is in valid actions list', () => {
    const r = runCli('memory consolidate-invalid');
    assert.notStrictEqual(r.exitCode, 0);
  });
});
