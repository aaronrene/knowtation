/**
 * Session 3 — Topic-Based Memory Partitioning tests.
 *
 * Covers: extractTopicFromEvent, slugify, FileMemoryProvider topic partitioning,
 * MemoryManager topic methods, generateMemoryIndex with topics, CLI --topic,
 * and MCP metadata builder.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  createMemoryEvent,
  extractTopicFromEvent,
  slugify,
} from '../lib/memory-event.mjs';
import { FileMemoryProvider } from '../lib/memory-provider-file.mjs';
import {
  MemoryManager,
  createMemoryManager,
  generateMemoryIndex,
} from '../lib/memory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-topics-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    assert.strictEqual(slugify('Hello World!'), 'hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    assert.strictEqual(slugify('--foo--bar--'), 'foo-bar');
  });

  it('collapses runs of hyphens', () => {
    assert.strictEqual(slugify('a   b   c'), 'a-b-c');
  });

  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100);
    assert.strictEqual(slugify(long).length, 64);
  });

  it('handles empty string', () => {
    assert.strictEqual(slugify(''), '');
  });

  it('handles numbers', () => {
    assert.strictEqual(slugify('Phase 12'), 'phase-12');
  });
});

// ---------------------------------------------------------------------------
// extractTopicFromEvent
// ---------------------------------------------------------------------------

describe('extractTopicFromEvent', () => {
  it('uses explicit data.topic when provided', () => {
    const event = createMemoryEvent('search', { topic: 'Blockchain Architecture', query: 'test' });
    assert.strictEqual(extractTopicFromEvent(event), 'blockchain-architecture');
  });

  it('derives topic from data.path directory component', () => {
    const event = createMemoryEvent('write', { path: 'projects/notes/file.md' });
    assert.strictEqual(extractTopicFromEvent(event), 'projects');
  });

  it('derives topic from data.paths[0] directory component', () => {
    const event = createMemoryEvent('search', { query: 'test', paths: ['inbox/capture.md', 'other.md'] });
    assert.strictEqual(extractTopicFromEvent(event), 'inbox');
  });

  it('uses filename stem when path has no directory', () => {
    const event = createMemoryEvent('write', { path: 'my-note.md' });
    assert.strictEqual(extractTopicFromEvent(event), 'my-note');
  });

  it('extracts keywords from data.query', () => {
    const event = createMemoryEvent('search', { query: 'blockchain consensus mechanism' });
    assert.strictEqual(extractTopicFromEvent(event), 'blockchain-consensus-mechanism');
  });

  it('filters stop words from query', () => {
    const event = createMemoryEvent('search', { query: 'the best way to do it' });
    assert.strictEqual(extractTopicFromEvent(event), 'best-way');
  });

  it('limits query keywords to 3', () => {
    const event = createMemoryEvent('search', { query: 'alpha beta gamma delta epsilon' });
    assert.strictEqual(extractTopicFromEvent(event), 'alpha-beta-gamma');
  });

  it('uses data.source as fallback', () => {
    const event = createMemoryEvent('capture', { source: 'mem0', text: 'hello' });
    assert.strictEqual(extractTopicFromEvent(event), 'mem0');
  });

  it('uses data.source_type as fallback', () => {
    const event = createMemoryEvent('import', { source_type: 'chatgpt', count: 5 });
    assert.strictEqual(extractTopicFromEvent(event), 'chatgpt');
  });

  it('uses data.key for user events', () => {
    const event = createMemoryEvent('user', { key: 'my_preference', theme: 'dark' });
    assert.strictEqual(extractTopicFromEvent(event), 'my-preference');
  });

  it('uses data.format for export events', () => {
    const event = createMemoryEvent('export', { format: 'md' });
    assert.strictEqual(extractTopicFromEvent(event), 'export-md');
  });

  it('falls back to event type', () => {
    const event = createMemoryEvent('index', { count: 100 });
    assert.strictEqual(extractTopicFromEvent(event), 'index');
  });

  it('returns "unknown" for null event', () => {
    assert.strictEqual(extractTopicFromEvent(null), 'unknown');
  });

  it('returns event type for null data', () => {
    assert.strictEqual(extractTopicFromEvent({ type: 'search', data: null }), 'search');
  });

  it('handles backslash paths (Windows-style)', () => {
    const event = createMemoryEvent('write', { path: 'vault\\notes\\test.md' });
    assert.strictEqual(extractTopicFromEvent(event), 'vault');
  });
});

// ---------------------------------------------------------------------------
// FileMemoryProvider — topic partitioning
// ---------------------------------------------------------------------------

describe('FileMemoryProvider with topicPartition', () => {
  let providerDir;
  let provider;

  beforeEach(() => {
    providerDir = path.join(tmpDir, 'fmp-topic-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    provider = new FileMemoryProvider(providerDir, { topicPartition: true });
  });

  it('topicPartitionEnabled returns true', () => {
    assert.strictEqual(provider.topicPartitionEnabled, true);
  });

  it('storeEvent writes to both events.jsonl and topics/{slug}.jsonl', () => {
    const event = createMemoryEvent('write', { path: 'projects/note.md' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.topic, 'projects');

    const mainLog = path.join(providerDir, 'events.jsonl');
    assert(fs.existsSync(mainLog));

    const topicFile = path.join(providerDir, 'topics', 'projects.jsonl');
    assert(fs.existsSync(topicFile));

    const topicLines = fs.readFileSync(topicFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(topicLines.length, 1);
    const parsed = JSON.parse(topicLines[0]);
    assert.strictEqual(parsed.id, event.id);
  });

  it('storeEvent returns topic in result', () => {
    const event = createMemoryEvent('search', { query: 'blockchain consensus' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.topic, 'blockchain-consensus');
  });

  it('multiple events to same topic append to same file', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/b.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'projects/c.md' }));

    const inboxLines = fs.readFileSync(path.join(providerDir, 'topics', 'inbox.jsonl'), 'utf8')
      .split('\n').filter(Boolean);
    assert.strictEqual(inboxLines.length, 2);

    const projectLines = fs.readFileSync(path.join(providerDir, 'topics', 'projects.jsonl'), 'utf8')
      .split('\n').filter(Boolean);
    assert.strictEqual(projectLines.length, 1);
  });

  it('listEvents with topic filter reads from topic file', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'projects/b.md' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'test', paths: ['inbox/c.md'] }));

    const inboxEvents = provider.listEvents({ topic: 'inbox' });
    assert.strictEqual(inboxEvents.length, 2);
    for (const e of inboxEvents) {
      assert(e.data.path?.startsWith('inbox') || e.data.paths?.[0]?.startsWith('inbox'));
    }
  });

  it('listEvents with topic + type applies both filters', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'test', paths: ['inbox/c.md'] }));

    const events = provider.listEvents({ topic: 'inbox', type: 'write' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'write');
  });

  it('listEvents with nonexistent topic returns empty', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    const events = provider.listEvents({ topic: 'nonexistent' });
    assert.deepStrictEqual(events, []);
  });

  it('listTopics returns all topic slugs', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'projects/b.md' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'blockchain test' }));

    const topics = provider.listTopics();
    assert(Array.isArray(topics));
    assert(topics.includes('inbox'));
    assert(topics.includes('projects'));
    assert(topics.includes('blockchain-test'));
    assert.deepStrictEqual(topics, [...topics].sort());
  });

  it('getTopicStats returns correct stats', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/b.md' }));

    const stats = provider.getTopicStats('inbox');
    assert.strictEqual(stats.topic, 'inbox');
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(typeof stats.oldest, 'string');
    assert.strictEqual(typeof stats.newest, 'string');
  });

  it('getTopicStats returns zero for unknown topic', () => {
    const stats = provider.getTopicStats('unknown');
    assert.strictEqual(stats.total, 0);
    assert.strictEqual(stats.oldest, null);
  });

  it('getStats includes topics array', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'projects/b.md' }));

    const stats = provider.getStats();
    assert(Array.isArray(stats.topics));
    assert(stats.topics.includes('inbox'));
    assert(stats.topics.includes('projects'));
  });

  it('clearEvents rebuilds topic partitions', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'blockchain' }));

    assert(provider.listTopics().includes('inbox'));
    assert(provider.listTopics().includes('blockchain'));

    provider.clearEvents({ type: 'write' });

    const topics = provider.listTopics();
    assert(!topics.includes('inbox'));
    assert(topics.includes('blockchain'));
  });

  it('clearEvents with no filters empties all topic files', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('search', { query: 'test' }));

    provider.clearEvents();

    const topics = provider.listTopics();
    assert.strictEqual(topics.length, 0);
  });

  it('pruneExpired rebuilds topic partitions', () => {
    const old = createMemoryEvent('write', { path: 'inbox/a.md' });
    old.ts = new Date(Date.now() - 100 * 86_400_000).toISOString();
    provider.storeEvent(old);
    provider.storeEvent(createMemoryEvent('search', { query: 'recent blockchain' }));

    assert(provider.listTopics().includes('inbox'));

    provider.pruneExpired(30);

    const topics = provider.listTopics();
    assert(!topics.includes('inbox'));
    assert(topics.includes('recent-blockchain'));
  });
});

// ---------------------------------------------------------------------------
// FileMemoryProvider — topic filter without partitioning (fallback scan)
// ---------------------------------------------------------------------------

describe('FileMemoryProvider topic filter without partitioning', () => {
  let providerDir;
  let provider;

  beforeEach(() => {
    providerDir = path.join(tmpDir, 'fmp-notopic-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    provider = new FileMemoryProvider(providerDir);
  });

  it('topicPartitionEnabled returns false', () => {
    assert.strictEqual(provider.topicPartitionEnabled, false);
  });

  it('storeEvent does NOT return topic field', () => {
    const event = createMemoryEvent('write', { path: 'inbox/a.md' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.topic, undefined);
  });

  it('storeEvent does NOT create topics/ directory', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    assert(!fs.existsSync(path.join(providerDir, 'topics')));
  });

  it('listEvents with topic filter still works (scans all events)', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    provider.storeEvent(createMemoryEvent('write', { path: 'projects/b.md' }));

    const events = provider.listEvents({ topic: 'inbox' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data.path, 'inbox/a.md');
  });

  it('listTopics returns empty when no partitioning', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    assert.deepStrictEqual(provider.listTopics(), []);
  });

  it('getStats does NOT include topics array', () => {
    provider.storeEvent(createMemoryEvent('write', { path: 'inbox/a.md' }));
    const stats = provider.getStats();
    assert.strictEqual(stats.topics, undefined);
  });
});

// ---------------------------------------------------------------------------
// MemoryManager topic methods
// ---------------------------------------------------------------------------

describe('MemoryManager topic methods', () => {
  it('list with topic filter delegates to provider', () => {
    const dir = path.join(tmpDir, 'mm-topic-' + Date.now());
    const provider = new FileMemoryProvider(dir, { topicPartition: true });
    const mm = new MemoryManager(provider);

    mm.store('write', { path: 'inbox/a.md' });
    mm.store('write', { path: 'projects/b.md' });

    const events = mm.list({ topic: 'inbox' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data.path, 'inbox/a.md');
  });

  it('listTopics returns topic slugs', () => {
    const dir = path.join(tmpDir, 'mm-topics-list-' + Date.now());
    const provider = new FileMemoryProvider(dir, { topicPartition: true });
    const mm = new MemoryManager(provider);

    mm.store('write', { path: 'inbox/a.md' });
    mm.store('search', { query: 'blockchain consensus' });

    const topics = mm.listTopics();
    assert(topics.includes('inbox'));
    assert(topics.includes('blockchain-consensus'));
  });

  it('topicStats returns stats for a topic', () => {
    const dir = path.join(tmpDir, 'mm-topic-stats-' + Date.now());
    const provider = new FileMemoryProvider(dir, { topicPartition: true });
    const mm = new MemoryManager(provider);

    mm.store('write', { path: 'inbox/a.md' });
    mm.store('write', { path: 'inbox/b.md' });

    const stats = mm.topicStats('inbox');
    assert.strictEqual(stats.total, 2);
  });

  it('listTopics returns empty for non-partitioned provider', () => {
    const dir = path.join(tmpDir, 'mm-notopic-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);
    mm.store('write', { path: 'inbox/a.md' });
    assert.deepStrictEqual(mm.listTopics(), []);
  });
});

// ---------------------------------------------------------------------------
// createMemoryManager with topic_partition config
// ---------------------------------------------------------------------------

describe('createMemoryManager with topic_partition', () => {
  it('creates provider with topicPartition when config says topic_partition: true', () => {
    const dataDir = path.join(tmpDir, 'cmm-tp-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = {
      data_dir: dataDir,
      memory: { enabled: true, provider: 'file', topic_partition: true },
    };
    const mm = createMemoryManager(config);
    mm.store('write', { path: 'inbox/a.md' });

    const topicFile = path.join(dataDir, 'memory', 'default', 'topics', 'inbox.jsonl');
    assert(fs.existsSync(topicFile));
  });

  it('does NOT create topic files when topic_partition is not set', () => {
    const dataDir = path.join(tmpDir, 'cmm-notp-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = {
      data_dir: dataDir,
      memory: { enabled: true, provider: 'file' },
    };
    const mm = createMemoryManager(config);
    mm.store('write', { path: 'inbox/a.md' });

    const topicsDir = path.join(dataDir, 'memory', 'default', 'topics');
    assert(!fs.existsSync(topicsDir));
  });
});

// ---------------------------------------------------------------------------
// generateMemoryIndex with topics
// ---------------------------------------------------------------------------

describe('generateMemoryIndex with topics', () => {
  it('includes Topics section when topics exist', () => {
    const dir = path.join(tmpDir, 'idx-topics-' + Date.now());
    const provider = new FileMemoryProvider(dir, { topicPartition: true });
    const mm = new MemoryManager(provider);

    mm.store('write', { path: 'inbox/a.md' });
    mm.store('search', { query: 'blockchain consensus' });

    const idx = generateMemoryIndex(mm);
    assert(idx.markdown.includes('## Topics'));
    assert(idx.markdown.includes('inbox:'));
    assert(idx.markdown.includes('blockchain-consensus:'));
    assert(Array.isArray(idx.topics));
    assert(idx.topics.includes('inbox'));
    assert(idx.topics.includes('blockchain-consensus'));
  });

  it('omits Topics section when no topics', () => {
    const dir = path.join(tmpDir, 'idx-no-topics-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    const mm = new MemoryManager(provider);

    mm.store('search', { query: 'test' });

    const idx = generateMemoryIndex(mm);
    assert(!idx.markdown.includes('## Topics'));
    assert.deepStrictEqual(idx.topics, []);
  });

  it('Topics section shows event counts per topic', () => {
    const dir = path.join(tmpDir, 'idx-topic-counts-' + Date.now());
    const provider = new FileMemoryProvider(dir, { topicPartition: true });
    const mm = new MemoryManager(provider);

    mm.store('write', { path: 'inbox/a.md' });
    mm.store('write', { path: 'inbox/b.md' });
    mm.store('write', { path: 'inbox/c.md' });

    const idx = generateMemoryIndex(mm);
    assert(idx.markdown.includes('inbox: 3 events'));
  });
});

// ---------------------------------------------------------------------------
// buildMemoryTopicResource
// ---------------------------------------------------------------------------

describe('buildMemoryTopicResource', () => {
  it('returns events for a topic', async () => {
    const { buildMemoryTopicResource } = await import('../mcp/resources/metadata.mjs');
    const dataDir = path.join(tmpDir, 'mcp-topic-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file', topic_partition: true } };
    const mm = createMemoryManager(config);
    mm.store('write', { path: 'inbox/a.md' });
    mm.store('write', { path: 'projects/b.md' });

    const result = buildMemoryTopicResource(config, 'inbox');
    assert.strictEqual(result.enabled, true);
    assert.strictEqual(result.topic, 'inbox');
    assert.strictEqual(result.count, 1);
    assert(Array.isArray(result.events));
    assert(Array.isArray(result.all_topics));
  });

  it('returns empty when memory disabled', async () => {
    const { buildMemoryTopicResource } = await import('../mcp/resources/metadata.mjs');
    const result = buildMemoryTopicResource({ memory: { enabled: false } }, 'inbox');
    assert.strictEqual(result.enabled, false);
    assert.strictEqual(result.count, 0);
  });

  it('returns empty for nonexistent topic', async () => {
    const { buildMemoryTopicResource } = await import('../mcp/resources/metadata.mjs');
    const dataDir = path.join(tmpDir, 'mcp-topic-miss-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });
    const config = { data_dir: dataDir, memory: { enabled: true, provider: 'file', topic_partition: true } };
    const result = buildMemoryTopicResource(config, 'nonexistent');
    assert.strictEqual(result.count, 0);
  });
});

// ---------------------------------------------------------------------------
// CLI --topic integration (via execSync)
// ---------------------------------------------------------------------------

describe('CLI memory list --topic', () => {
  const cliPath = path.join(__dirname, '..', 'cli', 'index.mjs');
  let cliTmpDir;
  let vaultDir;
  let dataDir;

  before(() => {
    cliTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-cli-topic-'));
    vaultDir = path.join(cliTmpDir, 'vault');
    dataDir = path.join(cliTmpDir, 'data');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(cliTmpDir, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(cliTmpDir, 'config', 'local.yaml'),
      `vault_path: ${vaultDir}\ndata_dir: ${dataDir}\nmemory:\n  enabled: true\n  provider: file\n  topic_partition: true\n`,
      'utf8'
    );
    fs.writeFileSync(path.join(vaultDir, 'test.md'), '---\ntitle: test\n---\nHello', 'utf8');
  });

  after(() => {
    fs.rmSync(cliTmpDir, { recursive: true, force: true });
  });

  function run(cmdArgs) {
    const env = {
      ...process.env,
      KNOWTATION_VAULT_PATH: vaultDir,
      KNOWTATION_DATA_DIR: dataDir,
      KNOWTATION_MEMORY_ENABLED: 'true',
      KNOWTATION_MEMORY_PROVIDER: 'file',
    };
    try {
      const out = execSync(`node ${cliPath} ${cmdArgs}`, {
        cwd: path.join(__dirname, '..'),
        env,
        timeout: 10000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout: out.trim(), exitCode: 0 };
    } catch (e) {
      return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status };
    }
  }

  it('memory list --topic filters events by topic', () => {
    run('memory store inbox_item \'{"path":"inbox/a.md"}\'');
    run('memory store project_item \'{"path":"projects/b.md"}\'');

    const allR = run('memory list --json');
    assert.strictEqual(allR.exitCode, 0);
    const allData = JSON.parse(allR.stdout);
    assert(allData.count >= 2);

    const topicR = run('memory list --topic inbox --json');
    assert.strictEqual(topicR.exitCode, 0);
  });

  it('memory list --help mentions --topic', () => {
    const r = run('memory --help');
    assert.strictEqual(r.exitCode, 0);
    assert(r.stdout.includes('--topic'));
  });
});

// ---------------------------------------------------------------------------
// Edge cases and backward compatibility
// ---------------------------------------------------------------------------

describe('topic partitioning backward compatibility', () => {
  it('existing events without topic partitioning are not lost', () => {
    const dir = path.join(tmpDir, 'compat-topic-' + Date.now());
    const oldProvider = new FileMemoryProvider(dir);
    oldProvider.storeEvent(createMemoryEvent('search', { query: 'old event' }));
    oldProvider.storeEvent(createMemoryEvent('write', { path: 'inbox/note.md' }));

    assert(!fs.existsSync(path.join(dir, 'topics')));

    const newProvider = new FileMemoryProvider(dir, { topicPartition: true });
    const events = newProvider.listEvents();
    assert.strictEqual(events.length, 2);

    newProvider.storeEvent(createMemoryEvent('write', { path: 'inbox/new.md' }));
    assert(fs.existsSync(path.join(dir, 'topics', 'inbox.jsonl')));

    const inboxFromTopic = newProvider.listEvents({ topic: 'inbox' });
    assert.strictEqual(inboxFromTopic.length, 1);
    assert.strictEqual(inboxFromTopic[0].data.path, 'inbox/new.md');

    const allEvents = newProvider.listEvents();
    assert.strictEqual(allEvents.length, 3);
  });

  it('FileMemoryProvider constructor defaults topicPartition to false', () => {
    const dir = path.join(tmpDir, 'compat-default-' + Date.now());
    const provider = new FileMemoryProvider(dir);
    assert.strictEqual(provider.topicPartitionEnabled, false);
  });

  it('all existing provider methods still work with topic partitioning enabled', () => {
    const dir = path.join(tmpDir, 'compat-methods-' + Date.now());
    const provider = new FileMemoryProvider(dir, { topicPartition: true });

    const event = createMemoryEvent('search', { query: 'test' });
    const result = provider.storeEvent(event);
    assert.strictEqual(result.id, event.id);
    assert.strictEqual(result.ts, event.ts);

    const latest = provider.getLatest('search');
    assert.strictEqual(latest.data.query, 'test');

    const list = provider.listEvents();
    assert.strictEqual(list.length, 1);

    const stats = provider.getStats();
    assert.strictEqual(stats.total, 1);

    assert.strictEqual(provider.supportsSearch(), false);
    assert.deepStrictEqual(provider.searchEvents('anything'), []);

    const clearResult = provider.clearEvents();
    assert.strictEqual(clearResult.cleared, 1);
    assert.strictEqual(provider.listEvents().length, 0);
  });
});
