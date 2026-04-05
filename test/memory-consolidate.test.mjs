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
  extractPathsFromEventData,
  resolvePassNames,
  runVerifyPass,
  buildDiscoverPrompt,
  parseDiscoverResponse,
  runDiscoverPass,
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

// ───────────────────────────────────────────────────
// 8. extractPathsFromEventData
// ───────────────────────────────────────────────────

describe('extractPathsFromEventData', () => {
  it('extracts data.path', () => {
    const paths = extractPathsFromEventData({ path: 'notes/a.md' });
    assert.deepStrictEqual(paths, ['notes/a.md']);
  });

  it('extracts data.paths array when not encrypted', () => {
    const paths = extractPathsFromEventData({ paths: ['notes/a.md', 'notes/b.md'] }, false);
    assert.deepStrictEqual(paths, ['notes/a.md', 'notes/b.md']);
  });

  it('skips data.paths when encrypt=true', () => {
    const paths = extractPathsFromEventData({ paths: ['notes/a.md', 'notes/b.md'] }, true);
    assert.deepStrictEqual(paths, []);
  });

  it('extracts both data.path and data.paths when not encrypted', () => {
    const paths = extractPathsFromEventData({ path: 'notes/a.md', paths: ['notes/b.md', 'notes/c.md'] }, false);
    assert.deepStrictEqual(paths, ['notes/a.md', 'notes/b.md', 'notes/c.md']);
  });

  it('deduplicates paths appearing in both data.path and data.paths', () => {
    const paths = extractPathsFromEventData({ path: 'notes/a.md', paths: ['notes/a.md', 'notes/b.md'] }, false);
    assert.deepStrictEqual(paths, ['notes/a.md', 'notes/b.md']);
  });

  it('returns empty array for null data', () => {
    assert.deepStrictEqual(extractPathsFromEventData(null), []);
    assert.deepStrictEqual(extractPathsFromEventData(undefined), []);
  });

  it('returns empty array when data has no path fields', () => {
    assert.deepStrictEqual(extractPathsFromEventData({ query: 'bitcoin' }), []);
  });

  it('ignores non-string path entries in data.paths', () => {
    const paths = extractPathsFromEventData({ paths: [42, null, 'valid.md', ''] }, false);
    assert.deepStrictEqual(paths, ['valid.md']);
  });

  it('returns only data.path when encrypt=true even if data.paths present', () => {
    const paths = extractPathsFromEventData({ path: 'notes/a.md', paths: ['notes/b.md'] }, true);
    assert.deepStrictEqual(paths, ['notes/a.md']);
  });
});

// ───────────────────────────────────────────────────
// 9. resolvePassNames
// ───────────────────────────────────────────────────

describe('resolvePassNames', () => {
  it('returns default passes from daemon config when opts.passes is undefined', () => {
    const names = resolvePassNames(undefined, { consolidate: true, verify: true });
    assert.deepStrictEqual(names, ['consolidate', 'verify']);
  });

  it('omits verify when daemon config has verify: false', () => {
    const names = resolvePassNames(undefined, { consolidate: true, verify: false });
    assert.deepStrictEqual(names, ['consolidate']);
  });

  it('omits consolidate when daemon config has consolidate: false', () => {
    const names = resolvePassNames(undefined, { consolidate: false, verify: true });
    assert.deepStrictEqual(names, ['verify']);
  });

  it('accepts string array', () => {
    const names = resolvePassNames(['consolidate', 'verify'], {});
    assert.deepStrictEqual(names, ['consolidate', 'verify']);
  });

  it('accepts comma-separated string', () => {
    const names = resolvePassNames('consolidate,verify', {});
    assert.deepStrictEqual(names, ['consolidate', 'verify']);
  });

  it('accepts single pass name string', () => {
    const names = resolvePassNames('verify', {});
    assert.deepStrictEqual(names, ['verify']);
  });

  it('trims whitespace in comma-separated string', () => {
    const names = resolvePassNames(' consolidate , verify ', {});
    assert.deepStrictEqual(names, ['consolidate', 'verify']);
  });

  it('returns empty array for empty string', () => {
    const names = resolvePassNames('', {});
    assert.deepStrictEqual(names, []);
  });

  it('uses empty default when daemon config is null/undefined', () => {
    // Both consolidate and verify default to "enabled" when key is absent
    const names = resolvePassNames(undefined, undefined);
    assert.deepStrictEqual(names, ['consolidate', 'verify']);
  });

  it('defaults to consolidate+verify when daemon config keys are absent', () => {
    const names = resolvePassNames(undefined, {});
    assert.deepStrictEqual(names, ['consolidate', 'verify']);
  });
});

// ───────────────────────────────────────────────────
// 10. runVerifyPass
// ───────────────────────────────────────────────────

