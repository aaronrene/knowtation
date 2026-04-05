/**
 * Hosted memory tests — verifies the per-user/vault partitioning and memory operations
 * that the bridge endpoints use, without importing the full bridge server.
 *
 * The bridge memory endpoints use FileMemoryProvider + MemoryManager directly.
 * This test validates the same code path with the same directory structure.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { FileMemoryProvider } from '../lib/memory-provider-file.mjs';
import { MemoryManager } from '../lib/memory.mjs';
import { createMemoryEvent } from '../lib/memory-event.mjs';

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-hosted-mem-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sanitizeUserId(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default';
}

function sanitizeVaultId(vaultId) {
  return String(vaultId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function bridgeMemoryDir(dataDir, uid, vaultId) {
  return path.join(dataDir, 'memory', sanitizeUserId(uid), sanitizeVaultId(vaultId));
}

describe('Hosted memory: per-user/vault isolation', () => {
  it('isolates memory between users', () => {
    const dataDir = path.join(tmpDir, 'iso-users-' + Date.now());
    const dir1 = bridgeMemoryDir(dataDir, 'alice', 'default');
    const dir2 = bridgeMemoryDir(dataDir, 'bob', 'default');
    const p1 = new FileMemoryProvider(dir1);
    const p2 = new FileMemoryProvider(dir2);
    const mm1 = new MemoryManager(p1);
    const mm2 = new MemoryManager(p2);

    mm1.store('search', { query: 'alice query' });
    mm2.store('search', { query: 'bob query' });

    const a = mm1.getLatest('search');
    const b = mm2.getLatest('search');
    assert.strictEqual(a.data.query, 'alice query');
    assert.strictEqual(b.data.query, 'bob query');

    assert.strictEqual(mm1.stats().total, 1);
    assert.strictEqual(mm2.stats().total, 1);
  });

  it('isolates memory between vaults for same user', () => {
    const dataDir = path.join(tmpDir, 'iso-vaults-' + Date.now());
    const dir1 = bridgeMemoryDir(dataDir, 'alice', 'vault-a');
    const dir2 = bridgeMemoryDir(dataDir, 'alice', 'vault-b');
    const mm1 = new MemoryManager(new FileMemoryProvider(dir1));
    const mm2 = new MemoryManager(new FileMemoryProvider(dir2));

    mm1.store('search', { query: 'in vault-a' });
    mm2.store('export', { format: 'md' });

    assert.strictEqual(mm1.getLatest('search').data.query, 'in vault-a');
    assert.strictEqual(mm1.getLatest('export'), null);
    assert.strictEqual(mm2.getLatest('search'), null);
    assert.notStrictEqual(mm2.getLatest('export'), null);
  });

  it('sanitizeUserId handles special characters', () => {
    assert.strictEqual(sanitizeUserId('user@email.com'), 'user_email_com');
    assert.strictEqual(sanitizeUserId('uid-123_test'), 'uid-123_test');
    assert.strictEqual(sanitizeUserId(''), 'default');
  });

  it('directory structure matches bridge convention', () => {
    const dataDir = path.join(tmpDir, 'dir-struct-' + Date.now());
    const dir = bridgeMemoryDir(dataDir, 'user_1', 'my-vault');
    const expected = path.join(dataDir, 'memory', 'user_1', 'my-vault');
    assert.strictEqual(dir, expected);
  });
});

describe('Hosted memory: bridge-like endpoint behavior', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = path.join(tmpDir, 'bridge-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  });

  it('GET memory/:key returns null when empty', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    const event = mm.getLatest('search');
    assert.strictEqual(event, null);
  });

  it('POST memory/store + GET memory/:key round-trip', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));

    const result = mm.store('user', { key: 'test_key', note: 'hello' });
    assert.match(result.id, /^mem_/);

    const latest = mm.getLatest('user');
    assert.strictEqual(latest.data.note, 'hello');
  });

  it('GET memory (list) returns filtered events', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    mm.store('search', { query: 'a' });
    mm.store('export', { format: 'md' });
    mm.store('search', { query: 'b' });

    const all = mm.list({ limit: 20 });
    assert.strictEqual(all.length, 3);

    const searches = mm.list({ type: 'search', limit: 20 });
    assert.strictEqual(searches.length, 2);
  });

  it('GET memory-stats returns stats', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    mm.store('search', { query: 'a' });
    mm.store('search', { query: 'b' });

    const stats = mm.stats();
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.counts_by_type.search, 2);
  });

  it('DELETE memory/clear clears all for user', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    mm.store('search', { query: 'a' });
    mm.store('export', { format: 'md' });

    const result = mm.clear();
    assert.strictEqual(result.cleared, 2);
    assert.strictEqual(mm.stats().total, 0);
  });

  it('DELETE memory/clear by type only clears that type', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    mm.store('search', { query: 'a' });
    mm.store('export', { format: 'md' });

    const result = mm.clear({ type: 'search' });
    assert.strictEqual(result.cleared, 1);
    assert.strictEqual(mm.stats().total, 1);
    assert.notStrictEqual(mm.getLatest('export'), null);
  });

  it('store rejects sensitive data', () => {
    const dir = bridgeMemoryDir(dataDir, 'user1', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    assert.throws(
      () => mm.store('user', { api_key: 'sk-secret' }),
      /sensitive key patterns/
    );
  });
});

describe('auto-capture: shouldCapture and DEFAULT_CAPTURE_TYPES', () => {
  let dataDir;
  before(() => { dataDir = fs.mkdtempSync(path.join(tmpDir, 'autocap-')); });

  it('shouldCapture returns true for search (in DEFAULT_CAPTURE_TYPES)', () => {
    const dir = bridgeMemoryDir(dataDir, 'user_ac', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    assert.ok(mm.shouldCapture('search'));
    assert.ok(mm.shouldCapture('write'));
    assert.ok(mm.shouldCapture('index'));
    assert.ok(mm.shouldCapture('import'));
  });

  it('shouldCapture returns false for consolidation (not in DEFAULT_CAPTURE_TYPES)', () => {
    const dir = bridgeMemoryDir(dataDir, 'user_ac2', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    assert.ok(!mm.shouldCapture('consolidation'));
    assert.ok(!mm.shouldCapture('consolidation_pass'));
    assert.ok(!mm.shouldCapture('maintenance'));
  });

  it('captures search event and makes it available for consolidation', () => {
    const dir = bridgeMemoryDir(dataDir, 'user_ac3', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    if (mm.shouldCapture('search')) mm.store('search', { query: 'memory consolidation', mode: 'semantic', result_count: 3 });
    if (mm.shouldCapture('search')) mm.store('search', { query: 'vault notes', mode: 'keyword', result_count: 5 });
    const events = mm.list({ type: 'search' });
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].data.query, 'vault notes');
    assert.ok(events[0].ts, 'captured event must have ts field');
  });

  it('captures write event with path and action', () => {
    const dir = bridgeMemoryDir(dataDir, 'user_ac4', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    if (mm.shouldCapture('write')) mm.store('write', { path: 'projects/my-project/note.md', action: 'write' });
    const ev = mm.getLatest('write');
    assert.ok(ev);
    assert.strictEqual(ev.data.path, 'projects/my-project/note.md');
    assert.ok(ev.ts);
  });

  it('captures index event with note_count', () => {
    const dir = bridgeMemoryDir(dataDir, 'user_ac5', 'default');
    const mm = new MemoryManager(new FileMemoryProvider(dir));
    if (mm.shouldCapture('index')) mm.store('index', { note_count: 20, chunk_count: 45 });
    const ev = mm.getLatest('index');
    assert.ok(ev);
    assert.strictEqual(ev.data.note_count, 20);
    assert.ok(ev.ts);
  });
});
