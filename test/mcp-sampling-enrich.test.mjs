import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnrichResponse } from '../mcp/tools/enrich.mjs';

describe('parseEnrichResponse', () => {
  it('parses valid JSON response', () => {
    const raw = '{"title":"My Note","project":"my-project","tags":["tag1","tag2"]}';
    const result = parseEnrichResponse(raw);
    assert.equal(result.title, 'My Note');
    assert.equal(result.project, 'my-project');
    assert.deepEqual(result.tags, ['tag1', 'tag2']);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"title":"Note","project":null,"tags":["a"]}\n```';
    const result = parseEnrichResponse(raw);
    assert.equal(result.title, 'Note');
    assert.equal(result.project, null);
    assert.deepEqual(result.tags, ['a']);
  });

  it('normalizes project slug to lowercase kebab-case', () => {
    const raw = '{"title":"X","project":"My Project Name","tags":[]}';
    const result = parseEnrichResponse(raw);
    assert.equal(result.project, 'my-project-name');
  });

  it('lowercases tags and deduplicates', () => {
    const raw = '{"title":"X","project":null,"tags":["Foo","BAR","foo"]}';
    const result = parseEnrichResponse(raw);
    assert.deepEqual(result.tags, ['foo', 'bar', 'foo']);
  });

  it('caps tags at 10', () => {
    const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    const raw = JSON.stringify({ title: 'X', project: null, tags });
    const result = parseEnrichResponse(raw);
    assert.equal(result.tags.length, 10);
  });

  it('returns fallback for invalid JSON', () => {
    const result = parseEnrichResponse('not json at all');
    assert.equal(result.title, null);
    assert.equal(result.project, null);
    assert.deepEqual(result.tags, []);
  });

  it('returns fallback for null input', () => {
    const result = parseEnrichResponse(null);
    assert.equal(result.title, null);
    assert.deepEqual(result.tags, []);
  });

  it('handles empty strings gracefully', () => {
    const raw = '{"title":"","project":"","tags":[""]}';
    const result = parseEnrichResponse(raw);
    assert.equal(result.title, null);
    assert.equal(result.project, null);
    assert.deepEqual(result.tags, []);
  });
});