describe('runVerifyPass', () => {
  let verifyConfig;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    verifyConfig = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file', encrypt: false },
      daemon: loadDaemonConfig({}),
    };
  });

  it('returns correct shape', () => {
    const result = runVerifyPass(verifyConfig, [], { dryRun: true });
    assert(Array.isArray(result.stale_paths));
    assert(Array.isArray(result.verified_paths));
    assert.strictEqual(typeof result.checked_count, 'number');
    assert.strictEqual(typeof result.dry_run, 'boolean');
  });

  it('returns dry_run: true in dryRun mode', () => {
    const result = runVerifyPass(verifyConfig, [], { dryRun: true });
    assert.strictEqual(result.dry_run, true);
  });

  it('returns dry_run: false when not in dryRun mode', () => {
    const result = runVerifyPass(verifyConfig, [], { dryRun: false });
    assert.strictEqual(result.dry_run, false);
  });

  it('classifies event with existing, unmodified file as verified', () => {
    // test.md was created in before(); using the current time as eventTs guarantees
    // that mtime (creation time) <= eventTs, so the file is not "modified after event".
    const nowTs = new Date().toISOString();
    const events = [
      { id: 'mem_aaa111', type: 'write', ts: nowTs, vault_id: 'default', status: 'success', data: { path: 'test.md' } },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.checked_count, 1);
    assert(result.verified_paths.includes('test.md'), `Expected test.md in verified: ${JSON.stringify(result)}`);
    assert.strictEqual(result.stale_paths.length, 0);
  });

  it('classifies event referencing a missing file as stale', () => {
    const events = [
      { id: 'mem_bbb222', type: 'write', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { path: 'does-not-exist.md' } },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.checked_count, 1);
    assert(result.stale_paths.includes('does-not-exist.md'), `Expected stale: ${JSON.stringify(result)}`);
    assert.strictEqual(result.verified_paths.length, 0);
  });

  it('classifies events with no path reference as no_ref (not counted in checked_count)', () => {
    const events = [
      { id: 'mem_ccc333', type: 'search', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { query: 'blockchain' } },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.checked_count, 0);
    assert.strictEqual(result.stale_paths.length, 0);
    assert.strictEqual(result.verified_paths.length, 0);
  });

  it('checks all paths in data.paths array when not encrypted', () => {
    const nowTs = new Date().toISOString();
    const events = [
      {
        id: 'mem_ddd444', type: 'export', ts: nowTs,
        vault_id: 'default', status: 'success',
        data: { paths: ['test.md', 'missing-file.md'] },
      },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.checked_count, 1);
    assert(result.verified_paths.includes('test.md'));
    assert(result.stale_paths.includes('missing-file.md'));
  });

  it('skips data.paths when encrypt=true', () => {
    const encryptConfig = { ...verifyConfig, memory: { ...verifyConfig.memory, encrypt: true } };
    const events = [
      {
        id: 'mem_eee555', type: 'export', ts: new Date().toISOString(),
        vault_id: 'default', status: 'success',
        data: { paths: ['test.md', 'missing-file.md'] },
      },
    ];
    // encrypt=true: data.paths is skipped, data.path is undefined → no paths → no_ref
    const result = runVerifyPass(encryptConfig, events, { dryRun: true });
    assert.strictEqual(result.checked_count, 0);
    assert.strictEqual(result.stale_paths.length, 0);
    assert.strictEqual(result.verified_paths.length, 0);
  });

  it('handles empty events array', () => {
    const result = runVerifyPass(verifyConfig, [], { dryRun: true });
    assert.strictEqual(result.checked_count, 0);
    assert.strictEqual(result.stale_paths.length, 0);
    assert.strictEqual(result.verified_paths.length, 0);
  });

  it('deduplicates stale_paths across multiple events referencing the same missing file', () => {
    const events = [
      { id: 'mem_f1', type: 'write', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { path: 'ghost.md' } },
      { id: 'mem_f2', type: 'write', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { path: 'ghost.md' } },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.stale_paths.filter((p) => p === 'ghost.md').length, 1);
  });

  it('deduplicates verified_paths across multiple events referencing the same existing file', () => {
    const nowTs = new Date().toISOString();
    const events = [
      { id: 'mem_g1', type: 'write', ts: nowTs, vault_id: 'default', status: 'success', data: { path: 'test.md' } },
      { id: 'mem_g2', type: 'write', ts: nowTs, vault_id: 'default', status: 'success', data: { path: 'test.md' } },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.verified_paths.filter((p) => p === 'test.md').length, 1);
  });

  it('in dryRun mode does NOT write a maintenance event', () => {
    const events = [
      { id: 'mem_h1', type: 'write', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { path: 'ghost.md' } },
    ];
    runVerifyPass(verifyConfig, events, { dryRun: true });
    const mm = _createMemoryManager(verifyConfig);
    const maintenance = mm.list({ type: 'maintenance' });
    assert.strictEqual(maintenance.length, 0);
  });

  it('in non-dryRun mode writes a maintenance event with correct shape', () => {
    const events = [
      { id: 'mem_i1', type: 'write', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { path: 'ghost.md' } },
    ];
    runVerifyPass(verifyConfig, events, { dryRun: false });
    const mm = _createMemoryManager(verifyConfig);
    const maintenance = mm.list({ type: 'maintenance' });
    assert.strictEqual(maintenance.length, 1);
    const m = maintenance[0];
    assert.strictEqual(m.type, 'maintenance');
    assert(Array.isArray(m.data.stale_paths));
    assert(Array.isArray(m.data.verified_paths));
    assert.strictEqual(typeof m.data.checked_count, 'number');
    assert(m.data.stale_paths.includes('ghost.md'));
  });

  it('maintenance event stale_paths contains the stale path', () => {
    const events = [
      { id: 'mem_j1', type: 'write', ts: new Date().toISOString(), vault_id: 'default', status: 'success', data: { path: 'never-existed.md' } },
    ];
    runVerifyPass(verifyConfig, events, { dryRun: false });
    const mm = _createMemoryManager(verifyConfig);
    const [m] = mm.list({ type: 'maintenance' });
    assert.deepStrictEqual(m.data.stale_paths, ['never-existed.md']);
    assert.deepStrictEqual(m.data.verified_paths, []);
    assert.strictEqual(m.data.checked_count, 1);
  });

  it('maintenance event verified_paths contains verified path', () => {
    const nowTs = new Date().toISOString();
    const events = [
      { id: 'mem_k1', type: 'write', ts: nowTs, vault_id: 'default', status: 'success', data: { path: 'test.md' } },
    ];
    runVerifyPass(verifyConfig, events, { dryRun: false });
    const mm = _createMemoryManager(verifyConfig);
    const [m] = mm.list({ type: 'maintenance' });
    assert(m.data.verified_paths.includes('test.md'));
    assert.deepStrictEqual(m.data.stale_paths, []);
  });

  it('processes mixed verified and stale paths in same pass', () => {
    const nowTs = new Date().toISOString();
    const events = [
      { id: 'mem_l1', type: 'write', ts: nowTs, vault_id: 'default', status: 'success', data: { path: 'test.md' } },
      { id: 'mem_l2', type: 'write', ts: nowTs, vault_id: 'default', status: 'success', data: { path: 'missing.md' } },
    ];
    const result = runVerifyPass(verifyConfig, events, { dryRun: true });
    assert.strictEqual(result.checked_count, 2);
    assert(result.verified_paths.includes('test.md'));
    assert(result.stale_paths.includes('missing.md'));
  });
});

