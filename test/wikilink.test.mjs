import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findFirstWikilinkToTargetInBody,
  vaultBasenameTargetKey,
  wikilinkTargetKey,
} from '../lib/wikilink.mjs';

describe('lib/wikilink.mjs', () => {
  it('vaultBasenameTargetKey matches basename stem', () => {
    assert.equal(vaultBasenameTargetKey('projects/x/My-Note.md'), 'my-note');
  });

  it('findFirstWikilinkToTargetInBody returns context', () => {
    const ctx = findFirstWikilinkToTargetInBody('prefix [[My-Note]] suffix', wikilinkTargetKey('My-Note'));
    assert.ok(ctx && ctx.includes('[[My-Note]]'));
  });

  it('findFirstWikilinkToTargetInBody returns null when no match', () => {
    assert.equal(findFirstWikilinkToTargetInBody('no links', 'foo'), null);
  });
});
