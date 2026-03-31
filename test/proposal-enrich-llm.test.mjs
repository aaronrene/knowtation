import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseEnrichModelOutput,
  validateAndNormalizeSuggestedFrontmatter,
  validateAndNormalizeEnrichResult,
  normalizeSuggestedLabels,
  serializeSuggestedFrontmatterJson,
  buildEnrichMessages,
} from '../lib/proposal-enrich-llm.mjs';

describe('proposal-enrich-llm', () => {
  it('parseEnrichModelOutput parses envelope and strips fences', () => {
    const raw = '```json\n{"enrich_version":2,"summary":"Hi","suggested_labels":["a","b"],"suggested_frontmatter":{"project":"Foo-Bar"}}\n```';
    const p = parseEnrichModelOutput(raw);
    assert.strictEqual(p.enrich_version, 2);
    assert.strictEqual(p.summary, 'Hi');
    assert.deepStrictEqual(p.suggested_labels, ['a', 'b']);
    assert.strictEqual(p.suggested_frontmatter.project, 'Foo-Bar');
    assert.strictEqual(p.parseOk, true);
  });

  it('validateAndNormalizeSuggestedFrontmatter normalizes slugs and strips forbidden keys', () => {
    const out = validateAndNormalizeSuggestedFrontmatter({
      project: 'My Project!',
      causal_chain_id: 'Chain One',
      entity: ['Alice B', 'bob'],
      knowtation_editor: 'x',
      network: 'eth',
      tags: ['A', 'b'],
      follows: 'inbox/../escape.md',
      good: 'ignored-unknown-key',
    });
    assert.strictEqual(out.project, 'my-project');
    assert.strictEqual(out.causal_chain_id, 'chain-one');
    assert.deepStrictEqual(out.entity, ['alice-b', 'bob']);
    assert.deepStrictEqual(out.tags, ['a', 'b']);
    assert.strictEqual(out.knowtation_editor, undefined);
    assert.strictEqual(out.network, undefined);
    assert.strictEqual(out.good, undefined);
    assert.strictEqual(out.follows, undefined);
  });

  it('validateAndNormalizeSuggestedFrontmatter accepts safe follows path', () => {
    const out = validateAndNormalizeSuggestedFrontmatter({
      follows: 'projects/foo/note.md',
    });
    assert.strictEqual(out.follows, 'projects/foo/note.md');
  });

  it('normalizeSuggestedLabels dedupes and caps', () => {
    const out = normalizeSuggestedLabels(['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    assert.strictEqual(out.length, 8);
  });

  it('validateAndNormalizeEnrichResult end-to-end', () => {
    const raw =
      '{"enrich_version":2,"summary":"S","suggested_labels":["tag-one"],"suggested_frontmatter":{"title":"T","episode_id":"Ep_1"}}';
    const r = validateAndNormalizeEnrichResult(raw);
    assert.strictEqual(r.summary, 'S');
    assert.deepStrictEqual(r.suggested_labels, ['tag-one']);
    assert.strictEqual(r.suggested_frontmatter.title, 'T');
    assert.strictEqual(r.suggested_frontmatter.episode_id, 'ep-1');
  });

  it('serializeSuggestedFrontmatterJson returns bounded object', () => {
    const s = serializeSuggestedFrontmatterJson({ project: 'x' });
    assert(s.includes('project'));
    const empty = serializeSuggestedFrontmatterJson({});
    assert.strictEqual(empty, '{}');
  });

  it('buildEnrichMessages includes allow-list and path', () => {
    const { system, user } = buildEnrichMessages({ path: 'inbox/x.md', intent: 'fix', body: 'hello' });
    assert(system.includes('enrich_version'));
    assert(user.includes('inbox/x.md'));
    assert(user.includes('fix'));
    assert(user.includes('hello'));
  });
});