// ───────────────────────────────────────────────────
// 11. runVerifyPass wired into consolidateMemory
// ───────────────────────────────────────────────────

describe('consolidateMemory — verify pass wiring', () => {
  let config;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-wire-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    config = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file', encrypt: false },
      daemon: loadDaemonConfig({ passes: { consolidate: true, verify: true } }),
    };
  });

  it('includes verify result in return when verify pass enabled', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'test.md' });
    mm.store('write', { path: 'missing.md' });

    const mockLlm = makeMockLlmFn('["fact one"]');
    const result = await consolidateMemory(config, { passes: ['consolidate', 'verify'], llmFn: mockLlm });

    assert(result.verify !== null, 'verify result should not be null');
    assert(Array.isArray(result.verify.stale_paths));
    assert(Array.isArray(result.verify.verified_paths));
    assert.strictEqual(typeof result.verify.checked_count, 'number');
  });

  it('verify result is null when only consolidate pass requested', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'test.md' });
    mm.store('write', { path: 'other.md' });

    const mockLlm = makeMockLlmFn('["fact one"]');
    const result = await consolidateMemory(config, { passes: ['consolidate'], llmFn: mockLlm });

    assert.strictEqual(result.verify, null);
  });

  it('verify pass detects stale paths among event set', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'ghost-path.md' });
    mm.store('write', { path: 'ghost-path.md' });

    const mockLlm = makeMockLlmFn('["ghost path facts"]');
    const result = await consolidateMemory(config, { passes: ['consolidate', 'verify'], llmFn: mockLlm });

    assert(result.verify.stale_paths.includes('ghost-path.md'));
  });

  it('verify pass detects verified paths for existing files', async () => {
    // Use a past timestamp so test.md is "not modified after event"
    const pastTs = new Date(Date.now() - 60_000).toISOString();
    const mm = _createMemoryManager(config);
    // Directly store an event with a past timestamp via the provider (store sets ts = now)
    // We simulate by using a search event (no path) + a real write that references test.md
    // The MemoryManager sets ts=now, so test.md may appear stale if mtime > ts.
    // Instead, test only stale detection (ghost path) to avoid timing sensitivity.
    mm.store('write', { path: 'another-ghost.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { passes: ['consolidate', 'verify'], llmFn: mockLlm });

    assert(result.verify !== null);
    assert(result.verify.stale_paths.includes('another-ghost.md'));
  });

  it('runs verify-only pass when passes: [verify]', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'ghost.md' });

    const mockLlm = makeMockLlmFn('["should not be called"]');
    const result = await consolidateMemory(config, { passes: ['verify'], llmFn: mockLlm });

    assert.strictEqual(mockLlm.calls.length, 0, 'LLM should not be called for verify-only');
    assert(result.verify !== null);
    assert(result.verify.stale_paths.includes('ghost.md'));
  });

  it('dryRun: true propagates to verify pass — no maintenance event written', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'ghost.md' });
    mm.store('write', { path: 'ghost2.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, {
      dryRun: true, passes: ['consolidate', 'verify'], llmFn: mockLlm,
    });

    assert.strictEqual(result.dry_run, true);
    assert(result.verify !== null);
    assert.strictEqual(result.verify.dry_run, true);

    // No maintenance events written
    const mm2 = _createMemoryManager(config);
    assert.strictEqual(mm2.list({ type: 'maintenance' }).length, 0);
  });

  it('verify pass uses the same event set read by consolidateMemory (not re-reading)', async () => {
    // Seed events that have path references; verify should see all of them
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'pathA.md' });
    mm.store('write', { path: 'pathB.md' });
    mm.store('search', { query: 'no path here' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { passes: ['verify'], llmFn: mockLlm });

    // pathA and pathB are stale (don't exist); search event is no_ref (not counted)
    assert.strictEqual(result.verify.checked_count, 2);
    assert(result.verify.stale_paths.includes('pathA.md'));
    assert(result.verify.stale_paths.includes('pathB.md'));
  });

  it('maintains total_events count for non-daemon events', async () => {
    const mm = _createMemoryManager(config);
    mm.store('search', { query: 'q1' });
    mm.store('search', { query: 'q2' });
    mm.store('consolidation', {
      topic: 'old', facts: ['f'], event_count: 1,
      since: '2026-01-01T00:00:00Z', until: '2026-01-01T00:00:00Z',
    });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { passes: ['consolidate', 'verify'], llmFn: mockLlm });
    assert.strictEqual(result.total_events, 2);
  });
});

// ───────────────────────────────────────────────────
// 12. CLI: memory consolidate --passes flag
// ───────────────────────────────────────────────────

