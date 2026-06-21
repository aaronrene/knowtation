/**
 * Tier 1–2 — UNIT/INTEGRATION: timeline merge and range parsing.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTimelineRange,
  parseTimelineLayers,
  buildCalendarTimeline,
  noteCalendarDayKey,
} from '../lib/calendar/timeline.mjs';
import { importIcsIntoVault } from '../lib/calendar/event-store.mjs';
import { writeNote } from '../lib/write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-timeline');

describe('parseTimelineRange', () => {
  it('accepts YYYY-MM-DD boundaries', () => {
    const r = parseTimelineRange('2026-06-01', '2026-06-30');
    assert.equal(r.fromDate, '2026-06-01');
    assert.equal(r.toDate, '2026-06-30');
    assert.equal(r.fromIso, '2026-06-01T00:00:00.000Z');
  });

  it('rejects inverted ranges', () => {
    assert.throws(() => parseTimelineRange('2026-06-30', '2026-06-01'), /before/);
  });
});

describe('parseTimelineLayers', () => {
  it('defaults to notes and events', () => {
    assert.deepEqual(parseTimelineLayers(undefined), ['notes', 'events']);
  });

  it('supports notes-only preset', () => {
    assert.deepEqual(parseTimelineLayers('notes'), ['notes']);
  });
});

describe('buildCalendarTimeline', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultPath = path.join(tmpRoot, 'vault');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(vaultPath, { recursive: true });
    writeNote(vaultPath, 'notes/june-note.md', {
      body: 'Biology reading',
      frontmatter: { title: 'Bio', date: '2026-06-18' },
    });
    const ics = fs.readFileSync(path.join(__dirname, 'fixtures', 'calendar', 'simple-utc.ics'), 'utf8');
    importIcsIntoVault(dataDir, vaultId, { icsText: ics, displayName: 'Work' });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('merges note and event layers sorted by sort_at', () => {
    const timeline = buildCalendarTimeline({
      dataDir,
      vaultId,
      vaultPath,
      from: '2026-06-01',
      to: '2026-06-30',
      layers: 'notes,events',
    });
    assert.equal(timeline.schema, 'knowtation.calendar_timeline/v0');
    assert.equal(timeline.items.length, 2);
    const kinds = timeline.items.map((i) => i.kind);
    assert.deepEqual(kinds.sort(), ['event', 'note']);
  });

  it('notes-only layer excludes external events', () => {
    const timeline = buildCalendarTimeline({
      dataDir,
      vaultId,
      vaultPath,
      from: '2026-06-01',
      to: '2026-06-30',
      layers: 'notes',
    });
    assert.ok(timeline.items.every((i) => i.kind === 'note'));
  });

  it('accepts pre-fetched note records for hosted bridge merge', () => {
    const timeline = buildCalendarTimeline({
      dataDir,
      vaultId,
      noteRecords: [
        {
          path: 'notes/june-note.md',
          frontmatter: { title: 'Bio', date: '2026-06-18' },
          date: '2026-06-18',
          project: null,
          tags: ['biology'],
        },
      ],
      from: '2026-06-01',
      to: '2026-06-30',
      layers: 'notes',
    });
    assert.equal(timeline.items.length, 1);
    assert.equal(timeline.items[0].kind, 'note');
    assert.equal(timeline.items[0].path, 'notes/june-note.md');
  });

  it('hides events when enabled_for_display is false', () => {
    const storePath = path.join(dataDir, 'hub_calendar_store.json');
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    store.vaults.default.source_calendars[0].enabled_for_display = false;
    fs.writeFileSync(storePath, JSON.stringify(store));

    const timeline = buildCalendarTimeline({
      dataDir,
      vaultId,
      vaultPath,
      from: '2026-06-01',
      to: '2026-06-30',
      layers: 'events',
    });
    assert.equal(timeline.items.length, 0);
  });
});

describe('noteCalendarDayKey', () => {
  it('uses frontmatter date when present', () => {
    assert.equal(noteCalendarDayKey({ frontmatter: { date: '2026-06-18' } }), '2026-06-18');
  });
});
