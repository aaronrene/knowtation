/**
 * Tests for skeptical memory verification: verifyMemoryEvent() and MEMORY_CONFIDENCE_LEVELS.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { createMemoryEvent } from '../lib/memory-event.mjs';
import { verifyMemoryEvent, MEMORY_CONFIDENCE_LEVELS } from '../lib/memory.mjs';

let tmpDir;
let vaultDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-verify-test-'));
  vaultDir = path.join(tmpDir, 'vault');
  fs.mkdirSync(vaultDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MEMORY_CONFIDENCE_LEVELS', () => {
  it('is a frozen array with the three levels', () => {
    assert(Array.isArray(MEMORY_CONFIDENCE_LEVELS));
    assert(Object.isFrozen(MEMORY_CONFIDENCE_LEVELS));
    assert(MEMORY_CONFIDENCE_LEVELS.includes('verified'));
    assert(MEMORY_CONFIDENCE_LEVELS.includes('hint'));
    assert(MEMORY_CONFIDENCE_LEVELS.includes('stale'));
    assert.strictEqual(MEMORY_CONFIDENCE_LEVELS.length, 3);
  });
});

describe('verifyMemoryEvent — no path reference', () => {
  it('returns hint when event data has no path reference', () => {
    const config = { vault_path: vaultDir };
    const event = createMemoryEvent('search', { query: 'test' });
    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'hint');
    assert(result.reason.includes('no verifiable path'));
  });

  it('returns hint when event is null', () => {
    const result = verifyMemoryEvent({ vault_path: vaultDir }, null);
    assert.strictEqual(result.confidence, 'hint');
  });

  it('returns hint when event is not an object', () => {
    const result = verifyMemoryEvent({ vault_path: vaultDir }, 'not-an-event');
    assert.strictEqual(result.confidence, 'hint');
  });

  it('returns hint when vault_path is not configured', () => {
    const event = createMemoryEvent('write', { path: 'notes/test.md' });
    const result = verifyMemoryEvent({}, event);
    assert.strictEqual(result.confidence, 'hint');
    assert(result.reason.includes('vault_path not configured'));
  });

  it('returns hint for user events with no path', () => {
    const event = createMemoryEvent('user', { key: 'preference', theme: 'dark' });
    const result = verifyMemoryEvent({ vault_path: vaultDir }, event);
    assert.strictEqual(result.confidence, 'hint');
  });
});

describe('verifyMemoryEvent — failed status', () => {
  it('returns stale for events with status=failed', () => {
    const event = createMemoryEvent('write', { path: 'notes/test.md' }, { status: 'failed' });
    const result = verifyMemoryEvent({ vault_path: vaultDir }, event);
    assert.strictEqual(result.confidence, 'stale');
    assert(result.reason.includes('failed operation'));
  });
});

describe('verifyMemoryEvent — path verification', () => {
  let noteDir;

  beforeEach(() => {
    noteDir = path.join(tmpDir, 'notes-' + Date.now());
    fs.mkdirSync(noteDir, { recursive: true });
  });

  it('returns stale when referenced path does not exist', () => {
    const config = { vault_path: noteDir };
    const event = createMemoryEvent('write', { path: 'notes/nonexistent.md' });
    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'stale');
    assert(result.reason.includes('no longer exists'));
  });

  it('returns verified when referenced path exists and is unchanged', () => {
    const notePath = 'notes/exists.md';
    const absPath = path.join(noteDir, notePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    // Set mtime explicitly to the past so the event ts (now) is always after the file mtime
    fs.writeFileSync(absPath, '# Test Note\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(absPath, pastMtime, pastMtime);

    const config = { vault_path: noteDir };
    const event = createMemoryEvent('write', { path: notePath });
    // event.ts is now — file mtime is 10s ago, so file has not changed since event

    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'verified');
    assert(result.reason.includes('exists and unchanged'));
  });

  it('returns stale when referenced path was modified after event ts', () => {
    const notePath = 'notes/modified.md';
    const absPath = path.join(noteDir, notePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    const oldTs = new Date(Date.now() - 10000).toISOString();
    const event = createMemoryEvent('write', { path: notePath });
    event.ts = oldTs;

    fs.writeFileSync(absPath, '# Modified Note\n', 'utf8');

    const config = { vault_path: noteDir };
    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'stale');
    assert(result.reason.includes('modified after event'));
  });

  it('extracts path from data.path field (write events)', () => {
    const notePath = 'inbox/test.md';
    const absPath = path.join(noteDir, notePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, '# Inbox note\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(absPath, pastMtime, pastMtime);

    const config = { vault_path: noteDir };
    const event = createMemoryEvent('write', { path: notePath });

    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'verified');
  });

  it('extracts first path from data.paths array (search events)', () => {
    const notePath = 'projects/alpha.md';
    const absPath = path.join(noteDir, notePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, '# Alpha\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(absPath, pastMtime, pastMtime);

    const config = { vault_path: noteDir };
    const event = createMemoryEvent('search', {
      query: 'alpha project',
      paths: [notePath, 'projects/beta.md'],
    });

    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'verified');
  });

  it('returns stale when first path in paths array is missing', () => {
    const config = { vault_path: noteDir };
    const event = createMemoryEvent('search', {
      query: 'something',
      paths: ['missing/note.md', 'other.md'],
    });
    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'stale');
  });

  it('extracts path from data.exported array (export events)', () => {
    const notePath = 'exports/report.md';
    const absPath = path.join(noteDir, notePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, '# Report\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(absPath, pastMtime, pastMtime);

    const config = { vault_path: noteDir };
    const event = createMemoryEvent('export', {
      format: 'md',
      exported: [{ path: notePath }],
    });

    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'verified');
  });

  it('accepts absolute paths in event data', () => {
    const absNotePath = path.join(noteDir, 'absolute.md');
    fs.writeFileSync(absNotePath, '# Absolute\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(absNotePath, pastMtime, pastMtime);

    const config = { vault_path: noteDir };
    const event = createMemoryEvent('write', { path: absNotePath });

    const result = verifyMemoryEvent(config, event);
    assert.strictEqual(result.confidence, 'verified');
  });
});

describe('verifyMemoryEvent — edge cases', () => {
  it('handles missing config gracefully', () => {
    const event = createMemoryEvent('write', { path: 'test.md' });
    const result = verifyMemoryEvent(null, event);
    assert.strictEqual(result.confidence, 'hint');
  });

  it('handles events with no ts gracefully', () => {
    const notePath = 'no-ts.md';
    const absPath = path.join(vaultDir, notePath);
    fs.writeFileSync(absPath, '# No TS\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(absPath, pastMtime, pastMtime);

    const event = createMemoryEvent('write', { path: notePath });
    delete event.ts;

    const config = { vault_path: vaultDir };
    const result = verifyMemoryEvent(config, event);
    // No ts means no "modified after event" check — file exists so verified
    assert.strictEqual(result.confidence, 'verified');
  });

  it('all three confidence levels are returned correctly', () => {
    const config = { vault_path: vaultDir };

    const hintEvent = createMemoryEvent('search', { query: 'no paths here' });
    assert.strictEqual(verifyMemoryEvent(config, hintEvent).confidence, 'hint');

    const staleEvent = createMemoryEvent('write', { path: 'definitely/does/not/exist.md' });
    assert.strictEqual(verifyMemoryEvent(config, staleEvent).confidence, 'stale');

    const verifiedPath = 'verified-note.md';
    const verifiedAbsPath = path.join(vaultDir, verifiedPath);
    fs.writeFileSync(verifiedAbsPath, '# Verified\n', 'utf8');
    const pastMtime = new Date(Date.now() - 10000);
    fs.utimesSync(verifiedAbsPath, pastMtime, pastMtime);
    const verifiedEvent = createMemoryEvent('write', { path: verifiedPath });
    assert.strictEqual(verifyMemoryEvent(config, verifiedEvent).confidence, 'verified');
  });
});