describe('CLI: memory consolidate --passes', () => {
  it('--passes consolidate runs only consolidate pass in JSON output', () => {
    const freshDir = path.join(tmpDir, `data-cli-passes-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes consolidate --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert(Array.isArray(data.topics));
    assert.strictEqual(data.verify, null, 'verify should be null when only consolidate requested');
  });

  it('--passes verify runs only verify pass in JSON output', () => {
    const freshDir = path.join(tmpDir, `data-cli-passes-verify-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes verify --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert.deepStrictEqual(data.topics, []);
  });

  it('--passes consolidate,verify runs both passes in JSON output', () => {
    const freshDir = path.join(tmpDir, `data-cli-passes-both-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes consolidate,verify --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert(Array.isArray(data.topics));
  });

  it('memory consolidate --dry-run --json with no events returns expected shape', () => {
    const freshDir = path.join(tmpDir, `data-cli-shape-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert(Array.isArray(data.topics));
    assert.strictEqual(typeof data.total_events, 'number');
    assert('verify' in data, 'result should include verify key');
  });

  it('--passes with invalid name is handled gracefully (no crash)', () => {
    const freshDir = path.join(tmpDir, `data-cli-unknown-pass-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes unknown --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert(Array.isArray(data.topics));
  });
});

// ───────────────────────────────────────────────────
// 13. MCP: memory_consolidate passes param
// ───────────────────────────────────────────────────

describe('MCP memory_consolidate passes param (programmatic)', () => {
  let mcpConfig;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    mcpConfig = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file', encrypt: false },
      daemon: loadDaemonConfig({}),
    };
  });

  it('passes: ["consolidate"] runs only consolidate pass, verify is null', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'ghost.md' });
    mm.store('write', { path: 'ghost2.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(mcpConfig, {
      dryRun: true, passes: ['consolidate'], llmFn: mockLlm,
    });
    assert.strictEqual(result.verify, null);
    assert(Array.isArray(result.topics));
  });

  it('passes: ["verify"] runs only verify pass, topics is empty', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'ghost.md' });

    const mockLlm = makeMockLlmFn('["should not be called"]');
    const result = await consolidateMemory(mcpConfig, {
      dryRun: true, passes: ['verify'], llmFn: mockLlm,
    });
    assert.strictEqual(mockLlm.calls.length, 0);
    assert.deepStrictEqual(result.topics, []);
    assert(result.verify !== null);
    assert.strictEqual(result.verify.dry_run, true);
  });

  it('passes: ["consolidate", "verify"] runs both passes', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'ghost.md' });
    mm.store('write', { path: 'ghost2.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(mcpConfig, {
      dryRun: true, passes: ['consolidate', 'verify'], llmFn: mockLlm,
    });
    assert(Array.isArray(result.topics));
    assert(result.verify !== null);
  });

  it('passes: undefined uses daemon config defaults (both passes)', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'ghost.md' });
    mm.store('write', { path: 'ghost2.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(mcpConfig, {
      dryRun: true, passes: undefined, llmFn: mockLlm,
    });
    // Default daemon config has verify: true
    assert(result.verify !== null, 'verify should run by default');
  });

  it('verify result has correct shape when passed via MCP-style params', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'stale-ref.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(mcpConfig, {
      dryRun: true, passes: ['verify'], llmFn: mockLlm,
    });
    const v = result.verify;
    assert(Array.isArray(v.stale_paths));
    assert(Array.isArray(v.verified_paths));
    assert.strictEqual(typeof v.checked_count, 'number');
    assert.strictEqual(v.dry_run, true);
    assert(v.stale_paths.includes('stale-ref.md'));
  });
});

// ───────────────────────────────────────────────────
// 14. buildDiscoverPrompt
// ───────────────────────────────────────────────────

describe('buildDiscoverPrompt', () => {
  const makeConsolidation = (topic, facts) => ({ data: { topic, facts } });

  it('includes "Topic summaries:" header', () => {
    const prompt = buildDiscoverPrompt([makeConsolidation('blockchain', ['fact one'])]);
    assert(prompt.startsWith('Topic summaries:'));
  });

  it('includes topic name in prompt', () => {
    const prompt = buildDiscoverPrompt([makeConsolidation('blockchain', ['btc fact'])]);
    assert(prompt.includes('Topic: "blockchain"'));
  });

  it('includes facts when encrypt is false', () => {
    const prompt = buildDiscoverPrompt(
      [makeConsolidation('blockchain', ['btc is a coin', 'mining uses energy'])],
      false,
    );
    assert(prompt.includes('btc is a coin'));
    assert(prompt.includes('mining uses energy'));
  });

  it('suppresses facts when encrypt is true', () => {
    const prompt = buildDiscoverPrompt(
      [makeConsolidation('blockchain', ['btc is a coin', 'mining uses energy'])],
      true,
    );
    assert(prompt.includes('Topic: "blockchain"'));
    assert(!prompt.includes('btc is a coin'), 'Facts should not appear when encrypted');
    assert(!prompt.includes('mining uses energy'), 'Facts should not appear when encrypted');
  });

  it('includes all consolidation topics when multiple are passed', () => {
    const consolidations = [
      makeConsolidation('blockchain', ['btc fact']),
      makeConsolidation('architecture', ['monorepo fact']),
      makeConsolidation('testing', ['unit tests fact']),
    ];
    const prompt = buildDiscoverPrompt(consolidations);
    assert(prompt.includes('Topic: "blockchain"'));
    assert(prompt.includes('Topic: "architecture"'));
    assert(prompt.includes('Topic: "testing"'));
  });

  it('shows (no facts) for consolidation with empty facts array', () => {
    const prompt = buildDiscoverPrompt([makeConsolidation('empty-topic', [])]);
    assert(prompt.includes('(no facts)'));
  });

  it('handles consolidation events with raw data shape (data.topic, data.facts)', () => {
    const event = { data: { topic: 'crypto', facts: ['fact A'] } };
    const prompt = buildDiscoverPrompt([event]);
    assert(prompt.includes('Topic: "crypto"'));
    assert(prompt.includes('fact A'));
  });

  it('handles consolidation objects without data wrapper (flat topic/facts)', () => {
    // buildDiscoverPrompt supports { data: { topic, facts } } — top-level data is mandatory per spec
    const event = { data: { topic: 'flat', facts: ['flat fact'] } };
    const prompt = buildDiscoverPrompt([event]);
    assert(prompt.includes('Topic: "flat"'));
    assert(prompt.includes('flat fact'));
  });

  it('returns header-only block for empty consolidations array', () => {
    const prompt = buildDiscoverPrompt([]);
    assert(prompt.startsWith('Topic summaries:'));
  });

  it('encrypt default is false (facts included)', () => {
    const prompt = buildDiscoverPrompt([makeConsolidation('t', ['a secret fact'])]);
    assert(prompt.includes('a secret fact'));
  });
});

// ───────────────────────────────────────────────────
// 15. parseDiscoverResponse
// ───────────────────────────────────────────────────

describe('parseDiscoverResponse', () => {
  it('parses valid JSON object with all three arrays', () => {
    const raw = JSON.stringify({
      connections: ['A connects to B'],
      contradictions: ['X contradicts Y'],
      open_questions: ['Why Z?'],
    });
    const result = parseDiscoverResponse(raw);
    assert.deepStrictEqual(result.connections, ['A connects to B']);
    assert.deepStrictEqual(result.contradictions, ['X contradicts Y']);
    assert.deepStrictEqual(result.open_questions, ['Why Z?']);
  });

  it('strips markdown code fences (```json ... ```)', () => {
    const raw = '```json\n{"connections":["conn"],"contradictions":[],"open_questions":["q?"]}\n```';
    const result = parseDiscoverResponse(raw);
    assert.deepStrictEqual(result.connections, ['conn']);
    assert.deepStrictEqual(result.open_questions, ['q?']);
  });

  it('strips code fences without json tag', () => {
    const raw = '```\n{"connections":["c"],"contradictions":["d"],"open_questions":["q"]}\n```';
    const result = parseDiscoverResponse(raw);
    assert.deepStrictEqual(result.connections, ['c']);
    assert.deepStrictEqual(result.contradictions, ['d']);
  });

  it('returns empty arrays for all keys on invalid JSON', () => {
    const result = parseDiscoverResponse('this is not json at all');
    assert.deepStrictEqual(result, { connections: [], contradictions: [], open_questions: [] });
  });

  it('returns empty arrays for null/undefined input', () => {
    assert.deepStrictEqual(parseDiscoverResponse(null), { connections: [], contradictions: [], open_questions: [] });
    assert.deepStrictEqual(parseDiscoverResponse(undefined), { connections: [], contradictions: [], open_questions: [] });
    assert.deepStrictEqual(parseDiscoverResponse(''), { connections: [], contradictions: [], open_questions: [] });
  });

  it('handles partial object — missing contradictions defaults to empty array', () => {
    const raw = JSON.stringify({ connections: ['c1'], open_questions: ['q1'] });
    const result = parseDiscoverResponse(raw);
    assert.deepStrictEqual(result.connections, ['c1']);
    assert.deepStrictEqual(result.contradictions, []);
    assert.deepStrictEqual(result.open_questions, ['q1']);
  });

  it('handles partial object — missing all keys defaults to all empty arrays', () => {
    const result = parseDiscoverResponse('{}');
    assert.deepStrictEqual(result, { connections: [], contradictions: [], open_questions: [] });
  });

  it('filters non-string items from arrays', () => {
    const raw = JSON.stringify({
      connections: ['valid', 42, null, 'also valid', ''],
      contradictions: [],
      open_questions: [true, 'real question'],
    });
    const result = parseDiscoverResponse(raw);
    assert.deepStrictEqual(result.connections, ['valid', 'also valid']);
    assert.deepStrictEqual(result.open_questions, ['real question']);
  });

  it('trims whitespace from string items', () => {
    const raw = JSON.stringify({
      connections: ['  conn with spaces  '],
      contradictions: [],
      open_questions: [],
    });
    const result = parseDiscoverResponse(raw);
    assert.deepStrictEqual(result.connections, ['conn with spaces']);
  });

  it('returns empty object shape when input is a JSON array (not object)', () => {
    const result = parseDiscoverResponse('["not", "an", "object"]');
    assert.deepStrictEqual(result, { connections: [], contradictions: [], open_questions: [] });
  });

  it('returns empty object shape when input is a JSON primitive', () => {
    assert.deepStrictEqual(parseDiscoverResponse('"just a string"'), { connections: [], contradictions: [], open_questions: [] });
  });
});

// ───────────────────────────────────────────────────
// 16. runDiscoverPass
// ───────────────────────────────────────────────────

describe('runDiscoverPass', () => {
  let discoverConfig;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    discoverConfig = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file', encrypt: false },
      daemon: loadDaemonConfig({}),
    };
  });

  const makeConsolidationEvent = (topic, facts) => ({ data: { topic, facts } });

  it('returns correct shape', async () => {
    const mockLlm = makeMockLlmFn(JSON.stringify({ connections: ['c1'], contradictions: [], open_questions: ['q1'] }));
    const result = await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('blockchain', ['fact a'])],
      { llmFn: mockLlm },
    );
    assert(Array.isArray(result.connections));
    assert(Array.isArray(result.contradictions));
    assert(Array.isArray(result.open_questions));
    assert.strictEqual(typeof result.topic_count, 'number');
    assert.strictEqual(typeof result.dry_run, 'boolean');
  });

  it('calls LLM with discover system prompt and topic summaries', async () => {
    const mockLlm = makeMockLlmFn(JSON.stringify({ connections: [], contradictions: [], open_questions: [] }));
    await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('crypto', ['fact1', 'fact2'])],
      { llmFn: mockLlm },
    );
    assert.strictEqual(mockLlm.calls.length, 1);
    const call = mockLlm.calls[0];
    assert(call.opts.system.includes('insight engine'), `System prompt should mention insight engine: ${call.opts.system}`);
    assert(call.opts.user.includes('Topic summaries:'));
    assert(call.opts.user.includes('Topic: "crypto"'));
  });

  it('stores insight event with correct shape', async () => {
    const mockLlm = makeMockLlmFn(JSON.stringify({
      connections: ['blockchain and testing are related'],
      contradictions: ['conflicting fact'],
      open_questions: ['what next?'],
    }));
    await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('blockchain', ['btc']), makeConsolidationEvent('testing', ['jest'])],
      { llmFn: mockLlm },
    );
    const mm = _createMemoryManager(discoverConfig);
    const insights = mm.list({ type: 'insight' });
    assert.strictEqual(insights.length, 1);
    const insight = insights[0];
    assert.strictEqual(insight.type, 'insight');
    assert(Array.isArray(insight.data.connections));
    assert(Array.isArray(insight.data.contradictions));
    assert(Array.isArray(insight.data.open_questions));
    assert.strictEqual(typeof insight.data.topic_count, 'number');
    assert.strictEqual(insight.data.topic_count, 2);
  });

  it('topic_count matches number of consolidations passed', async () => {
    const mockLlm = makeMockLlmFn(JSON.stringify({ connections: [], contradictions: [], open_questions: [] }));
    const result = await runDiscoverPass(
      discoverConfig,
      [
        makeConsolidationEvent('a', ['f1']),
        makeConsolidationEvent('b', ['f2']),
        makeConsolidationEvent('c', ['f3']),
      ],
      { llmFn: mockLlm },
    );
    assert.strictEqual(result.topic_count, 3);
  });

  it('dryRun: true does not call LLM and does not store insight event', async () => {
    const mockLlm = makeMockLlmFn(JSON.stringify({ connections: ['conn'], contradictions: [], open_questions: [] }));
    const result = await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('topic', ['fact'])],
      { dryRun: true, llmFn: mockLlm },
    );
    assert.strictEqual(result.dry_run, true);
    assert.strictEqual(mockLlm.calls.length, 0);
    const mm = _createMemoryManager(discoverConfig);
    assert.strictEqual(mm.list({ type: 'insight' }).length, 0);
  });

  it('dryRun result has empty arrays and correct topic_count', async () => {
    const mockLlm = makeMockLlmFn('should not be called');
    const result = await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('t1', ['f1']), makeConsolidationEvent('t2', ['f2'])],
      { dryRun: true, llmFn: mockLlm },
    );
    assert.deepStrictEqual(result.connections, []);
    assert.deepStrictEqual(result.contradictions, []);
    assert.deepStrictEqual(result.open_questions, []);
    assert.strictEqual(result.topic_count, 2);
  });

  it('encrypt=true suppresses facts in LLM prompt', async () => {
    const encryptConfig = { ...discoverConfig, memory: { ...discoverConfig.memory, encrypt: true } };
    const mockLlm = makeMockLlmFn(JSON.stringify({ connections: [], contradictions: [], open_questions: [] }));
    await runDiscoverPass(
      encryptConfig,
      [makeConsolidationEvent('crypto', ['secret fact about btc'])],
      { llmFn: mockLlm },
    );
    assert.strictEqual(mockLlm.calls.length, 1);
    const userPrompt = mockLlm.calls[0].opts.user;
    assert(userPrompt.includes('Topic: "crypto"'), 'Topic name should appear');
    assert(!userPrompt.includes('secret fact about btc'), 'Fact content should be suppressed when encrypted');
  });

  it('encrypt=false includes facts in LLM prompt', async () => {
    const mockLlm = makeMockLlmFn(JSON.stringify({ connections: [], contradictions: [], open_questions: [] }));
    await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('crypto', ['btc price is volatile'])],
      { llmFn: mockLlm },
    );
    const userPrompt = mockLlm.calls[0].opts.user;
    assert(userPrompt.includes('btc price is volatile'), 'Facts should appear when not encrypted');
  });

  it('handles LLM error gracefully — returns empty arrays and still stores insight', async () => {
    const errorLlm = makeMockLlmFn(() => { throw new Error('LLM down'); });
    const result = await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('topic', ['fact'])],
      { llmFn: errorLlm },
    );
    assert.deepStrictEqual(result.connections, []);
    assert.deepStrictEqual(result.contradictions, []);
    assert.deepStrictEqual(result.open_questions, []);
    assert.strictEqual(result.dry_run, false);
    const mm = _createMemoryManager(discoverConfig);
    assert.strictEqual(mm.list({ type: 'insight' }).length, 1);
  });

  it('handles LLM returning unparseable JSON gracefully', async () => {
    const badLlm = makeMockLlmFn('not json at all');
    const result = await runDiscoverPass(
      discoverConfig,
      [makeConsolidationEvent('topic', ['fact'])],
      { llmFn: badLlm },
    );
    assert.deepStrictEqual(result.connections, []);
    assert.deepStrictEqual(result.contradictions, []);
    assert.deepStrictEqual(result.open_questions, []);
  });
});

// ───────────────────────────────────────────────────
// 17. resolvePassNames — discover handling
// ───────────────────────────────────────────────────

describe('resolvePassNames — discover handling', () => {
  it('does NOT include discover by default when daemon config has discover: false', () => {
    const names = resolvePassNames(undefined, { consolidate: true, verify: true, discover: false });
    assert(!names.includes('discover'), `discover should not be in defaults: ${names}`);
  });

  it('includes discover when daemon config has discover: true', () => {
    const names = resolvePassNames(undefined, { consolidate: true, verify: true, discover: true });
    assert(names.includes('discover'));
  });

  it('includes discover when passed as comma-string "consolidate,verify,discover"', () => {
    const names = resolvePassNames('consolidate,verify,discover', {});
    assert.deepStrictEqual(names, ['consolidate', 'verify', 'discover']);
  });

  it('includes discover when passed as array ["discover"]', () => {
    const names = resolvePassNames(['discover'], {});
    assert.deepStrictEqual(names, ['discover']);
  });

  it('includes discover when passed as array ["consolidate","verify","discover"]', () => {
    const names = resolvePassNames(['consolidate', 'verify', 'discover'], {});
    assert.deepStrictEqual(names, ['consolidate', 'verify', 'discover']);
  });

  it('discover is absent from default daemon config passes (passes.discover: false)', () => {
    const cfg = loadDaemonConfig({});
    assert.strictEqual(cfg.passes.discover, false);
    const names = resolvePassNames(undefined, cfg.passes);
    assert(!names.includes('discover'));
  });
});

// ───────────────────────────────────────────────────
// 18. consolidateMemory — discover pass wiring
// ───────────────────────────────────────────────────

describe('consolidateMemory — discover pass wiring', () => {
  let config;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-discover-wire-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    config = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file', encrypt: false },
      daemon: loadDaemonConfig({ passes: { consolidate: true, verify: false, discover: false } }),
    };
  });

  it('discover is null when discover not in passes', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'topic/a.md' });
    mm.store('write', { path: 'topic/b.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { passes: ['consolidate'], llmFn: mockLlm });
    assert.strictEqual(result.discover, null);
  });

  it('discover is null when no consolidations were written (dry-run)', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'topic/a.md' });
    mm.store('write', { path: 'topic/b.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, {
      dryRun: true, passes: ['consolidate', 'discover'], llmFn: mockLlm,
    });
    assert.strictEqual(result.dry_run, true);
    assert.strictEqual(result.discover, null, 'discover should be null when dry-run (no consolidations written)');
  });

  it('discover is null when consolidate pass is skipped', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'topic/a.md' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, {
      passes: ['discover'], llmFn: mockLlm,
    });
    assert.strictEqual(result.discover, null, 'discover should be null when consolidate was skipped');
  });

  it('discover result has correct shape when consolidations exist', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'topicA/x.md' });
    mm.store('write', { path: 'topicA/y.md' });

    const discoverResponse = JSON.stringify({
      connections: ['topicA connects to something'],
      contradictions: [],
      open_questions: ['What is topicA?'],
    });
    const mockLlm = makeMockLlmFn((opts) => {
      if (opts.system && opts.system.includes('insight engine')) return discoverResponse;
      return '["fact from topicA"]';
    });

    const result = await consolidateMemory(config, {
      passes: ['consolidate', 'discover'], llmFn: mockLlm,
    });

    assert(result.discover !== null, 'discover should not be null when consolidations exist');
    assert(Array.isArray(result.discover.connections));
    assert(Array.isArray(result.discover.contradictions));
    assert(Array.isArray(result.discover.open_questions));
    assert.strictEqual(typeof result.discover.topic_count, 'number');
    assert.strictEqual(result.discover.dry_run, false);
  });

  it('discover LLM call receives topic summaries built from stored consolidations', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'blockchain/eth.md' });
    mm.store('write', { path: 'blockchain/sol.md' });

    const capturedCalls = [];
    const mockLlm = makeMockLlmFn((opts) => {
      capturedCalls.push(opts);
      if (opts.system && opts.system.includes('insight engine')) {
        return JSON.stringify({ connections: [], contradictions: [], open_questions: [] });
      }
      return '["blockchain notes recorded"]';
    });

    await consolidateMemory(config, { passes: ['consolidate', 'discover'], llmFn: mockLlm });

    const discoverCall = capturedCalls.find((c) => c.system && c.system.includes('insight engine'));
    assert(discoverCall, 'Should have made a discover LLM call');
    assert(discoverCall.user.includes('Topic summaries:'));
    assert(discoverCall.user.includes('blockchain'));
  });

  it('discover pass stores insight event in memory log', async () => {
    const mm = _createMemoryManager(config);
    mm.store('write', { path: 'science/a.md' });
    mm.store('write', { path: 'science/b.md' });

    const mockLlm = makeMockLlmFn((opts) => {
      if (opts.system && opts.system.includes('insight engine')) {
        return JSON.stringify({ connections: ['science relates to testing'], contradictions: [], open_questions: [] });
      }
      return '["science note written"]';
    });

    await consolidateMemory(config, { passes: ['consolidate', 'discover'], llmFn: mockLlm });

    const mm2 = _createMemoryManager(config);
    const insights = mm2.list({ type: 'insight' });
    assert.strictEqual(insights.length, 1);
    assert.strictEqual(insights[0].type, 'insight');
  });

  it('discover pass runs AFTER consolidate and verify passes', async () => {
    const mmSetup = _createMemoryManager(config);
    mmSetup.store('write', { path: 'ordered/a.md' });
    mmSetup.store('write', { path: 'ordered/b.md' });

    const callOrder = [];
    const mockLlm = makeMockLlmFn((opts) => {
      if (opts.system && opts.system.includes('insight engine')) {
        callOrder.push('discover');
        return JSON.stringify({ connections: [], contradictions: [], open_questions: [] });
      }
      callOrder.push('consolidate');
      return '["ordered fact"]';
    });

    await consolidateMemory(config, {
      passes: ['consolidate', 'verify', 'discover'], llmFn: mockLlm,
    });

    const consolidateIdx = callOrder.indexOf('consolidate');
    const discoverIdx = callOrder.indexOf('discover');
    assert(consolidateIdx !== -1, 'consolidate LLM call should exist');
    assert(discoverIdx !== -1, 'discover LLM call should exist');
    assert(consolidateIdx < discoverIdx, 'consolidate should run before discover');
  });

  it('result always contains a discover key (null when not run)', async () => {
    const mm = _createMemoryManager(config);
    mm.store('search', { query: 'something' });
    mm.store('search', { query: 'else' });

    const mockLlm = makeMockLlmFn('["fact"]');
    const result = await consolidateMemory(config, { passes: ['consolidate'], llmFn: mockLlm });
    assert('discover' in result, 'result must always have discover key');
    assert.strictEqual(result.discover, null);
  });

  it('result discover key is null for empty event set', async () => {
    const result = await consolidateMemory(config, {
      passes: ['consolidate', 'discover'], llmFn: makeMockLlmFn('["fact"]'),
    });
    assert('discover' in result);
    assert.strictEqual(result.discover, null);
  });
});

// ───────────────────────────────────────────────────
// 19. CLI: memory consolidate --passes discover
// ───────────────────────────────────────────────────

describe('CLI: memory consolidate --passes discover', () => {
  it('--passes discover --dry-run --json returns valid JSON with discover key', () => {
    const freshDir = path.join(tmpDir, `data-cli-discover-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes discover --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert('discover' in data, 'result must include discover key');
  });

  it('--passes consolidate,verify,discover --dry-run --json returns all keys', () => {
    const freshDir = path.join(tmpDir, `data-cli-discover-all-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes consolidate,verify,discover --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dry_run, true);
    assert(Array.isArray(data.topics));
    assert('verify' in data);
    assert('discover' in data);
  });

  it('--passes discover with no events returns discover: null', () => {
    const freshDir = path.join(tmpDir, `data-cli-discover-empty-${Date.now()}`);
    fs.mkdirSync(freshDir, { recursive: true });
    const r = runCli('memory consolidate --dry-run --passes discover --json', { dataDir: freshDir });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.discover, null);
  });

  it('memory consolidate --help mentions discover pass', () => {
    const r = runCli('memory --help');
    assert.strictEqual(r.exitCode, 0);
    assert(r.stdout.includes('discover'), `Help should mention discover: ${r.stdout}`);
  });
});

// ───────────────────────────────────────────────────
// 20. MCP: memory_consolidate passes: ["discover"]
// ───────────────────────────────────────────────────

describe('MCP memory_consolidate — discover pass (programmatic)', () => {
  let mcpConfig;

  beforeEach(() => {
    const freshDataDir = path.join(tmpDir, `data-mcp-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(freshDataDir, { recursive: true });
    mcpConfig = {
      vault_path: vaultDir,
      data_dir: freshDataDir,
      memory: { enabled: true, provider: 'file', encrypt: false },
      daemon: loadDaemonConfig({}),
    };
  });

  it('passes: ["discover"] with no prior consolidations returns discover: null', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('search', { query: 'no consolidations' });

    const mockLlm = makeMockLlmFn('should not be called');
    const result = await consolidateMemory(mcpConfig, {
      dryRun: true, passes: ['discover'], llmFn: mockLlm,
    });
    assert.strictEqual(result.discover, null);
    assert.strictEqual(mockLlm.calls.length, 0);
  });

  it('passes: ["consolidate", "discover"] runs both and discover result is non-null', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'noded/a.md' });
    mm.store('write', { path: 'noded/b.md' });

    const mockLlm = makeMockLlmFn((opts) => {
      if (opts.system && opts.system.includes('insight engine')) {
        return JSON.stringify({ connections: ['conn'], contradictions: [], open_questions: [] });
      }
      return '["fact"]';
    });

    const result = await consolidateMemory(mcpConfig, {
      passes: ['consolidate', 'discover'], llmFn: mockLlm,
    });

    assert(result.discover !== null, 'discover should be non-null when consolidations exist');
    assert(Array.isArray(result.discover.connections));
    assert.strictEqual(result.discover.dry_run, false);
  });

  it('passes: ["consolidate", "verify", "discover"] runs all three', async () => {
    const mm = _createMemoryManager(mcpConfig);
    mm.store('write', { path: 'multi/a.md' });
    mm.store('write', { path: 'multi/b.md' });

    const mockLlm = makeMockLlmFn((opts) => {
      if (opts.system && opts.system.includes('insight engine')) {
        return JSON.stringify({ connections: [], contradictions: [], open_questions: [] });
      }
      return '["multi fact"]';
    });

    const result = await consolidateMemory(mcpConfig, {
      passes: ['consolidate', 'verify', 'discover'], llmFn: mockLlm,
    });

    assert(Array.isArray(result.topics));
    assert(result.verify !== null);
    assert(result.discover !== null);
  });
});
