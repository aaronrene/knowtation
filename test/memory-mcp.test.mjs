/**
 * MCP memory tool and resource tests.
 * Tests the registerMemoryTools registration and metadata resource builders.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  buildMemoryResource,
  buildMemorySummaryResource,
  buildMemoryEventsResource,
  buildMemoryTypeResource,
} from '../mcp/resources/metadata.mjs';
import { createMemoryManager, storeMemory } from '../lib/memory.mjs';

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-mcp-mem-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(extra = {}) {
  const dataDir = path.join(tmpDir, 'data-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    data_dir: dataDir,
    memory: { enabled: true, provider: 'file', ...extra },
  };
}

describe('MCP memory resources (metadata builders)', () => {
  it('buildMemoryResource returns null when no events', () => {
    const config = makeConfig();
    const r = buildMemoryResource(config, 'search');
    assert.strictEqual(r.value, null);
  });

  it('buildMemoryResource returns event data after store', () => {
    const config = makeConfig();
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'test', paths: ['a.md'], count: 1 });
    const r = buildMemoryResource(config, 'search');
    assert.strictEqual(r.value.query, 'test');
    assert.strictEqual(typeof r.updated_at, 'string');
    assert.match(r.id, /^mem_/);
  });

  it('buildMemoryResource falls back to legacy when memory disabled', () => {
    const config = makeConfig();
    config.memory.enabled = false;
    const r = buildMemoryResource(config, 'search');
    assert.strictEqual(r.value, null);
  });

  it('buildMemorySummaryResource returns summary', () => {
    const config = makeConfig();
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'a' });
    mm.store('export', { format: 'md' });
    const r = buildMemorySummaryResource(config);
    assert.strictEqual(r.enabled, true);
    assert.strictEqual(r.total_events, 2);
    assert.strictEqual(r.counts_by_type.search, 1);
    assert.strictEqual(r.counts_by_type.export, 1);
  });

  it('buildMemorySummaryResource when disabled', () => {
    const config = makeConfig();
    config.memory.enabled = false;
    const r = buildMemorySummaryResource(config);
    assert.strictEqual(r.enabled, false);
  });

  it('buildMemoryEventsResource returns events', () => {
    const config = makeConfig();
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'a' });
    mm.store('search', { query: 'b' });
    const r = buildMemoryEventsResource(config);
    assert.strictEqual(r.enabled, true);
    assert.strictEqual(r.count, 2);
    assert(Array.isArray(r.events));
  });

  it('buildMemoryTypeResource returns latest + recent for type', () => {
    const config = makeConfig();
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'first' });
    mm.store('search', { query: 'second' });
    mm.store('export', { format: 'md' });
    const r = buildMemoryTypeResource(config, 'search');
    assert.strictEqual(r.enabled, true);
    assert.strictEqual(r.type, 'search');
    assert.strictEqual(r.latest.data.query, 'second');
    assert.strictEqual(r.count, 2);
  });

  it('buildMemoryTypeResource for unknown type returns null latest', () => {
    const config = makeConfig();
    const r = buildMemoryTypeResource(config, 'agent_interaction');
    assert.strictEqual(r.latest, null);
    assert.strictEqual(r.count, 0);
  });
});

describe('backward compat: buildMemoryResource with legacy storeMemory', () => {
  it('legacy storeMemory data is readable via buildMemoryResource', () => {
    const config = makeConfig();
    storeMemory(config.data_dir, 'last_search', { query: 'legacy', paths: [], count: 0 });
    const r = buildMemoryResource(config, 'search');
    assert.strictEqual(r.value.query, 'legacy');
  });
});

describe('formatMemoryEventsAsync helper', () => {
  it('returns formatted memory events', async () => {
    const { formatMemoryEventsAsync } = await import('../mcp/prompts/helpers.mjs');
    const config = makeConfig();
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'test-query' });
    mm.store('export', { format: 'md' });
    const { text, count } = await formatMemoryEventsAsync(config, { limit: 10 });
    assert.strictEqual(count, 2);
    assert.ok(text.includes('[search]'));
    assert.ok(text.includes('[export]'));
    assert.ok(text.includes('test-query'));
  });

  it('returns empty message when no events', async () => {
    const { formatMemoryEventsAsync } = await import('../mcp/prompts/helpers.mjs');
    const config = makeConfig();
    const { text, count } = await formatMemoryEventsAsync(config, {});
    assert.strictEqual(count, 0);
    assert.ok(text.includes('No memory events'));
  });

  it('filters by type', async () => {
    const { formatMemoryEventsAsync } = await import('../mcp/prompts/helpers.mjs');
    const config = makeConfig();
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'a' });
    mm.store('export', { format: 'md' });
    const { text, count } = await formatMemoryEventsAsync(config, { type: 'search' });
    assert.strictEqual(count, 1);
    assert.ok(text.includes('[search]'));
    assert.ok(!text.includes('[export]'));
  });
});
