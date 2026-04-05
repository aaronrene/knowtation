/**
 * Memory layer tests: event model, file provider, MemoryManager, backward compatibility.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  generateMemoryId,
  createMemoryEvent,
  isValidMemoryEvent,
  hasSensitiveKeys,
  MEMORY_EVENT_TYPES,
  MEMORY_EVENT_STATUSES,
  DEFAULT_CAPTURE_TYPES,
} from '../lib/memory-event.mjs';
import { FileMemoryProvider } from '../lib/memory-provider-file.mjs';
import { MemoryManager, createMemoryManager, generateMemoryIndex, storeMemory, getMemory, resolveMemoryDir } from '../lib/memory.mjs';

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-memory-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('memory-event', () => {
  it('generateMemoryId produces mem_ prefix + 12 hex chars', () => {
    const id = generateMemoryId();
    assert.match(id, /^mem_[0-9a-f]{12}$/);
    const id2 = generateMemoryId();
    assert.notStrictEqual(id, id2);
  });

  it('createMemoryEvent produces valid event', () => {
    const event = createMemoryEvent('search', { query: 'test', count: 1 });
    assert.match(event.id, /^mem_/);
    assert.strictEqual(event.type, 'search');
    assert.strictEqual(event.vault_id, 'default');
    assert.strictEqual(event.data.query, 'test');
    assert.strictEqual(typeof event.ts, 'string');
    assert.strictEqual(event.ttl, null);
    assert(isValidMemoryEvent(event));
  });

  it('createMemoryEvent accepts vaultId and airId opts', () => {
    const event = createMemoryEvent('write', { path: 'a.md' }, { vaultId: 'v1', airId: 'air_123' });
    assert.strictEqual(event.vault_id, 'v1');
    assert.strictEqual(event.air_id, 'air_123');
  });

  it('createMemoryEvent rejects invalid type', () => {
    assert.throws(() => createMemoryEvent('bogus_type', {}), /Invalid memory event type/);
  });

  it('createMemoryEvent rejects null data', () => {
    assert.throws(() => createMemoryEvent('search', null), /non-null object/);
  });

  it('createMemoryEvent rejects data with secret keys', () => {
    assert.throws(
      () => createMemoryEvent('search', { api_key: 'sk-abc', query: 'test' }),
      /sensitive key patterns/
    );
  });

  it('hasSensitiveKeys detects nested secrets', () => {
    assert.strictEqual(hasSensitiveKeys({ ok: 1 }), false);
    assert.strictEqual(hasSensitiveKeys({ password: 'x' }), true);
    assert.strictEqual(hasSensitiveKeys({ nested: { secret_token: 'y' } }), true);
    assert.strictEqual(hasSensitiveKeys([{ authorization: 'z' }]), true);
  });

  it('isValidMemoryEvent rejects malformed events', () => {
    assert.strictEqual(isValidMemoryEvent(null), false);
    assert.strictEqual(isValidMemoryEvent({}), false);
    assert.strictEqual(isValidMemoryEvent({ id: 'bad', type: 'search', ts: '2026', vault_id: 'd', data: {} }), false);
  });

  it('MEMORY_EVENT_TYPES and DEFAULT_CAPTURE_TYPES are frozen arrays', () => {
    assert(Array.isArray(MEMORY_EVENT_TYPES));
    assert(Object.isFrozen(MEMORY_EVENT_TYPES));
    assert(MEMORY_EVENT_TYPES.includes('search'));
    assert(MEMORY_EVENT_TYPES.includes('user'));
    assert(Array.isArray(DEFAULT_CAPTURE_TYPES));
    assert(DEFAULT_CAPTURE_TYPES.includes('search'));
    assert(!DEFAULT_CAPTURE_TYPES.includes('agent_interaction'));
  });
});

describe('FileMemoryProvider', () => {
  let providerDir;
  let provider;

  beforeEach(() => {
    providerDir = path.join(tmpDir, 'fmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    provider = new FileMemoryProvider(providerDir);
  });

  it('storeEvent creates files and returns id+ts', () => {
    const event = createMemoryEvent('search', { query: 'test' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.id, event.id);
    assert.strictEqual(result.ts, event.ts);
    assert(fs.existsSync(path.join(providerDir, 'events.jsonl')));
    assert(fs.existsSync(path.join(providerDir, 'state.json')));
  });

  it('getLatest returns null for empty store', () => {
    assert.strictEqual(provider.getLatest('search'), null);
  });

  it('getLatest returns the most recent event of that type', () => {
    const e1 = createMemoryEvent('search', { query: 'first' });
    const e2 = createMemoryEvent('search', { query: 'second' });
    provider.storeEvent(e1);
    provider.storeEvent(e2);
    const latest = provider.getLatest('search');
    assert.strictEqual(latest.data.query, 'second');
  });

  it('getLatest isolates by type', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'q' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const s = provider.getLatest('search');
    assert.strictEqual(s.data.query, 'q');
    const e = provider.getLatest('export');
    assert.strictEqual(e.data.format, 'md');
    assert.strictEqual(provider.getLatest('write'), null);
  });

  it('listEvents returns all events sorted newest-first', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'a' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'b' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const all = provider.listEvents();
    assert.strictEqual(all.length, 3);
    assert(all[0].ts >= all[1].ts);
  });

  it('listEvents filters by type', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'a' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const list = provider.listEvents({ type: 'search' });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].type, 'search');
  });

  it('listEvents filters by since/until', () => {
    const e1 = createMemoryEvent('search', { query: 'old' });
    e1.ts = '2025-01-01T00:00:00.000Z';
    const e2 = createMemoryEvent('search', { query: 'new' });
    e2.ts = '2026-06-01T00:00:00.000Z';
    provider.storeEvent(e1);
    provider.storeEvent(e2);
    const after = provider.listEvents({ since: '2026-01-01' });
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].data.query, 'new');
  });

  it('listEvents respects limit', () => {
    for (let i = 0; i < 5; i++) {
      provider.storeEvent(createMemoryEvent('search', { query: `q${i}` }));
    }
    const list = provider.listEvents({ limit: 2 });
    assert.strictEqual(list.length, 2);
  });

  it('supportsSearch returns false', () => {
    assert.strictEqual(provider.supportsSearch(), false);
  });

  it('searchEvents returns empty array', () => {
    const result = provider.searchEvents('anything');
    assert.deepStrictEqual(result, []);
  });

  it('clearEvents clears all events', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'a' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const result = provider.clearEvents();
    assert.strictEqual(result.cleared, 2);
    assert.deepStrictEqual(provider.listEvents(), []);
    assert.strictEqual(provider.getLatest('search'), null);
  });

  it('clearEvents by type only removes that type', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'a' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const result = provider.clearEvents({ type: 'search' });
    assert.strictEqual(result.cleared, 1);
    assert.strictEqual(provider.getLatest('search'), null);
    assert.notStrictEqual(provider.getLatest('export'), null);
  });

  it('clearEvents by before date', () => {
    const e1 = createMemoryEvent('search', { query: 'old' });
    e1.ts = '2025-01-01T00:00:00.000Z';
    const e2 = createMemoryEvent('search', { query: 'new' });
    e2.ts = '2026-06-01T00:00:00.000Z';
    provider.storeEvent(e1);
    provider.storeEvent(e2);
    const result = provider.clearEvents({ before: '2026-01-01' });
    assert.strictEqual(result.cleared, 1);
    const remaining = provider.listEvents();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].data.query, 'new');
  });

  it('getStats returns correct counts', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'a' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'b' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const stats = provider.getStats();
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.counts_by_type.search, 2);
    assert.strictEqual(stats.counts_by_type.export, 1);
    assert(stats.size_bytes > 0);
    assert.strictEqual(typeof stats.oldest, 'string');
    assert.strictEqual(typeof stats.newest, 'string');
  });

  it('getStats returns empty for no events', () => {
    const stats = provider.getStats();
    assert.strictEqual(stats.total, 0);
    assert.strictEqual(stats.oldest, null);
  });

  it('pruneExpired removes events older than retentionDays', () => {
    const old = createMemoryEvent('search', { query: 'old' });
    old.ts = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const recent = createMemoryEvent('search', { query: 'recent' });
    provider.storeEvent(old);
    provider.storeEvent(recent);
    const result = provider.pruneExpired(30);
    assert.strictEqual(result.pruned, 1);
    const remaining = provider.listEvents();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].data.query, 'recent');
  });

  it('pruneExpired returns 0 when nothing to prune', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'fresh' }));
    const result = provider.pruneExpired(365);
    assert.strictEqual(result.pruned, 0);
  });

  it('pruneExpired updates state.json when latest was pruned', () => {
    const old = createMemoryEvent('export', { format: 'md' });
    old.ts = new Date(Date.now() - 200 * 86_400_000).toISOString();
    provider.storeEvent(old);
    assert.notStrictEqual(provider.getLatest('export'), null);
    provider.pruneExpired(30);
    assert.strictEqual(provider.getLatest('export'), null);
  });

  it('pruneExpired with 0 or null retentionDays is no-op', () => {
    provider.storeEvent(createMemoryEvent('search', { query: 'x' }));
    assert.deepStrictEqual(provider.pruneExpired(0), { pruned: 0 });
    assert.deepStrictEqual(provider.pruneExpired(null), { pruned: 0 });
    assert.strictEqual(provider.listEvents().length, 1);
  });
});

describe('MemoryManager', () => {
  let memDir;
  let manager;

  beforeEach(() => {
    memDir = path.join(tmpDir, 'mm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    const provider = new FileMemoryProvider(memDir);
    manager = new MemoryManager(provider);
  });

  it('store and getLatest round-trip', () => {
    const result = manager.store('search', { query: 'test', count: 5 });
    assert.match(result.id, /^mem_/);
    const latest = manager.getLatest('search');
    assert.strictEqual(latest.data.query, 'test');
  });

  it('shouldCapture respects default capture types', () => {
    assert.strictEqual(manager.shouldCapture('search'), true);
    assert.strictEqual(manager.shouldCapture('export'), true);
    assert.strictEqual(manager.shouldCapture('write'), true);
    assert.strictEqual(manager.shouldCapture('agent_interaction'), false);
  });

  it('custom capture types', () => {
    const p = new FileMemoryProvider(path.join(tmpDir, 'mm-custom-' + Date.now()));
    const m = new MemoryManager(p, { capture: ['search', 'error'] });
    assert.strictEqual(m.shouldCapture('search'), true);
    assert.strictEqual(m.shouldCapture('error'), true);
    assert.strictEqual(m.shouldCapture('export'), false);
  });

  it('list returns events', () => {
    manager.store('search', { query: 'a' });
    manager.store('export', { format: 'md' });
    const list = manager.list();
    assert.strictEqual(list.length, 2);
  });

  it('clear removes events', () => {
    manager.store('search', { query: 'a' });
    const result = manager.clear();
    assert.strictEqual(result.cleared, 1);
    assert.strictEqual(manager.getLatest('search'), null);
  });

  it('stats returns summary', () => {
    manager.store('search', { query: 'a' });
    manager.store('search', { query: 'b' });
    const s = manager.stats();
    assert.strictEqual(s.total, 2);
    assert.strictEqual(s.counts_by_type.search, 2);
  });

  it('supportsSearch returns false for file provider', () => {
    assert.strictEqual(manager.supportsSearch(), false);
  });

  it('prune() is no-op when retentionDays is null', () => {
    manager.store('search', { query: 'x' });
    const result = manager.prune();
    assert.strictEqual(result, null);
    assert.strictEqual(manager.list().length, 1);
  });

  it('store() triggers retention pruning when retentionDays is set', () => {
    const dir = path.join(tmpDir, 'mm-ret-' + Date.now());
    const p = new FileMemoryProvider(dir);
    const m = new MemoryManager(p, { retentionDays: 10 });

    const old = createMemoryEvent('search', { query: 'old' });
    old.ts = new Date(Date.now() - 30 * 86_400_000).toISOString();
    p.storeEvent(old);

    m.store('search', { query: 'new' });
    const events = m.list();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data.query, 'new');
  });

  it('prune() throttles execution (second call within window is no-op)', () => {
    const dir = path.join(tmpDir, 'mm-thr-' + Date.now());
    const p = new FileMemoryProvider(dir);
    const m = new MemoryManager(p, { retentionDays: 10 });
    const first = m.prune();
    assert.notStrictEqual(first, null);
    assert.strictEqual(first.pruned, 0);
    const second = m.prune();
    assert.strictEqual(second, null);
  });
});

describe('createMemoryManager', () => {
  it('creates a MemoryManager with file provider from config', () => {
    const dataDir = path.join(tmpDir, 'cmm-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = {
      data_dir: dataDir,
      memory: { enabled: true, provider: 'file' },
    };
    const mm = createMemoryManager(config);
    assert(mm instanceof MemoryManager);
    const result = mm.store('search', { query: 'hello' });
    assert.match(result.id, /^mem_/);
    const latest = mm.getLatest('search');
    assert.strictEqual(latest.data.query, 'hello');
  });

  it('respects custom capture list from config', () => {
    const dataDir = path.join(tmpDir, 'cmm-cap-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = {
      data_dir: dataDir,
      memory: { enabled: true, provider: 'file', capture: ['search', 'error'] },
    };
    const mm = createMemoryManager(config);
    assert.strictEqual(mm.shouldCapture('search'), true);
    assert.strictEqual(mm.shouldCapture('error'), true);
    assert.strictEqual(mm.shouldCapture('write'), false);
  });

  it('uses default vault_id when not specified', () => {
    const dataDir = path.join(tmpDir, 'cmm-vid-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file' } };
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'x' });
    const expectedDir = path.join(dataDir, 'memory', 'default');
    assert(fs.existsSync(expectedDir));
  });

  it('creates per-vault memory directory', () => {
    const dataDir = path.join(tmpDir, 'cmm-mv-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file' } };
    const mm = createMemoryManager(config, 'vault-alpha');
    mm.store('search', { query: 'x' });
    const expectedDir = path.join(dataDir, 'memory', 'vault-alpha');
    assert(fs.existsSync(expectedDir));
  });
});

describe('backward compatibility (storeMemory / getMemory)', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = path.join(tmpDir, 'compat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(dataDir, { recursive: true });
  });

  it('storeMemory + getMemory round-trip for last_search', () => {
    storeMemory(dataDir, 'last_search', { query: 'test', paths: ['a.md'], count: 1 });
    const val = getMemory(dataDir, 'last_search');
    assert.notStrictEqual(val, null);
    assert.strictEqual(val.query, 'test');
    assert.strictEqual(typeof val._at, 'string');
  });

  it('storeMemory + getMemory round-trip for last_export', () => {
    storeMemory(dataDir, 'last_export', { provenance: 'p', exported: [{ path: 'a.md' }] });
    const val = getMemory(dataDir, 'last_export');
    assert.notStrictEqual(val, null);
    assert.strictEqual(val.provenance, 'p');
  });

  it('storeMemory also writes to new event log', () => {
    storeMemory(dataDir, 'last_search', { query: 'q' });
    const eventsFile = path.join(dataDir, 'memory', 'default', 'events.jsonl');
    assert(fs.existsSync(eventsFile));
    const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, 'search');
    assert.strictEqual(event.data.query, 'q');
  });

  it('storeMemory also writes to legacy memory.json', () => {
    storeMemory(dataDir, 'last_search', { query: 'legacy' });
    const legacyFile = path.join(dataDir, 'memory.json');
    assert(fs.existsSync(legacyFile));
    const data = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    assert.strictEqual(data.last_search.query, 'legacy');
  });

  it('getMemory falls back to legacy memory.json when no event log', () => {
    const legacyFile = path.join(dataDir, 'memory.json');
    fs.writeFileSync(legacyFile, JSON.stringify({ last_search: { query: 'old', _at: '2025-01-01T00:00:00Z' } }), 'utf8');
    const val = getMemory(dataDir, 'last_search');
    assert.strictEqual(val.query, 'old');
  });

  it('getMemory returns null for missing key', () => {
    const val = getMemory(dataDir, 'last_search');
    assert.strictEqual(val, null);
  });
});

describe('Mem0MemoryProvider (file fallback)', () => {
  it('stores and retrieves via file layer when no URL', async () => {
    const { Mem0MemoryProvider } = await import('../lib/memory-provider-mem0.mjs');
    const provDir = path.join(tmpDir, 'mem0-' + Date.now());
    const m0p = new Mem0MemoryProvider(provDir, { url: '' });
    assert.strictEqual(m0p.supportsSearch(), false);

    const event = (await import('../lib/memory-event.mjs')).createMemoryEvent('search', { query: 'test' });
    const result = m0p.storeEvent(event);
    assert.strictEqual(result.id, event.id);

    const latest = m0p.getLatest('search');
    assert.strictEqual(latest.data.query, 'test');

    const list = m0p.listEvents();
    assert.strictEqual(list.length, 1);
  });

  it('supportsSearch returns true when URL is set', async () => {
    const { Mem0MemoryProvider } = await import('../lib/memory-provider-mem0.mjs');
    const provDir = path.join(tmpDir, 'mem0url-' + Date.now());
    const m0p = new Mem0MemoryProvider(provDir, { url: 'http://localhost:9999' });
    assert.strictEqual(m0p.supportsSearch(), true);
  });
});

describe('VectorMemoryProvider (file fallback)', () => {
  it('VectorMemoryProvider stores and retrieves via file layer', async () => {
    const { VectorMemoryProvider } = await import('../lib/memory-provider-vector.mjs');
    const provDir = path.join(tmpDir, 'vmp-' + Date.now());
    const config = {
      data_dir: provDir,
      embedding: { provider: 'ollama', model: 'nomic-embed-text' },
      vector_store: 'sqlite-vec',
    };
    const vmp = new VectorMemoryProvider(provDir, config);
    assert.strictEqual(vmp.supportsSearch(), true);

    const event = (await import('../lib/memory-event.mjs')).createMemoryEvent('search', { query: 'hello world' });
    const result = vmp.storeEvent(event);
    assert.strictEqual(result.id, event.id);

    const latest = vmp.getLatest('search');
    assert.strictEqual(latest.data.query, 'hello world');

    const list = vmp.listEvents();
    assert.strictEqual(list.length, 1);

    const stats = vmp.getStats();
    assert.strictEqual(stats.total, 1);
  });
});

describe('resolveMemoryDir', () => {
  it('builds correct path for default vault', () => {
    const dir = resolveMemoryDir('/data');
    assert.strictEqual(dir, path.join('/data', 'memory', 'default'));
  });

  it('builds correct path for named vault', () => {
    const dir = resolveMemoryDir('/data', 'my-vault');
    assert.strictEqual(dir, path.join('/data', 'memory', 'my-vault'));
  });

  it('builds _global path when scope is global', () => {
    const dir = resolveMemoryDir('/data', 'my-vault', { scope: 'global' });
    assert.strictEqual(dir, path.join('/data', 'memory', '_global'));
  });

  it('uses vault scope by default', () => {
    const dir = resolveMemoryDir('/data', 'v1', {});
    assert.strictEqual(dir, path.join('/data', 'memory', 'v1'));
  });
});

describe('mem0 import enrichment', () => {
  it('onMemoryEvent callback is called for each imported memory', async () => {
    const { importMem0 } = await import('../lib/importers/mem0.mjs');
    const vaultDir = path.join(tmpDir, 'mem0-enrich-' + Date.now());
    fs.mkdirSync(vaultDir, { recursive: true });

    const mem0Data = [
      { id: 'm1', memory: 'First memory text', created_at: '2026-01-15' },
      { id: 'm2', memory: 'Second memory text', created_at: '2026-02-20' },
    ];
    const exportFile = path.join(tmpDir, 'mem0-enrich-export.json');
    fs.writeFileSync(exportFile, JSON.stringify(mem0Data), 'utf8');

    const captured = [];
    const result = await importMem0(exportFile, {
      vaultPath: vaultDir,
      outputBase: 'inbox',
      tags: [],
      dryRun: false,
      onMemoryEvent: (data) => captured.push(data),
    });

    assert.strictEqual(result.count, 2);
    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[0].source, 'mem0');
    assert.strictEqual(captured[0].source_id, 'm1');
    assert.ok(captured[0].text.includes('First memory'));
    assert.strictEqual(captured[1].source_id, 'm2');
  });

  it('onMemoryEvent is not called during dry run', async () => {
    const { importMem0 } = await import('../lib/importers/mem0.mjs');
    const exportFile = path.join(tmpDir, 'mem0-dry.json');
    fs.writeFileSync(exportFile, JSON.stringify([{ id: 'd1', memory: 'dry test' }]), 'utf8');

    const captured = [];
    const result = await importMem0(exportFile, {
      vaultPath: path.join(tmpDir, 'dry-vault'),
      outputBase: 'inbox',
      tags: [],
      dryRun: true,
      onMemoryEvent: (data) => captured.push(data),
    });

    assert.strictEqual(result.count, 1);
    assert.strictEqual(captured.length, 0);
  });

  it('onMemoryEvent errors do not break import', async () => {
    const { importMem0 } = await import('../lib/importers/mem0.mjs');
    const vaultDir = path.join(tmpDir, 'mem0-err-' + Date.now());
    fs.mkdirSync(vaultDir, { recursive: true });

    const exportFile = path.join(tmpDir, 'mem0-err.json');
    fs.writeFileSync(exportFile, JSON.stringify([{ id: 'e1', memory: 'test' }]), 'utf8');

    const result = await importMem0(exportFile, {
      vaultPath: vaultDir,
      outputBase: 'inbox',
      tags: [],
      dryRun: false,
      onMemoryEvent: () => { throw new Error('callback failure'); },
    });

    assert.strictEqual(result.count, 1);
  });
});

describe('EncryptedFileMemoryProvider', () => {
  it('stores and retrieves events with encryption', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-' + Date.now());
    const provider = new EncryptedFileMemoryProvider(dir, 'test-secret-key-12345');

    const event = createMemoryEvent('search', { query: 'encrypted test' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.id, event.id);

    const latest = provider.getLatest('search');
    assert.strictEqual(latest.data.query, 'encrypted test');

    const list = provider.listEvents();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].data.query, 'encrypted test');
  });

  it('encrypted files are not readable as plaintext', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-plain-' + Date.now());
    const provider = new EncryptedFileMemoryProvider(dir, 'test-secret-key-12345');

    provider.storeEvent(createMemoryEvent('search', { query: 'secret data' }));

    const raw = fs.readFileSync(path.join(dir, 'events.jsonl.enc'), 'utf8');
    assert.ok(!raw.includes('secret data'));
    assert.ok(!raw.includes('"query"'));
  });

  it('wrong key cannot decrypt', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-wrongkey-' + Date.now());
    const p1 = new EncryptedFileMemoryProvider(dir, 'correct-key-12345');
    p1.storeEvent(createMemoryEvent('search', { query: 'private' }));

    const p2 = new EncryptedFileMemoryProvider(dir, 'wrong-key-67890');
    const list = p2.listEvents();
    assert.strictEqual(list.length, 0);
    assert.strictEqual(p2.getLatest('search'), null);
  });

  it('per-vault salt is created and reused', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-salt-' + Date.now());
    new EncryptedFileMemoryProvider(dir, 'my-secret-12345');
    const saltPath = path.join(dir, '.salt');
    assert.ok(fs.existsSync(saltPath));
    const salt1 = fs.readFileSync(saltPath);

    new EncryptedFileMemoryProvider(dir, 'my-secret-12345');
    const salt2 = fs.readFileSync(saltPath);
    assert.deepStrictEqual(salt1, salt2);
  });

  it('clearEvents works on encrypted data', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-clear-' + Date.now());
    const p = new EncryptedFileMemoryProvider(dir, 'clear-secret-12345');
    p.storeEvent(createMemoryEvent('search', { query: 'a' }));
    p.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const result = p.clearEvents({ type: 'search' });
    assert.strictEqual(result.cleared, 1);
    assert.strictEqual(p.getLatest('search'), null);
    assert.notStrictEqual(p.getLatest('export'), null);
  });

  it('pruneExpired works on encrypted data', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-prune-' + Date.now());
    const p = new EncryptedFileMemoryProvider(dir, 'prune-secret-12345');
    const old = createMemoryEvent('search', { query: 'old' });
    old.ts = new Date(Date.now() - 100 * 86_400_000).toISOString();
    p.storeEvent(old);
    p.storeEvent(createMemoryEvent('search', { query: 'new' }));
    const result = p.pruneExpired(30);
    assert.strictEqual(result.pruned, 1);
    assert.strictEqual(p.listEvents().length, 1);
  });

  it('getStats works on encrypted data', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-stats-' + Date.now());
    const p = new EncryptedFileMemoryProvider(dir, 'stats-secret-12345');
    p.storeEvent(createMemoryEvent('search', { query: 'a' }));
    p.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const stats = p.getStats();
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.counts_by_type.search, 1);
    assert.ok(stats.size_bytes > 0);
  });

  it('rejects short secret', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-short-' + Date.now());
    assert.throws(() => new EncryptedFileMemoryProvider(dir, 'short'), /at least 8/);
  });

  it('supportsSearch returns false', async () => {
    const { EncryptedFileMemoryProvider } = await import('../lib/memory-provider-encrypted.mjs');
    const dir = path.join(tmpDir, 'enc-search-' + Date.now());
    const p = new EncryptedFileMemoryProvider(dir, 'search-secret-12345');
    assert.strictEqual(p.supportsSearch(), false);
  });
});

describe('SupabaseMemoryProvider (file fallback, no connection)', () => {
  it('stores and retrieves via file layer when no url/key', async () => {
    const { SupabaseMemoryProvider } = await import('../lib/memory-provider-supabase.mjs');
    const dir = path.join(tmpDir, 'sb-' + Date.now());
    const provider = new SupabaseMemoryProvider(dir, { url: '', key: '' });
    assert.strictEqual(provider.supportsSearch(), false);

    const event = createMemoryEvent('search', { query: 'supabase-test' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.id, event.id);

    const latest = provider.getLatest('search');
    assert.strictEqual(latest.data.query, 'supabase-test');

    const list = provider.listEvents();
    assert.strictEqual(list.length, 1);

    const stats = provider.getStats();
    assert.strictEqual(stats.total, 1);
  });

  it('supportsSearch returns true when url and key are set', async () => {
    const { SupabaseMemoryProvider } = await import('../lib/memory-provider-supabase.mjs');
    const dir = path.join(tmpDir, 'sb-search-' + Date.now());
    const provider = new SupabaseMemoryProvider(dir, { url: 'https://fake.supabase.co', key: 'fake-key' });
    assert.strictEqual(provider.supportsSearch(), true);
  });

  it('clearEvents works via file layer', async () => {
    const { SupabaseMemoryProvider } = await import('../lib/memory-provider-supabase.mjs');
    const dir = path.join(tmpDir, 'sb-clear-' + Date.now());
    const provider = new SupabaseMemoryProvider(dir, { url: '', key: '' });
    provider.storeEvent(createMemoryEvent('search', { query: 'a' }));
    provider.storeEvent(createMemoryEvent('export', { format: 'md' }));
    const result = provider.clearEvents({ type: 'search' });
    assert.strictEqual(result.cleared, 1);
  });

  it('pruneExpired works via file layer', async () => {
    const { SupabaseMemoryProvider } = await import('../lib/memory-provider-supabase.mjs');
    const dir = path.join(tmpDir, 'sb-prune-' + Date.now());
    const provider = new SupabaseMemoryProvider(dir, { url: '', key: '' });
    const old = createMemoryEvent('search', { query: 'old' });
    old.ts = new Date(Date.now() - 100 * 86_400_000).toISOString();
    provider.storeEvent(old);
    provider.storeEvent(createMemoryEvent('search', { query: 'new' }));
    const result = provider.pruneExpired(30);
    assert.strictEqual(result.pruned, 1);
  });

  it('searchEvents returns empty when no url/key', async () => {
    const { SupabaseMemoryProvider } = await import('../lib/memory-provider-supabase.mjs');
    const dir = path.join(tmpDir, 'sb-nosearch-' + Date.now());
    const provider = new SupabaseMemoryProvider(dir, { url: '', key: '' });
    const results = await provider.searchEvents('test');
    assert.deepStrictEqual(results, []);
  });
});

describe('createMemoryManagerAsync with encrypted provider', () => {
  it('creates encrypted provider when encrypt=true and secret set', async () => {
    const { createMemoryManagerAsync } = await import('../lib/memory.mjs');
    const dataDir = path.join(tmpDir, 'cmma-enc-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = {
      data_dir: dataDir,
      memory: { enabled: true, provider: 'file', encrypt: true, secret: 'my-async-secret-12345' },
    };
    const mm = await createMemoryManagerAsync(config);
    mm.store('search', { query: 'encrypted-async' });
    const latest = mm.getLatest('search');
    assert.strictEqual(latest.data.query, 'encrypted-async');

    const encFile = path.join(dataDir, 'memory', 'default', 'events.jsonl.enc');
    assert.ok(fs.existsSync(encFile));
    const raw = fs.readFileSync(encFile, 'utf8');
    assert.ok(!raw.includes('encrypted-async'));
  });
});

describe('session summary', () => {
  it('generateSessionSummary with no events returns early', async () => {
    const { generateSessionSummary } = await import('../lib/memory-session-summary.mjs');
    const dataDir = path.join(tmpDir, 'ss-empty-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file' } };
    const result = await generateSessionSummary(config, { since: new Date().toISOString() });
    assert.strictEqual(result.event_count, 0);
    assert.strictEqual(result.summary, 'No events to summarize.');
    assert.strictEqual(result.id, undefined);
  });
});

describe('supabase-memory import source type', () => {
  it('supabase-memory is a valid import source type', async () => {
    const { isValidImportSourceType, IMPORT_SOURCE_TYPES } = await import('../lib/import-source-types.mjs');
    assert.ok(IMPORT_SOURCE_TYPES.includes('supabase-memory'));
    assert.ok(isValidImportSourceType('supabase-memory'));
  });
});

describe('cross-vault memory (global scope)', () => {
  it('createMemoryManager with scope=global uses _global directory', () => {
    const dataDir = path.join(tmpDir, 'cv-glob-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file', scope: 'global' } };
    const mm = createMemoryManager(config, 'vault-a');
    mm.store('search', { query: 'global-test' });
    const expectedDir = path.join(dataDir, 'memory', '_global');
    assert(fs.existsSync(expectedDir));
    assert(!fs.existsSync(path.join(dataDir, 'memory', 'vault-a')));
  });

  it('scope=vault stores in per-vault directory', () => {
    const dataDir = path.join(tmpDir, 'cv-vault-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file', scope: 'vault' } };
    const mm = createMemoryManager(config, 'vault-b');
    mm.store('search', { query: 'vault-test' });
    assert(fs.existsSync(path.join(dataDir, 'memory', 'vault-b')));
  });

  it('opts.scope overrides config scope', () => {
    const dataDir = path.join(tmpDir, 'cv-ovr-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file', scope: 'vault' } };
    const mm = createMemoryManager(config, 'vault-c', { scope: 'global' });
    mm.store('search', { query: 'override-test' });
    assert(fs.existsSync(path.join(dataDir, 'memory', '_global')));
  });

  it('global memory is shared across vault IDs', () => {
    const dataDir = path.join(tmpDir, 'cv-shared-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file', scope: 'global' } };
    const mm1 = createMemoryManager(config, 'vault-x');
    const mm2 = createMemoryManager(config, 'vault-y');
    mm1.store('search', { query: 'from-x' });
    const events = mm2.list();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data.query, 'from-x');
  });
});

describe('memory event status field', () => {
  it('MEMORY_EVENT_STATUSES is a frozen array with success and failed', () => {
    assert(Array.isArray(MEMORY_EVENT_STATUSES));
    assert(Object.isFrozen(MEMORY_EVENT_STATUSES));
    assert(MEMORY_EVENT_STATUSES.includes('success'));
    assert(MEMORY_EVENT_STATUSES.includes('failed'));
    assert.strictEqual(MEMORY_EVENT_STATUSES.length, 2);
  });

  it('createMemoryEvent defaults status to success', () => {
    const event = createMemoryEvent('search', { query: 'test' });
    assert.strictEqual(event.status, 'success');
  });

  it('createMemoryEvent accepts status=failed', () => {
    const event = createMemoryEvent('search', { query: 'test' }, { status: 'failed' });
    assert.strictEqual(event.status, 'failed');
  });

  it('createMemoryEvent accepts status=success explicitly', () => {
    const event = createMemoryEvent('search', { query: 'test' }, { status: 'success' });
    assert.strictEqual(event.status, 'success');
  });

  it('createMemoryEvent rejects invalid status', () => {
    assert.throws(
      () => createMemoryEvent('search', { query: 'test' }, { status: 'pending' }),
      /Invalid memory event status/
    );
  });

  it('isValidMemoryEvent accepts events with valid status', () => {
    const event = createMemoryEvent('search', { query: 'test' });
    assert(isValidMemoryEvent(event));
    event.status = 'failed';
    assert(isValidMemoryEvent(event));
  });

  it('isValidMemoryEvent accepts events without status (backward compat)', () => {
    const event = createMemoryEvent('search', { query: 'test' });
    delete event.status;
    assert(isValidMemoryEvent(event));
  });

  it('isValidMemoryEvent rejects events with invalid status', () => {
    const event = createMemoryEvent('search', { query: 'test' });
    event.status = 'bogus';
    assert.strictEqual(isValidMemoryEvent(event), false);
  });

  it('MemoryManager.store accepts status option', () => {
    const dir = path.join(tmpDir, 'mm-status-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'ok' });
    mm.store('search', { query: 'fail' }, { status: 'failed' });
    const events = mm.list();
    assert.strictEqual(events.length, 2);
    const statuses = events.map((e) => e.status);
    assert(statuses.includes('success'));
    assert(statuses.includes('failed'));
  });
});

describe('generateMemoryIndex', () => {
  it('returns empty index when no events exist', () => {
    const dir = path.join(tmpDir, 'idx-empty-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    const idx = generateMemoryIndex(mm);
    assert.strictEqual(typeof idx.markdown, 'string');
    assert(idx.markdown.includes('# Memory Index'));
    assert(idx.markdown.includes('empty'));
    assert.strictEqual(idx.total_events, 0);
    assert.deepStrictEqual(idx.types, []);
    assert.strictEqual(typeof idx.generated_at, 'string');
  });

  it('includes event types with counts and latest summary', () => {
    const dir = path.join(tmpDir, 'idx-types-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'blockchain architecture' });
    mm.store('search', { query: 'memory patterns' });
    mm.store('write', { path: 'vault/notes/test.md' });
    const idx = generateMemoryIndex(mm);
    assert(idx.markdown.includes('search: 2 events'));
    assert(idx.markdown.includes('write: 1 events'));
    assert(idx.markdown.includes('memory patterns'));
    assert(idx.markdown.includes('vault/notes/test.md'));
    assert.strictEqual(idx.total_events, 3);
    assert(idx.types.includes('search'));
    assert(idx.types.includes('write'));
  });

  it('includes recent activity section', () => {
    const dir = path.join(tmpDir, 'idx-recent-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'recent query' });
    const idx = generateMemoryIndex(mm);
    assert(idx.markdown.includes('## Recent Activity'));
    assert(idx.markdown.includes('[search]'));
    assert(idx.markdown.includes('recent query'));
  });

  it('filters out failed events from recent activity', () => {
    const dir = path.join(tmpDir, 'idx-filter-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'good query' });
    mm.store('search', { query: 'bad query' }, { status: 'failed' });
    const idx = generateMemoryIndex(mm);
    assert(idx.markdown.includes('good query'));
    assert(!idx.markdown.includes('bad query'));
  });

  it('respects recentLimit option', () => {
    const dir = path.join(tmpDir, 'idx-limit-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    for (let i = 0; i < 10; i++) {
      mm.store('search', { query: `query-${i}` });
    }
    const idx = generateMemoryIndex(mm, { recentLimit: 3 });
    const activitySection = idx.markdown.split('## Recent Activity')[1];
    const activityLines = activitySection.trim().split('\n').filter((l) => l.startsWith('- '));
    assert.strictEqual(activityLines.length, 3);
  });

  it('truncates long summaries', () => {
    const dir = path.join(tmpDir, 'idx-trunc-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'A'.repeat(200) });
    const idx = generateMemoryIndex(mm);
    assert(idx.markdown.includes('…'));
    const lines = idx.markdown.split('\n');
    for (const line of lines) {
      if (line.startsWith('- ') && line.includes('[search]')) {
        assert(line.length < 200);
      }
    }
  });

  it('handles events with different data shapes', () => {
    const dir = path.join(tmpDir, 'idx-shapes-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'test' });
    mm.store('write', { path: 'notes/hello.md' });
    mm.store('export', { format: 'md' });
    mm.store('user', { key: 'preference', theme: 'dark' });
    const idx = generateMemoryIndex(mm);
    assert.strictEqual(idx.total_events, 4);
    assert(idx.types.includes('search'));
    assert(idx.types.includes('write'));
    assert(idx.types.includes('export'));
    assert(idx.types.includes('user'));
  });
});

describe('MemoryManager.generateIndex', () => {
  it('returns index and caches it', () => {
    const dir = path.join(tmpDir, 'mm-idx-cache-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'test' });
    const idx1 = mm.generateIndex();
    const idx2 = mm.generateIndex();
    assert.strictEqual(idx1.generated_at, idx2.generated_at);
  });

  it('force bypasses cache', () => {
    const dir = path.join(tmpDir, 'mm-idx-force-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'test' });
    const idx1 = mm.generateIndex();
    const idx2 = mm.generateIndex({ force: true });
    assert(idx2.generated_at >= idx1.generated_at);
  });

  it('clear invalidates cached index', () => {
    const dir = path.join(tmpDir, 'mm-idx-clear-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('search', { query: 'test' });
    const idx1 = mm.generateIndex({ force: true });
    assert.strictEqual(idx1.total_events, 1);
    mm.clear();
    const idx2 = mm.generateIndex({ force: true });
    assert.strictEqual(idx2.total_events, 0);
  });
});

describe('buildMemoryIndexResource', () => {
  it('returns enabled:false when memory is disabled', async () => {
    const { buildMemoryIndexResource } = await import('../mcp/resources/metadata.mjs');
    const result = buildMemoryIndexResource({ memory: { enabled: false } });
    assert.strictEqual(result.enabled, false);
    assert.strictEqual(result.index, null);
  });

  it('returns index when memory is enabled', async () => {
    const { buildMemoryIndexResource } = await import('../mcp/resources/metadata.mjs');
    const dataDir = path.join(tmpDir, 'mcp-idx-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file' } };
    const mm = createMemoryManager(config);
    mm.store('search', { query: 'mcp test' });
    const result = buildMemoryIndexResource(config);
    assert.strictEqual(result.enabled, true);
    assert.notStrictEqual(result.index, null);
    assert(result.index.markdown.includes('# Memory Index'));
    assert(result.index.markdown.includes('search'));
  });
});
