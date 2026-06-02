import test from 'node:test';
import assert from 'node:assert';
import { normalizeMetadataFacets } from '../lib/vault.mjs';

test('metadata facets: normalizes canonical frontmatter and inferred folder without body fields', () => {
  const out = normalizeMetadataFacets('projects/My Project/note.md', {
    project: 'Front Matter Project',
    tags: 'Research, AI Safety',
    date: '2026-05-24',
    updated: new Date('2026-05-25T12:34:56.000Z'),
    causal_chain_id: 'Launch Rollout',
    entity: ['Alice B', 'Core API'],
    episode_id: 'Episode 1',
    body: 'body text must never be returned',
    snippet: 'snippet must never be returned',
  });

  assert.deepStrictEqual(out, {
    schema: 'knowtation.metadata_facets/v0',
    path: 'projects/My Project/note.md',
    facets: {
      project: 'front-matter-project',
      tags: ['research', 'ai-safety'],
      date: '2026-05-24',
      updated: '2026-05-25T12:34:56.000Z',
      causal_chain_id: 'launch-rollout',
      entity: ['alice-b', 'core-api'],
      episode_id: 'episode-1',
    },
    inferred: {
      folder: 'projects/My Project',
      source_type: null,
    },
    truncated: false,
  });
  assert.equal('body' in out, false);
  assert.equal('snippet' in out, false);
  assert.equal('frontmatter' in out, false);
});

test('metadata facets: infers project with effective project slug semantics', () => {
  const out = normalizeMetadataFacets('projects/Born Free/inbox/note.md', {
    tags: ['one', 'Two Words'],
  });

  assert.equal(out.facets.project, 'born-free');
  assert.deepStrictEqual(out.facets.tags, ['one', 'two-words']);
  assert.equal(out.inferred.folder, 'projects/Born Free/inbox');
});

test('metadata facets: preserves deterministic null and empty defaults', () => {
  const out = normalizeMetadataFacets('inbox/note.md', {});

  assert.deepStrictEqual(out.facets, {
    project: null,
    tags: [],
    date: null,
    updated: null,
    causal_chain_id: null,
    entity: [],
    episode_id: null,
  });
  assert.deepStrictEqual(out.inferred, {
    folder: 'inbox',
    source_type: null,
  });
  assert.equal(out.truncated, false);
});

test('metadata facets security: rejects absolute and traversal paths', () => {
  assert.throws(
    () => normalizeMetadataFacets('/tmp/vault/note.md', {}),
    /Invalid path/,
  );
  assert.throws(
    () => normalizeMetadataFacets('../secrets.md', {}),
    /Invalid path/,
  );
  assert.throws(
    () => normalizeMetadataFacets('inbox/../../secrets.md', {}),
    /Invalid path/,
  );
});

test('metadata facets security: excludes deferred and sensitive metadata fields', () => {
  const out = normalizeMetadataFacets('inbox/note.md', {
    tags: ['ok'],
    label: 'do not include',
    labels: ['do not include'],
    ocr_text: 'do not include',
    pageIndex: { text: 'do not include' },
    media_metadata: { transcript: 'do not include' },
    vector_score: 0.99,
    memory_events: ['do not include'],
    provider_key: 'secret',
    absolute_path: '/Users/example/vault/inbox/note.md',
    raw_upstream_payload: { secret: true },
    summary: 'do not include',
  });

  assert.deepStrictEqual(Object.keys(out.facets), [
    'project',
    'tags',
    'date',
    'updated',
    'causal_chain_id',
    'entity',
    'episode_id',
  ]);
  assert.deepStrictEqual(Object.keys(out.inferred), ['folder', 'source_type']);
  assert.equal(JSON.stringify(out).includes('do not include'), false);
  assert.equal(JSON.stringify(out).includes('secret'), false);
  assert.equal(JSON.stringify(out).includes('/Users/example'), false);
});

test('metadata facets data-integrity: does not mutate input frontmatter', () => {
  const fm = {
    project: 'Original Project',
    tags: ['Alpha', 'Beta'],
    entity: ['Alice'],
    nested: { label: 'unchanged' },
  };
  const before = JSON.stringify(fm);

  normalizeMetadataFacets('projects/example/note.md', fm);

  assert.equal(JSON.stringify(fm), before);
  assert.deepStrictEqual(fm.tags, ['Alpha', 'Beta']);
  assert.deepStrictEqual(fm.entity, ['Alice']);
});

test('metadata facets stress: caps large tag and entity arrays with bounded values', () => {
  const tags = Array.from({ length: 150 }, (_, i) => `Tag ${i}`);
  const entity = Array.from({ length: 150 }, (_, i) => `Entity ${i}`);
  const out = normalizeMetadataFacets('projects/example/note.md', {
    tags,
    entity,
  });

  assert.equal(out.facets.tags.length, 100);
  assert.equal(out.facets.entity.length, 100);
  assert.equal(out.facets.tags[99], 'tag-99');
  assert.equal(out.facets.entity[99], 'entity-99');
  assert.equal(out.truncated, true);
});

test('metadata facets stress: caps oversized scalar values and remains deterministic', () => {
  const huge = 'A'.repeat(1000);
  const input = {
    project: huge,
    tags: [huge],
    date: huge,
    updated: huge,
    causal_chain_id: huge,
    entity: [huge],
    episode_id: huge,
  };

  const first = normalizeMetadataFacets('projects/example/note.md', input);
  const second = normalizeMetadataFacets('projects/example/note.md', input);

  assert.deepStrictEqual(first, second);
  assert.equal(first.truncated, true);
  assert(first.facets.project.length <= 256);
  assert(first.facets.tags.every((value) => value.length <= 256));
  assert(first.facets.date.length <= 256);
  assert(first.facets.updated.length <= 256);
  assert(first.facets.causal_chain_id.length <= 256);
  assert(first.facets.entity.every((value) => value.length <= 256));
  assert(first.facets.episode_id.length <= 256);
});
