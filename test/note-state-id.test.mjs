/**
 * @import { test } from 'node:test';
 * @import assert from 'node:assert/strict';
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  absentNoteStateId,
  fnv1a64Hex,
  noteStateIdFromParts,
  noteStateIdFromRawStrings,
  noteStateIdFromHubNoteJson,
  stableStringify,
} from '../lib/note-state-id.mjs';

describe('note-state-id', () => {
  it('stableStringify sorts object keys', () => {
    assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it('absentNoteStateId is stable kn1_ prefix', () => {
    const a = absentNoteStateId();
    assert.ok(a.startsWith('kn1_'));
    assert.equal(a.length, 4 + 16);
  });

  it('noteStateIdFromParts is deterministic', () => {
    const x = noteStateIdFromParts({ title: 'Hi' }, 'body');
    const y = noteStateIdFromParts({ title: 'Hi' }, 'body');
    assert.equal(x, y);
  });

  it('noteStateIdFromRawStrings differs from reordered JSON object hash', () => {
    const raw = '{"b":1,"a":2}';
    const fromRaw = noteStateIdFromRawStrings(raw, 'x');
    const fromObj = noteStateIdFromParts({ b: 1, a: 2 }, 'x');
    assert.notEqual(fromRaw, fromObj);
  });

  it('noteStateIdFromHubNoteJson handles object frontmatter', () => {
    const id = noteStateIdFromHubNoteJson({ frontmatter: { z: 1 }, body: 'b' });
    assert.ok(id.startsWith('kn1_'));
  });

  it('noteStateIdFromHubNoteJson handles string frontmatter', () => {
    const id = noteStateIdFromHubNoteJson({ frontmatter: '{"t":1}', body: 'b' });
    assert.ok(id.startsWith('kn1_'));
  });

  it('fnv1a64Hex matches single zero byte', () => {
    const h = fnv1a64Hex(Buffer.from([0x00]));
    assert.equal(h.length, 16);
  });
});
