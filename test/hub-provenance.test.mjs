/**
 * Hub provenance: reserved frontmatter keys are server-controlled.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mergeProvenanceFrontmatter, stripReservedFrontmatterKeys } from '../lib/hub-provenance.mjs';

describe('hub-provenance', () => {
  it('stripReservedFrontmatterKeys removes reserved keys', () => {
    const out = stripReservedFrontmatterKeys({
      title: 'x',
      knowtation_editor: 'fake',
      author_kind: 'human',
    });
    assert.strictEqual(out.title, 'x');
    assert.strictEqual(out.knowtation_editor, undefined);
    assert.strictEqual(out.author_kind, undefined);
  });

  it('mergeProvenanceFrontmatter applies server values over client forgeries', () => {
    const now = '2026-03-22T12:00:00.000Z';
    const merged = mergeProvenanceFrontmatter(
      {
        title: 'Note',
        knowtation_editor: 'google:fake',
        knowtation_edited_at: '1999-01-01',
        author_kind: 'webhook',
      },
      { sub: 'github:7612643', kind: 'human', now },
    );
    assert.strictEqual(merged.title, 'Note');
    assert.strictEqual(merged.knowtation_editor, 'github:7612643');
    assert.strictEqual(merged.knowtation_edited_at, now);
    assert.strictEqual(merged.author_kind, 'human');
  });

  it('webhook kind omits knowtation_editor when sub absent', () => {
    const merged = mergeProvenanceFrontmatter({ source: 'slack' }, { kind: 'webhook', now: 't' });
    assert.strictEqual(merged.source, 'slack');
    assert.strictEqual(merged.author_kind, 'webhook');
    assert.strictEqual(merged.knowtation_editor, undefined);
  });

  it('mergeProvenanceFrontmatter parses JSON string frontmatter (Hub UI / gateway wire)', () => {
    const now = '2026-03-26T20:00:00.000Z';
    const inner = JSON.stringify({ title: 'T', tags: 'alpha, beta', date: '2026-03-26' });
    const merged = mergeProvenanceFrontmatter(inner, { sub: 'google:1', kind: 'human', now });
    assert.strictEqual(merged.title, 'T');
    assert.strictEqual(merged.tags, 'alpha, beta');
    assert.strictEqual(merged.date, '2026-03-26');
    assert.strictEqual(merged.knowtation_editor, 'google:1');
    assert.strictEqual(merged.knowtation_edited_at, now);
  });

  it('agent approve merge includes proposed and approved', () => {
    const merged = mergeProvenanceFrontmatter(
      { project: 'launch' },
      {
        sub: 'google:admin',
        kind: 'agent',
        now: 'n',
        proposedBy: 'github:agent',
        approvedBy: 'google:admin',
      },
    );
    assert.strictEqual(merged.project, 'launch');
    assert.strictEqual(merged.knowtation_proposed_by, 'github:agent');
    assert.strictEqual(merged.knowtation_approved_by, 'google:admin');
    assert.strictEqual(merged.knowtation_editor, 'google:admin');
    assert.strictEqual(merged.author_kind, 'agent');
  });
});
