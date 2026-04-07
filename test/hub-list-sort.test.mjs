import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortNotesList, sortProposalsList } from '../web/hub/hub-list-sort.mjs';

test('sortNotesList date_desc and date_asc', () => {
  const notes = [
    { path: 'a.md', date: '2020-01-01', updated: null },
    { path: 'b.md', date: '2022-06-01', updated: null },
    { path: 'c.md', date: '2021-01-01', updated: null },
  ];
  const dk = (n) => n.date || '';
  const d = sortNotesList(notes, 'date_desc', dk).map((n) => n.path);
  assert.deepEqual(d, ['b.md', 'c.md', 'a.md']);
  const asc = sortNotesList(notes, 'date_asc', dk).map((n) => n.path);
  assert.deepEqual(asc, ['a.md', 'c.md', 'b.md']);
});

test('sortNotesList year_desc', () => {
  const notes = [
    { path: 'y1.md', date: '2019-12-31' },
    { path: 'y2.md', date: '2022-01-01' },
    { path: 'y3.md', date: '2022-06-01' },
  ];
  const dk = (n) => n.date || '';
  const out = sortNotesList(notes, 'year_desc', dk).map((n) => n.path);
  assert.deepEqual(out, ['y3.md', 'y2.md', 'y1.md']);
});

test('sortProposalsList updated_desc and status_asc', () => {
  const list = [
    { path: 'z.md', status: 'proposed', updated_at: '2024-01-02T00:00:00Z' },
    { path: 'a.md', status: 'approved', updated_at: '2024-01-01T00:00:00Z' },
    { path: 'm.md', status: 'discarded', updated_at: '2024-01-03T00:00:00Z' },
  ];
  const u = sortProposalsList(list, 'updated_desc').map((p) => p.path);
  assert.deepEqual(u, ['m.md', 'z.md', 'a.md']);
  const s = sortProposalsList(list, 'status_asc').map((p) => p.path);
  assert.deepEqual(s, ['a.md', 'm.md', 'z.md']);
});
