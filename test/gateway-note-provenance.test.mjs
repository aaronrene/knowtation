import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeHostedNoteBodyForCanister,
  isPostApiV1Notes,
} from '../hub/gateway/apply-note-provenance.mjs';

test('mergeHostedNoteBodyForCanister stringifies frontmatter for canister wire format', () => {
  const out = mergeHostedNoteBodyForCanister(
    {
      path: 'inbox/a.md',
      body: 'hello',
      frontmatter: { title: 'T', source: 'hub' },
    },
    'google:108077705743543803349'
  );
  assert.equal(typeof out.frontmatter, 'string');
  const fm = JSON.parse(out.frontmatter);
  assert.equal(fm.title, 'T');
  assert.equal(fm.source, 'hub');
  assert.equal(fm.knowtation_editor, 'google:108077705743543803349');
  assert.equal(fm.author_kind, 'human');
  assert.match(fm.knowtation_edited_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('mergeHostedNoteBodyForCanister strips client forged reserved keys', () => {
  const out = mergeHostedNoteBodyForCanister(
    {
      path: 'x.md',
      body: 'b',
      frontmatter: {
        note: 'ok',
        knowtation_editor: 'evil:1',
        knowtation_edited_at: '1970-01-01T00:00:00.000Z',
      },
    },
    'github:7612643'
  );
  const fm = JSON.parse(/** @type {string} */ (out.frontmatter));
  assert.equal(fm.note, 'ok');
  assert.equal(fm.knowtation_editor, 'github:7612643');
  assert.notEqual(fm.knowtation_edited_at, '1970-01-01T00:00:00.000Z');
});

test('mergeHostedNoteBodyForCanister parses string frontmatter input', () => {
  const out = mergeHostedNoteBodyForCanister(
    {
      path: 'y.md',
      body: 'b',
      frontmatter: '{"project":"p"}',
    },
    'google:1'
  );
  const fm = JSON.parse(/** @type {string} */ (out.frontmatter));
  assert.equal(fm.project, 'p');
  assert.equal(fm.knowtation_editor, 'google:1');
});

test('mergeHostedNoteBodyForCanister preserves tags and project for canister wire', () => {
  const out = mergeHostedNoteBodyForCanister(
    {
      path: 'inbox/n.md',
      body: 'hello',
      frontmatter: { title: 'T', tags: 'alpha, beta', project: 'my-app' },
    },
    'google:123'
  );
  const fm = JSON.parse(/** @type {string} */ (out.frontmatter));
  assert.equal(fm.title, 'T');
  assert.equal(fm.tags, 'alpha, beta');
  assert.equal(fm.project, 'my-app');
  assert.ok(fm.knowtation_edited_at);
});

test('isPostApiV1Notes matches notes collection POST only', () => {
  assert.equal(isPostApiV1Notes('POST', '/api/v1/notes'), true);
  assert.equal(isPostApiV1Notes('POST', '/api/v1/notes/'), true);
  assert.equal(isPostApiV1Notes('GET', '/api/v1/notes'), false);
  assert.equal(isPostApiV1Notes('POST', '/api/v1/notes/inbox/x.md'), false);
});
